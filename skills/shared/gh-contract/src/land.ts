import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getIssue, getPr, type PrData, prChecks, type PrState, prState, squashMerge } from "./github.ts";
import {
  checkoutAt,
  checkoutBranch,
  checkoutDetached,
  cloneRepo,
  currentBranch,
  fetchRefs,
  headOf,
  isClean,
  localAncestor,
  pushWithLease,
  unmergedFiles,
} from "./git.ts";
import { prMergeReady, treeMergeReady, treeStatus } from "./merge.ts";
import type { Diagnostic } from "./model.ts";
import { localPatchId, type PatchId } from "./patch.ts";
import { run, runOk, UsageError } from "./proc.ts";
import { type Ref, refKey, repoKey, sameRepo } from "./ref.ts";

const short = (sha: string): string => sha.slice(0, 7);

const stage = (name: string, detail: string): void => {
  process.stdout.write(`${name}\t${detail}\n`);
};

function reportStage(name: string, problems: readonly Diagnostic[]): boolean {
  const errors = problems.filter((p) => p.severity === "error");
  if (errors.length === 0) {
    stage(name, "通过");
    return true;
  }
  stage(name, `${errors.length} 项问题`);
  for (const p of problems) process.stdout.write(`${p.severity === "error" ? "ERROR" : "WARN "} ${p.where}  ${p.message}\n`);
  return false;
}

export type RebaseOutcome =
  | { readonly kind: "up-to-date"; readonly head: string }
  | { readonly kind: "rebased"; readonly oldHead: string; readonly newHead: string; readonly oldPatch: PatchId; readonly newPatch: PatchId }
  | { readonly kind: "conflict"; readonly files: readonly string[] };

export async function rebaseOnto(path: string, baseRef: string): Promise<RebaseOutcome> {
  const oldHead = await headOf(path);
  if (await localAncestor(path, baseRef, oldHead)) return { kind: "up-to-date", head: oldHead };
  const oldPatch = await localPatchId(path, baseRef, oldHead);
  const r = await run(["git", "-C", path, "rebase", baseRef]);
  if (r.code !== 0) {
    const files = await unmergedFiles(path);
    await runOk(["git", "-C", path, "rebase", "--abort"]);
    return { kind: "conflict", files };
  }
  const newHead = await headOf(path);
  return { kind: "rebased", oldHead, newHead, oldPatch, newPatch: await localPatchId(path, baseRef, newHead) };
}

type Workspace = { readonly path: string; readonly close: () => Promise<void> };

async function workspaceFor(pr: PrData, checkout: string | null): Promise<Workspace> {
  if (checkout !== null) {
    const co = await checkoutAt(checkout);
    if (!sameRepo(co.repo, pr.ref.repo)) throw new UsageError(`--checkout 指向 ${repoKey(co.repo)}，PR 属于 ${repoKey(pr.ref.repo)}`);
    if (!(await isClean(co.path))) throw new UsageError(`--checkout ${co.path} 有未提交的改动：先提交或清理，ghc land 只在干净检出上 rebase`);
    const branch = await currentBranch(co.path);
    const head = await headOf(co.path);
    return {
      path: co.path,
      close: async () => {
        if (branch === null) await checkoutDetached(co.path, head);
        else await checkoutBranch(co.path, branch);
      },
    };
  }
  const dir = await mkdtemp(join(tmpdir(), "ghc-land-"));
  const path = join(dir, pr.ref.repo.name);
  await cloneRepo(pr.ref.repo, path);
  return { path, close: async () => { await rm(dir, { recursive: true, force: true }); } };
}

async function waitChecks(ref: Ref, head: string, pollSeconds: number, timeoutSeconds: number): Promise<number> {
  const start = Date.now();
  const deadline = start + timeoutSeconds * 1000;
  const noChecksAt = start + 60_000;
  for (;;) {
    const pc = await prChecks(ref);
    if (pc.head === head) {
      const active = pc.checks.filter((c) => !c.name.startsWith("evidence/"));
      const failed = active.filter((c) => c.state === "failure");
      if (failed.length > 0) {
        stage("checks", failed.map((c) => `${c.name}=${c.state}`).join("、"));
        return 1;
      }
      if (active.length > 0 && active.every((c) => c.state === "success")) {
        stage("checks", `${active.length} 个检查 success`);
        return 0;
      }
      if (active.length === 0 && Date.now() >= noChecksAt) {
        stage("checks", `无检查（GitHub 在 ${Math.round((Date.now() - start) / 1000)}s 内未登记）`);
        return 0;
      }
    }
    if (Date.now() >= deadline) {
      stage("checks", `${timeoutSeconds}s 内未全部 success（GitHub HEAD ${short(pc.head)}）`);
      return 1;
    }
    await Bun.sleep(pollSeconds * 1000);
  }
}

type Pipeline = {
  readonly ref: Ref;
  readonly pr: PrData;
  readonly base: string;
  readonly headRef: string;
  readonly checkout: string | null;
  readonly pollSeconds: number;
  readonly timeoutSeconds: number;
  readonly verify: (head: string) => Promise<readonly Diagnostic[]>;
  readonly readback: (state: PrState) => Promise<{ readonly ok: boolean; readonly detail: string }>;
};

async function landPipeline(p: Pipeline): Promise<number> {
  const ws = await workspaceFor(p.pr, p.checkout);
  try {
    await fetchRefs(ws.path, "origin", [p.base, p.headRef]);
    const head = (await runOk(["git", "-C", ws.path, "rev-parse", `origin/${p.headRef}`])).trim();
    stage("fetch", `origin/${p.base} origin/${p.headRef}@${short(head)}`);
    await checkoutDetached(ws.path, head);
    const baseRef = `origin/${p.base}`;
    const rebase = await rebaseOnto(ws.path, baseRef);
    if (rebase.kind === "conflict") {
      stage("rebase", `${rebase.files.length} 个文件冲突，已 abort，分支不变`);
      for (const f of rebase.files) process.stdout.write(`冲突\t${f}\n`);
      return 1;
    }
    let current = head;
    if (rebase.kind === "up-to-date") stage("rebase", `已包含 ${baseRef}@${short(head)}`);
    else {
      current = rebase.newHead;
      stage("rebase", `${short(rebase.oldHead)} → ${short(rebase.newHead)}`);
    }
    const patch = rebase.kind === "rebased" ? rebase.newPatch : await localPatchId(ws.path, baseRef);
    if (rebase.kind === "rebased") {
      stage("patch-id", `${short(rebase.oldPatch)} → ${short(patch)}`);
      await pushWithLease(ws.path, p.headRef, rebase.oldHead);
      if (rebase.oldPatch !== patch) {
        process.stdout.write(`patch 已从 ${short(rebase.oldPatch)} 变为 ${short(patch)}，需要复核\n`);
        return 1;
      }
    } else stage("patch-id", patch);
    const checks = await waitChecks(p.ref, current, p.pollSeconds, p.timeoutSeconds);
    if (checks !== 0) return checks;
    const problems = await p.verify(current);
    if (!reportStage("merge-ready", problems)) return 1;
    const merge = await squashMerge(p.ref, current);
    if (!merge.ok) {
      stage("merge", merge.output);
      return 1;
    }
    stage("merge", `squash --delete-branch --match-head-commit ${short(current)}`);
    const state = await prState(p.ref);
    if (state.state !== "MERGED") {
      stage("readback", `PR 状态是 ${state.state}`);
      return 1;
    }
    const readback = await p.readback(state);
    stage("readback", readback.detail);
    return readback.ok ? 0 : 1;
  } finally {
    await ws.close();
  }
}

export type LandOptions = {
  readonly issue: Ref;
  readonly checkout: string | null;
  readonly pollSeconds: number;
  readonly timeoutSeconds: number;
};

export async function landPr(ref: Ref, o: LandOptions): Promise<number> {
  const pr = await getPr(ref);
  if (pr.state !== "OPEN") {
    process.stdout.write(`pr\t${refKey(ref)} 状态是 ${pr.state}\n`);
    return 1;
  }
  if (pr.headRepo !== null && !sameRepo(pr.headRepo, pr.ref.repo)) {
    process.stdout.write(`pr\t${refKey(ref)} 的 head 在 fork ${repoKey(pr.headRepo)}：无法推送，拒绝落盘\n`);
    return 1;
  }
  return landPipeline({
    ref,
    pr,
    base: pr.baseRefName,
    headRef: pr.headRefName,
    checkout: o.checkout,
    pollSeconds: o.pollSeconds,
    timeoutSeconds: o.timeoutSeconds,
    verify: (head) => prMergeReady(ref, { issue: o.issue, head }),
    readback: async (state) => {
      if (pr.baseRefName !== state.defaultBranch) return { ok: true, detail: "MERGED" };
      const issue = await getIssue(o.issue);
      return issue.state === "CLOSED" ? { ok: true, detail: `MERGED; ${refKey(o.issue)} CLOSED` } : { ok: false, detail: `PR 已 MERGED，但 ${refKey(o.issue)} 是 ${issue.state}` };
    },
  });
}

export type TreeLandOptions = { readonly pollSeconds: number; readonly timeoutSeconds: number };

export async function landTree(root: Ref, o: TreeLandOptions): Promise<number> {
  const status = await treeStatus(root);
  if (!reportStage("merge-ready", status.problems)) return 1;
  for (const step of status.treePrs) {
    const pr = await getPr(step.pr);
    if (pr.state !== "OPEN") {
      process.stdout.write(`pr\t${refKey(step.pr)} 状态是 ${pr.state}\n`);
      return 1;
    }
    if (pr.defaultBranch === "") {
      process.stdout.write(`pr\t${repoKey(step.repo)} 没有默认分支\n`);
      return 1;
    }
    const code = await landPipeline({
      ref: step.pr,
      pr,
      base: pr.defaultBranch,
      headRef: pr.headRefName,
      checkout: null,
      pollSeconds: o.pollSeconds,
      timeoutSeconds: o.timeoutSeconds,
      verify: () => treeMergeReady(root),
      readback: async () => ({ ok: true, detail: "MERGED" }),
    });
    if (code !== 0) return code;
  }
  const issues = [status.root.ref, ...status.root.subIssues.map((s) => s.ref)];
  const open: string[] = [];
  for (const r of issues) if ((await getIssue(r)).state !== "CLOSED") open.push(refKey(r));
  if (open.length > 0) {
    stage("readback", `仍未 CLOSED：${open.join(", ")}`);
    return 1;
  }
  stage("readback", `${issues.length} 个树 issue 全部 CLOSED`);
  return 0;
}
