// `ghc merge-ready`: the preconditions for merging a PR that delivers one issue, or for merging an issue tree into the default branch.

import { type CheckResult, describe } from "./evidence/check.ts";
import { bufferMerge, integrationMerges, resolve, runCheck } from "./evidence/publish.ts";
import { packComplete, parsePack } from "./evidence/render.ts";
import { gateEntries, latestValid } from "./gate.ts";
import { branchHead, compareDiff, getIssue, getPr, type IssueData, type MergedPr, type PrData, prsFrom, repoDefaultBranch } from "./github.ts";
import { outcomesDigest, parseIssue } from "./issue.ts";
import { type Diagnostic, err } from "./model.ts";
import { type PatchId, patchIdOfDiff, prPatchId } from "./patch.ts";
import { checkBody, checkIdentity, checkNoCode, checkPlacement, checkTreePr } from "./pr.ts";
import { type Ref, type Repo, refKey, repoKey, sameRef, sameRepo, treeBranch } from "./ref.ts";

export type MergeDeps = {
  readonly patch: PatchId;
  readonly evidence: CheckResult | null;
};

export async function checkPrMergeReady(pr: PrData, issue: IssueData, o: { readonly issue: Ref; readonly head: string | null }, deps: MergeDeps): Promise<Diagnostic[]> {
  const d: Diagnostic[] = [];
  if (pr.state !== "OPEN") d.push(err("pr", `PR 状态是 ${pr.state}`));
  if (pr.mergeable !== "MERGEABLE") d.push(err("pr", `mergeable = ${pr.mergeable}`));
  if (o.head !== null && pr.headRefOid !== o.head) d.push(err("pr", `HEAD 是 ${pr.headRefOid}，授权的是 ${o.head}`));
  d.push(...checkIdentity(pr, o.issue).diagnostics, ...checkPlacement(pr, issue));
  for (const c of pr.checks) {
    if (c.name.startsWith("evidence/")) continue;
    if (c.state !== "success") d.push(err("checks", `${c.name}：${c.state}`));
  }
  const review = latestValid(gateEntries(pr, issue, deps.patch));
  if (review === null) d.push(err("review", "没有对当前输入有效的 review 结论"));
  else if (review.header.verdict.kind !== "pass") d.push(err("review", `当前有效的 review 结论不是 PASS：${review.comment.url}`));
  const body = parseIssue(issue.body, { repo: issue.ref.repo, hasParent: issue.parent !== null }).value;
  if (body !== null && body.kind === "no-code") d.push(...checkBody(pr, body));
  else if (deps.evidence === null) d.push(err("evidence", "没有计算证据完备性：先 ghc ev check"));
  else if (!deps.evidence.complete) d.push(err("evidence", `证据不齐全：\n${describe(deps.evidence)}`));
  return d;
}

export async function prMergeReady(ref: Ref, o: { readonly issue: Ref; readonly head: string | null }): Promise<Diagnostic[]> {
  const pr = await getPr(ref);
  const issue = await getIssue(o.issue);
  const patch = await prPatchId(ref);
  const body = parseIssue(issue.body, { repo: issue.ref.repo, hasParent: issue.parent !== null }).value;
  const extra: Diagnostic[] = [];
  let evidence: CheckResult | null = null;
  if (body !== null && body.kind === "no-code") extra.push(...(await checkNoCode(pr, body)).diagnostics);
  else {
    const checked = await runCheck(await resolve(ref));
    evidence = checked.check;
    extra.push(...checked.problems);
  }
  return [...extra, ...(await checkPrMergeReady(pr, issue, o, { patch, evidence }))];
}

export type TreeStatus = {
  readonly root: IssueData;
  readonly repos: readonly Repo[];
  readonly treePrs: readonly { readonly repo: Repo; readonly pr: Ref }[];
  readonly problems: readonly Diagnostic[];
};

export async function treeStatus(rootRef: Ref): Promise<TreeStatus> {
  const root = await getIssue(rootRef);
  const d: Diagnostic[] = [];
  if (root.subIssues.length === 0) return { root, repos: [], treePrs: [], problems: [err(refKey(rootRef), "没有 sub-issue，不是树根")] };
  const buffer = treeBranch(root.ref);
  const cache = new Map<string, MergedPr[]>();
  const repos: Repo[] = [root.ref.repo];
  let integration: { data: IssueData; heads: readonly { repo: Repo; head: string; patchId: PatchId | null }[] | null; composed: readonly Ref[] } | null = null;
  const others: IssueData[] = [];
  for (const s of root.subIssues) {
    const data = await getIssue(s.ref);
    const p = parseIssue(data.body, { repo: data.ref.repo, hasParent: true });
    if (p.value?.kind !== "integration") {
      others.push(data);
      continue;
    }
    const { problems } = await integrationMerges(p.value);
    d.push(...problems);
    const packs = data.comments.flatMap((c) => {
      const pack = parsePack(c.body);
      return pack === null ? [] : [{ pack, url: c.url }];
    });
    const latest = packs.at(-1);
    if (latest === undefined) d.push(err(refKey(s.ref), "总体验收 issue 上没有证据包：先 ghc ev publish 该 issue"));
    else {
      if (!packComplete(latest.pack)) d.push(err(refKey(s.ref), `最新证据包不齐全：${latest.url}`));
      if (latest.pack.outcomesRev !== outcomesDigest(p.value.outcomes)) d.push(err(refKey(s.ref), `最新证据包采集之后预期结果的文字改过：${latest.url}`));
    }
    integration = { data, heads: latest?.pack.heads ?? null, composed: p.value.composed };
  }
  if (integration === null) d.push(err(refKey(rootRef), "树里没有总体验收 issue"));
  for (const data of others) {
    if (data.state === "CLOSED") continue;
    const m = await bufferMerge(data, cache);
    // Composed children without a buffer merge are already reported by the integration check.
    if (m === null) {
      if (!integration?.composed.some((r) => sameRef(r, data.ref))) d.push(err(refKey(data.ref), `还没有合入 ${buffer} 的 PR`));
    } else if (!repos.some((r) => sameRepo(r, m.ref.repo))) repos.push(m.ref.repo);
  }
  const treePrs: { repo: Repo; pr: Ref }[] = [];
  const ordered = [...repos.filter((r) => !sameRepo(r, root.ref.repo)), ...repos.filter((r) => sameRepo(r, root.ref.repo))];
  for (const repo of ordered) {
    const isRoot = sameRepo(repo, root.ref.repo);
    const tip = await branchHead(repo, buffer);
    if (tip === null) {
      if ((await prsFrom(repo, buffer, "merged")).length === 0) d.push(err(repoKey(repo), `没有缓冲分支 ${buffer}`));
      continue;
    }
    const packHead = integration?.heads?.find((h) => sameRepo(h.repo, repo));
    if (integration?.heads != null && packHead?.head !== tip) {
      const current = await patchIdOfDiff(await compareDiff(repo, await repoDefaultBranch(repo), tip));
      if (packHead === undefined) d.push(err(repoKey(repo), `总体验收证据包里没有 ${repoKey(repo)} 的检出：在 ${buffer} 上重采再发布`));
      else if (packHead.patchId === null || packHead.patchId !== current) {
        d.push(err(repoKey(repo), `总体验收证据与 ${buffer} 当前补丁不等（证据包 patch ${packHead.patchId === null ? "无" : packHead.patchId.slice(0, 7)}，当前 ${current.slice(0, 7)}）：在 ${buffer} 上重采再发布`));
      }
    }
    const open = await prsFrom(repo, buffer, "open");
    const merged = await prsFrom(repo, buffer, "merged");
    if (open.length === 0) {
      if (merged.length === 0) d.push(err(repoKey(repo), `没有从 ${buffer} 合入默认分支的 tree PR`));
      continue;
    }
    if (open.length > 1) d.push(err(repoKey(repo), `${buffer} 有 ${open.length} 个 open tree PR：${open.map(refKey).join(", ")}`));
    for (const r of open) {
      const pr = await getPr(r);
      const id = checkIdentity(pr, null);
      d.push(...id.diagnostics.map((x) => ({ ...x, where: `${refKey(r)} ${x.where}` })));
      if (id.target?.kind !== "tree") d.push(err(refKey(r), `第一行必须是 \`Tree ${refKey(root.ref)}\``));
      d.push(...checkTreePr(pr, root).map((x) => ({ ...x, where: `${refKey(r)} ${x.where}` })));
      if (pr.mergeable !== "MERGEABLE") d.push(err(refKey(r), `mergeable = ${pr.mergeable}`));
      for (const c of pr.checks) if (!c.name.startsWith("evidence/") && c.state !== "success") d.push(err(refKey(r), `${c.name}：${c.state}`));
      if (isRoot && repos.length > 1) {
        for (const other of repos.filter((x) => !sameRepo(x, root.ref.repo))) {
          if ((await prsFrom(other, buffer, "open")).length > 0) d.push(err(refKey(r), `先合并 ${repoKey(other)} 的 tree PR，根 repo 的 tree PR 关闭树根，最后合并`));
        }
      }
      treePrs.push({ repo, pr: r });
    }
  }
  return { root, repos, treePrs, problems: d };
}

export async function treeMergeReady(rootRef: Ref): Promise<Diagnostic[]> {
  return [...(await treeStatus(rootRef)).problems];
}
