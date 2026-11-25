// Review verdict comments: a fixed first line names the inputs the verdict observed; validity is recomputed from live inputs.

import type { Comment, Comparison, IssueData, PrData } from "./github.ts";
import { UsageError } from "./proc.ts";

export type Verdict = { readonly kind: "pass" } | { readonly kind: "fail"; readonly gate: number | null };

export type GateHeader = {
  readonly verdict: Verdict;
  readonly head: string;
  readonly base: string;
  readonly issueRev: string;
  readonly design: string | null;
};

function verdictText(v: Verdict): string {
  switch (v.kind) {
    case "pass":
      return "PASS";
    case "fail":
      return v.gate === null ? "FAIL" : `FAIL@Gate${v.gate}`;
  }
}

export function parseVerdict(text: string): Verdict | null {
  if (text === "PASS") return { kind: "pass" };
  if (text === "FAIL") return { kind: "fail", gate: null };
  const m = /^FAIL@Gate([1-6])$/.exec(text);
  return m === null ? null : { kind: "fail", gate: Number(m[1]) };
}

export function renderHeader(h: GateHeader): string {
  return `Gate 结论 · review · ${verdictText(h.verdict)} · HEAD ${h.head} · base ${h.base} · issue rev ${h.issueRev} · 设计 ${h.design ?? "无"}`;
}

const HEADER = /^Gate 结论 · review · (PASS|FAIL(?:@Gate[1-6])?) · HEAD ([0-9a-f]{40}) · base (\S+) · issue rev (\S+) · 设计 (.+)$/;

export function parseHeader(body: string): GateHeader | null {
  const first = body.split(/\r?\n/).find((l) => l.trim() !== "")?.trim();
  if (first === undefined) return null;
  const m = HEADER.exec(first);
  if (m === null) return null;
  const verdict = parseVerdict(m[1] as string);
  if (verdict === null) return null;
  const design = (m[5] as string).trim();
  return { verdict, head: m[2] as string, base: m[3] as string, issueRev: m[4] as string, design: design === "无" ? null : design };
}

export function headerFor(pr: PrData, issue: IssueData, verdict: string, design: string | null): string {
  const v = parseVerdict(verdict);
  if (v === null) throw new UsageError("--result 只能是 PASS 或 FAIL");
  return renderHeader({ verdict: v, head: pr.headRefOid, base: pr.baseRefName, issueRev: issue.bodyRev, design });
}

export type GateEntry = { readonly comment: Comment; readonly header: GateHeader; readonly stale: readonly string[] };

/** Every review verdict on the PR with the inputs that changed since it was given. Once PASS is recorded for the PR's base branch, it stays valid across subsequent HEAD updates (such as resolving conflicts with the buffer branch). */
export function gateEntries(pr: PrData, issue: IssueData): GateEntry[] {
  const out: GateEntry[] = [];
  for (const c of pr.comments) {
    const h = parseHeader(c.body);
    if (h === null) continue;
    const stale: string[] = [];
    if (h.base !== pr.baseRefName) stale.push(`base 已从 ${h.base} 变为 ${pr.baseRefName}`);
    if (h.verdict.kind !== "pass") {
      if (h.head !== pr.headRefOid) stale.push(`HEAD 已从 ${h.head.slice(0, 7)} 变为 ${pr.headRefOid.slice(0, 7)}`);
      if (h.issueRev !== issue.bodyRev) stale.push(`issue 正文已修订（${h.issueRev} → ${issue.bodyRev}）`);
    }
    out.push({ comment: c, header: h, stale });
  }
  return out;
}

/** The newest still-valid review verdict, if any; a valid PASS locks in approval for the PR. */
export function latestValid(entries: readonly GateEntry[]): GateEntry | null {
  const valid = entries.filter((e) => e.stale.length === 0);
  return valid.filter((e) => e.header.verdict.kind === "pass").at(-1) ?? valid.at(-1) ?? null;
}

/** A `review diff` verdict: the code review of one commit, given before evidence is collected and before a PR need exist. */
export type DiffVerdict = "pass" | "fail";
export type DiffHeader = { readonly verdict: DiffVerdict; readonly head: string; readonly issueRev: string; readonly design: string | null };

export function renderDiffHeader(h: DiffHeader): string {
  return `Gate 结论 · review diff · ${h.verdict === "pass" ? "PASS" : "FAIL"} · HEAD ${h.head} · issue rev ${h.issueRev} · 设计 ${h.design ?? "无"}`;
}

const DIFF_HEADER = /^Gate 结论 · review diff · (PASS|FAIL) · HEAD ([0-9a-f]{40}) · issue rev (\S+) · 设计 (.+)$/;

export function parseDiffHeader(body: string): DiffHeader | null {
  const first = body.split(/\r?\n/).find((l) => l.trim() !== "")?.trim();
  if (first === undefined) return null;
  const m = DIFF_HEADER.exec(first);
  if (m === null) return null;
  const design = (m[4] as string).trim();
  return { verdict: m[1] === "PASS" ? "pass" : "fail", head: m[2] as string, issueRev: m[3] as string, design: design === "无" ? null : design };
}

export function diffHeaderFor(issue: IssueData, head: string, verdict: string, design: string | null): string {
  if (verdict !== "PASS" && verdict !== "FAIL") throw new UsageError("--result 只能是 PASS 或 FAIL");
  if (!/^[0-9a-f]{40}$/.test(head)) throw new UsageError("--head 必须是被审提交的 40 位 sha");
  return renderDiffHeader({ verdict: verdict === "PASS" ? "pass" : "fail", head, issueRev: issue.bodyRev, design });
}

export type DiffEntry = { readonly comment: Comment; readonly header: DiffHeader };

/** Every `review diff` verdict among `comments` (the issue thread and, once it exists, the PR thread), oldest first. */
export function diffEntries(comments: readonly Comment[]): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (const c of comments) {
    const h = parseDiffHeader(c.body);
    if (h !== null) out.push({ comment: c, header: h });
  }
  return out.sort((a, b) => (a.comment.createdAt < b.comment.createdAt ? -1 : a.comment.createdAt > b.comment.createdAt ? 1 : 0));
}

/** Why the commit that `pass` approved has no `review diff` PASS given against the same issue revision, or null when it has. */
export function diffReviewProblem(entries: readonly DiffEntry[], pass: GateHeader): string | null {
  const latest = entries.filter((e) => e.header.head === pass.head).at(-1);
  const at = pass.head.slice(0, 7);
  if (latest === undefined) {
    return `PASS 所在提交 ${at} 没有 review diff 结论：先审它的 diff，结论 comment 第一行用 ghc gate diff <issue> --head ${pass.head} --result PASS|FAIL`;
  }
  if (latest.header.verdict !== "pass") return `PASS 所在提交 ${at} 的 review diff 结论是 FAIL：${latest.comment.url}`;
  if (latest.header.issueRev !== pass.issueRev) {
    return `review diff 审的是 issue rev ${latest.header.issueRev}，review 证据和 PR 审的是 ${pass.issueRev}：issue 正文在两次 review 之间修订过，重做 review diff（${latest.comment.url}）`;
  }
  return null;
}

/**
 * Why the commits a PR gained after its PASS are more than merges of its base branch, or null when they are only that.
 * `sincePass` compares the PASS commit with the current HEAD, `sinceBase` the base branch tip with the current HEAD.
 */
export function postPassProblem(passHead: string, sincePass: Comparison, sinceBase: Comparison): string | null {
  const at = passHead.slice(0, 7);
  if (!sincePass.contains) return `PASS 所在提交 ${at} 不是当前 HEAD 的祖先：通过之后不 rebase、不改写分支，用 merge 把 base 合入`;
  const own = new Set(sinceBase.commits.map((c) => c.sha));
  const added = sincePass.commits.filter((c) => c.parents < 2 && own.has(c.sha));
  if (added.length === 0) return null;
  const shown = `${added.slice(0, 5).map((c) => c.sha.slice(0, 7)).join("、")}${added.length > 5 ? " …" : ""}`;
  return `PASS（@${at}）之后分支新增了 ${added.length} 个非合并提交（${shown}）：通过之后只把 base 合入分支解冲突，别的改动另开 issue 和 PR`;
}
