import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getIssue, getPr, type IssueData, type PrChecks, type PrData, prChecks, type PrState, prState, squashMerge } from "./github.ts";
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
import { type Ref, refKey, type Repo, repoKey, sameRepo } from "./ref.ts";

const short = (sha: string): string => sha.slice(0, 7);

const stage = (name: string, detail: string): void => {
  process.stdout.write(`${name}\t${detail}\n`);
};

function reportStage(name: string, problems: readonly Diagnostic[], write: (line: string) => void = (line) => process.stdout.write(line)): boolean {
  const errors = problems.filter((p) => p.severity === "error");
  if (errors.length === 0) {
    write(`${name}\t通过\n`);
    return true;
  }
  write(`${name}\t${errors.length} 项问题\n`);
  for (const p of problems) write(`${p.severity === "error" ? "ERROR" : "WARN "} ${p.where}  ${p.message}\n`);
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

export type Workspace = { readonly path: string; readonly close: () => Promise<void> };

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

export type WaitDecision =
  | { readonly kind: "wait" }
  | { readonly kind: "success"; readonly detail: string }
  | { readonly kind: "failure"; readonly detail: string };

export type WaitInput = {
  /** The HEAD being landed; a rollup still reporting another HEAD has nothing to read yet. */
  readonly head: string;
  readonly snapshot: PrChecks;
  readonly now: number;
  readonly startedAt: number;
  readonly noChecksAt: number;
  readonly deadline: number;
  readonly timeoutSeconds: number;
};

/** One poll of the PR's checks: keep waiting, merge on, or stop with a failure. `evidence/` statuses never count. */
export function checkWaitDecision(w: WaitInput): WaitDecision {
  if (w.snapshot.head === w.head) {
    const active = w.snapshot.checks.filter((c) => !c.name.startsWith("evidence/"));
    const failed = active.filter((c) => c.state === "failure");
    if (failed.length > 0) return { kind: "failure", detail: failed.map((c) => `${c.name}=${c.state}`).join("、") };
    if (active.length > 0 && active.every((c) => c.state === "success")) return { kind: "success", detail: `${active.length} 个检查 success` };
    if (active.length === 0 && w.now >= w.noChecksAt) {
      return { kind: "success", detail: `无检查（GitHub 在 ${Math.round((w.now - w.startedAt) / 1000)}s 内未登记）` };
    }
  }
  if (w.now >= w.deadline) return { kind: "failure", detail: `${w.timeoutSeconds}s 内未全部 success（GitHub HEAD ${short(w.snapshot.head)}）` };
  return { kind: "wait" };
}

async function waitChecks(ref: Ref, head: string, pollSeconds: number, timeoutSeconds: number): Promise<number> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutSeconds * 1000;
  const noChecksAt = startedAt + 60_000;
  for (;;) {
    const snapshot = await prChecks(ref);
    const d = checkWaitDecision({ head, snapshot, now: Date.now(), startedAt, noChecksAt, deadline, timeoutSeconds });
    if (d.kind === "success") {
      stage("checks", d.detail);
      return 0;
    }
    if (d.kind === "failure") {
      stage("checks", d.detail);
      return 1;
    }
    await Bun.sleep(pollSeconds * 1000);
  }
}

export type Pipeline = {
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

/** Every effect `landPipeline` has outside its decisions, so the decisions run without a network or a checkout. */
export type LandDeps = {
  readonly workspace: (pr: PrData, checkout: string | null) => Promise<Workspace>;
  readonly fetchRefs: (path: string, remote: string, refs: readonly string[]) => Promise<void>;
  readonly revParse: (path: string, rev: string) => Promise<string>;
  readonly checkoutDetached: (path: string, rev: string) => Promise<void>;
  readonly rebaseOnto: (path: string, baseRef: string) => Promise<RebaseOutcome>;
  readonly localPatchId: (path: string, baseRef: string, head?: string) => Promise<PatchId>;
  readonly pushWithLease: (path: string, headRef: string, expected: string) => Promise<void>;
  readonly waitChecks: (ref: Ref, head: string, pollSeconds: number, timeoutSeconds: number) => Promise<number>;
  readonly squashMerge: (ref: Ref, head: string) => Promise<{ readonly ok: boolean; readonly output: string }>;
  readonly prState: (ref: Ref) => Promise<PrState>;
  readonly issueState: (ref: Ref) => Promise<IssueData["state"]>;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
};

const LAND_DEPS: LandDeps = {
  workspace: workspaceFor,
  fetchRefs,
  revParse: async (path, rev) => (await runOk(["git", "-C", path, "rev-parse", rev])).trim(),
  checkoutDetached,
  rebaseOnto,
  localPatchId,
  pushWithLease,
  waitChecks,
  squashMerge,
  prState,
  issueState: async (ref) => (await getIssue(ref)).state,
  now: () => Date.now(),
  sleep: (ms) => Bun.sleep(ms),
  log: (line) => void process.stdout.write(line),
};

/** The issue reads and clock a readback needs, so it runs without a network. */
export type ReadbackDeps = Pick<LandDeps, "issueState" | "now" | "sleep" | "log">;

export type Readback = { readonly ok: boolean; readonly detail: string };

/** Poll the tree's issues until every one reads CLOSED, or `timeoutSeconds` passes. */
export async function readbackTree(issues: readonly Ref[], pollSeconds: number, timeoutSeconds: number, deps: ReadbackDeps): Promise<Readback> {
  const deadline = deps.now() + timeoutSeconds * 1000;
  let reported = false;
  for (;;) {
    const open: string[] = [];
    for (const r of issues) if ((await deps.issueState(r)) !== "CLOSED") open.push(refKey(r));
    if (open.length === 0) return { ok: true, detail: `${issues.length} 个树 issue 全部 CLOSED` };
    if (deps.now() >= deadline) return { ok: false, detail: `仍未 CLOSED：${open.join(", ")}` };
    if (!reported) {
      deps.log(`readback\t等待 ${open.join(", ")} CLOSED（最多 ${timeoutSeconds}s）\n`);
      reported = true;
    }
    await deps.sleep(pollSeconds * 1000);
  }
}

/** Poll the issue the landed PR closes until it reads CLOSED, or `timeoutSeconds` passes. */
export async function readbackIssue(issue: Ref, pollSeconds: number, timeoutSeconds: number, deps: ReadbackDeps): Promise<Readback> {
  const deadline = deps.now() + timeoutSeconds * 1000;
  let reported = false;
  for (;;) {
    const state = await deps.issueState(issue);
    if (state === "CLOSED") return { ok: true, detail: `MERGED; ${refKey(issue)} CLOSED` };
    if (deps.now() >= deadline) return { ok: false, detail: `PR 已 MERGED，但 ${refKey(issue)} 是 ${state}` };
    if (!reported) {
      deps.log(`readback\t等待 ${refKey(issue)} CLOSED（${state}，最多 ${timeoutSeconds}s）\n`);
      reported = true;
    }
    await deps.sleep(pollSeconds * 1000);
  }
}

export async function landPipeline(p: Pipeline, deps: LandDeps = LAND_DEPS): Promise<number> {
  const step = (name: string, detail: string): void => deps.log(`${name}\t${detail}\n`);
  const ws = await deps.workspace(p.pr, p.checkout);
  try {
    await deps.fetchRefs(ws.path, "origin", [p.base, p.headRef]);
    const head = await deps.revParse(ws.path, `origin/${p.headRef}`);
    step("fetch", `origin/${p.base} origin/${p.headRef}@${short(head)}`);
    await deps.checkoutDetached(ws.path, head);
    const baseRef = `origin/${p.base}`;
    const rebase = await deps.rebaseOnto(ws.path, baseRef);
    if (rebase.kind === "conflict") {
      step("rebase", `${rebase.files.length} 个文件冲突，已 abort，分支不变`);
      for (const f of rebase.files) deps.log(`冲突\t${f}\n`);
      return 1;
    }
    let current = head;
    if (rebase.kind === "up-to-date") step("rebase", `已包含 ${baseRef}@${short(head)}`);
    else {
      current = rebase.newHead;
      step("rebase", `${short(rebase.oldHead)} → ${short(rebase.newHead)}`);
    }
    const patch = rebase.kind === "rebased" ? rebase.newPatch : await deps.localPatchId(ws.path, baseRef);
    if (rebase.kind === "rebased") {
      step("patch-id", `${short(rebase.oldPatch)} → ${short(patch)}`);
      await deps.pushWithLease(ws.path, p.headRef, rebase.oldHead);
      if (rebase.oldPatch !== patch) {
        deps.log(`patch 已从 ${short(rebase.oldPatch)} 变为 ${short(patch)}，需要复核\n`);
        return 1;
      }
    } else step("patch-id", patch);
    const checks = await deps.waitChecks(p.ref, current, p.pollSeconds, p.timeoutSeconds);
    if (checks !== 0) return checks;
    const problems = await p.verify(current);
    if (!reportStage("merge-ready", problems, deps.log)) return 1;
    const merge = await deps.squashMerge(p.ref, current);
    if (!merge.ok) {
      step("merge", merge.output);
      return 1;
    }
    step("merge", `squash --delete-branch --match-head-commit ${short(current)}`);
    const state = await deps.prState(p.ref);
    if (state.state !== "MERGED") {
      step("readback", `PR 状态是 ${state.state}`);
      return 1;
    }
    const readback = await p.readback(state);
    step("readback", readback.detail);
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

export async function landPr(ref: Ref, o: LandOptions, deps: LandDeps = LAND_DEPS): Promise<number> {
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
      return readbackIssue(o.issue, o.pollSeconds, o.timeoutSeconds, deps);
    },
  }, deps);
}

export type TreeLandOptions = { readonly pollSeconds: number; readonly timeoutSeconds: number };

/** The order tree PRs are landed in: every other repo first, the root repo last. */
export function landOrder<T extends { readonly repo: Repo }>(steps: readonly T[], root: Repo): readonly T[] {
  return [...steps.filter((s) => !sameRepo(s.repo, root)), ...steps.filter((s) => sameRepo(s.repo, root))];
}

export async function landTree(root: Ref, o: TreeLandOptions, deps: LandDeps = LAND_DEPS): Promise<number> {
  const status = await treeStatus(root);
  if (!reportStage("merge-ready", status.problems)) return 1;
  for (const step of landOrder(status.treePrs, root.repo)) {
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
    }, deps);
    if (code !== 0) return code;
  }
  const issues = [status.root.ref, ...status.root.subIssues.map((s) => s.ref)];
  const readback = await readbackTree(issues, o.pollSeconds, o.timeoutSeconds, deps);
  stage("readback", readback.detail);
  return readback.ok ? 0 : 1;
}
