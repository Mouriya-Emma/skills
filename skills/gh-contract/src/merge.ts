// `ghc merge-ready`: the preconditions for merging a PR, or for closing an issue tree.

import { commitStatus, getIssue, getPr, isAncestorRemote } from "./github.ts";
import { parseIssue } from "./issue.ts";
import { type Diagnostic, err } from "./model.ts";
import { checkIdentity } from "./pr.ts";
import { integrationMerges, STATUS_CONTEXT } from "./evidence/publish.ts";
import { packComplete, parsePack } from "./evidence/render.ts";
import { GATE_KINDS, gateEntries, latestValid } from "./gate.ts";
import { UsageError } from "./proc.ts";
import { type Ref, refKey, sameRepo } from "./ref.ts";

export type PrMergeOptions = {
  readonly issue: Ref;
  readonly head: string;
  readonly base: string | null;
  readonly gates: readonly string[];
};

export async function prMergeReady(ref: Ref, o: PrMergeOptions): Promise<Diagnostic[]> {
  const pr = await getPr(ref);
  const d: Diagnostic[] = [];
  if (pr.state !== "OPEN") d.push(err("pr", `PR 状态是 ${pr.state}`));
  if (pr.mergeable !== "MERGEABLE") d.push(err("pr", `mergeable = ${pr.mergeable}`));
  if (pr.headRefOid !== o.head) d.push(err("pr", `HEAD 是 ${pr.headRefOid}，授权的是 ${o.head}`));
  if (o.base !== null && pr.baseRefName !== o.base) d.push(err("pr", `base 是 ${pr.baseRefName}，授权的是 ${o.base}`));
  if (pr.checksState !== null && pr.checksState !== "SUCCESS") d.push(err("checks", `checks 汇总状态 ${pr.checksState}`));
  d.push(...checkIdentity(pr, o.issue).diagnostics);
  const ev = await commitStatus(pr.ref.repo, pr.headRefOid, STATUS_CONTEXT);
  if (ev === null) d.push(err(STATUS_CONTEXT, "HEAD 上没有证据状态：先 ghc ev publish"));
  else if (ev.state !== "success") d.push(err(STATUS_CONTEXT, `HEAD 上证据状态 ${ev.state}：${ev.description}`));
  if (o.gates.length > 0) {
    const issue = await getIssue(o.issue);
    const entries = gateEntries(pr, issue);
    for (const g of o.gates) {
      const kind = GATE_KINDS.find((k) => k === g);
      if (kind === undefined) throw new UsageError(`--require-gate 只能是 ${GATE_KINDS.join("、")}`);
      const v = latestValid(entries, kind);
      if (v === null) d.push(err(`gate ${g}`, "没有对当前输入有效的结论"));
      else if (v.header.verdict.kind !== "pass") d.push(err(`gate ${g}`, `当前有效结论不是 PASS：${v.comment.url}`));
    }
  }
  return d;
}

export async function treeCloseReady(umbrella: Ref): Promise<Diagnostic[]> {
  const root = await getIssue(umbrella);
  const d: Diagnostic[] = [];
  let integration: Ref | null = null;
  for (const s of root.subIssues) {
    const data = await getIssue(s.ref);
    const p = parseIssue(data.body, { repo: data.ref.repo, hasParent: true });
    if (p.value?.kind === "integration") {
      integration = s.ref;
      const { merges, problems } = await integrationMerges(p.value);
      d.push(...problems);
      const packs = data.comments.flatMap((c) => {
        const pack = parsePack(c.body);
        return pack === null ? [] : [{ pack, url: c.url }];
      });
      const latest = packs.at(-1);
      if (latest === undefined) {
        d.push(err(refKey(s.ref), "总体验收 issue 上没有证据包：先 ghc ev publish 该 issue"));
        continue;
      }
      if (!packComplete(latest.pack)) d.push(err(refKey(s.ref), `最新证据包不齐全：${latest.url}`));
      if (latest.pack.issueRev !== data.bodyRev) d.push(err(refKey(s.ref), `最新证据包对应的正文修订已过期：${latest.url}`));
      for (const m of merges) {
        const head = latest.pack.heads.find((h) => sameRepo(h.repo, m.repo));
        if (head === undefined || !(await isAncestorRemote(m.repo, m.commit, head.head))) {
          d.push(err(refKey(s.ref), `最新证据包的检出不含 ${m.child} 的合并提交 ${m.commit.slice(0, 7)}`));
        }
        if (latest.pack.generatedAt <= m.mergedAt) d.push(err(refKey(s.ref), `最新证据包早于 ${m.child} 合并`));
      }
    } else if (s.state !== "CLOSED") {
      d.push(err(refKey(s.ref), "child 尚未关闭"));
    }
  }
  if (integration === null) d.push(err(refKey(umbrella), "树里没有总体验收 issue"));
  return d;
}
