// `ghc merge-ready`: the preconditions for merging a PR that delivers one issue, or for merging an issue tree into the default branch.

import { branchHead, commitStatus, getIssue, getPr, type IssueData, type MergedPr, prsFrom } from "./github.ts";
import { parseIssue } from "./issue.ts";
import { type Diagnostic, err } from "./model.ts";
import { checkIdentity, checkPlacement, checkTreePr } from "./pr.ts";
import { bufferMerge, integrationMerges, statusContext } from "./evidence/publish.ts";
import { packComplete, parsePack } from "./evidence/render.ts";
import { gateEntries, latestValid } from "./gate.ts";
import { type Ref, type Repo, refKey, repoKey, sameRef, sameRepo, treeBranch } from "./ref.ts";

export async function prMergeReady(ref: Ref, o: { readonly issue: Ref; readonly head: string }): Promise<Diagnostic[]> {
  const pr = await getPr(ref);
  const issue = await getIssue(o.issue);
  const d: Diagnostic[] = [];
  if (pr.state !== "OPEN") d.push(err("pr", `PR 状态是 ${pr.state}`));
  if (pr.mergeable !== "MERGEABLE") d.push(err("pr", `mergeable = ${pr.mergeable}`));
  if (pr.headRefOid !== o.head) d.push(err("pr", `HEAD 是 ${pr.headRefOid}，授权的是 ${o.head}`));
  d.push(...checkIdentity(pr, o.issue).diagnostics, ...checkPlacement(pr, issue));
  const own = statusContext(o.issue);
  // Sibling child PRs share this head, so other issues' evidence statuses sit on it too and are not this PR's checks.
  for (const c of pr.checks) {
    if (c.name.startsWith("evidence/")) continue;
    if (c.state !== "success") d.push(err("checks", `${c.name}：${c.state}`));
  }
  const ev = await commitStatus(pr.ref.repo, pr.headRefOid, own);
  if (ev === null) d.push(err(own, "HEAD 上没有本 issue 的证据状态：先 ghc ev publish"));
  else if (ev.state !== "success") d.push(err(own, `HEAD 上证据状态 ${ev.state}：${ev.description}`));
  const review = latestValid(gateEntries(pr, issue));
  if (review === null) d.push(err("review", "没有对当前输入有效的 review 结论"));
  else if (review.header.verdict.kind !== "pass") d.push(err("review", `当前有效的 review 结论不是 PASS：${review.comment.url}`));
  return d;
}

/**
 * Whether the tree's buffer branches may merge into the default branches: every open child merged into the buffer,
 * the integration issue's evidence taken on the current buffer tips, and one valid tree PR per repo. Tree PRs outside
 * the root's repo merge first; the root repo's tree PR closes the root and so merges last.
 */
export async function treeMergeReady(rootRef: Ref): Promise<Diagnostic[]> {
  const root = await getIssue(rootRef);
  const d: Diagnostic[] = [];
  if (root.subIssues.length === 0) return [err(refKey(rootRef), "没有 sub-issue，不是树根")];
  const buffer = treeBranch(root.ref);
  const cache = new Map<string, MergedPr[]>();
  const repos: Repo[] = [root.ref.repo];
  let integration: { data: IssueData; heads: readonly { repo: Repo; head: string }[] | null; composed: readonly Ref[] } | null = null;
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
      if (latest.pack.issueRev !== data.bodyRev) d.push(err(refKey(s.ref), `最新证据包对应的正文修订已过期：${latest.url}`));
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
  for (const repo of repos) {
    const isRoot = sameRepo(repo, root.ref.repo);
    const tip = await branchHead(repo, buffer);
    if (tip === null) {
      if ((await prsFrom(repo, buffer, "merged")).length === 0) d.push(err(repoKey(repo), `没有缓冲分支 ${buffer}`));
      continue;
    }
    const packHead = integration?.heads?.find((h) => sameRepo(h.repo, repo));
    if (integration?.heads != null && packHead?.head !== tip) {
      d.push(err(repoKey(repo), `总体验收证据不在 ${buffer} 当前提交 ${tip.slice(0, 7)} 上采集（证据包为 ${packHead?.head.slice(0, 7) ?? "无"}）`));
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
    }
  }
  return d;
}
