// Review verdict comments: a fixed first line names the patch the verdict observed; validity is recomputed from live inputs.

import type { Comment, IssueData, PrData } from "./github.ts";
import type { PatchId } from "./patch.ts";
import { UsageError } from "./proc.ts";

export type Verdict = { readonly kind: "pass" } | { readonly kind: "fail"; readonly gate: number | null };

export type GateHeader = {
  readonly verdict: Verdict;
  readonly patch: PatchId;
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
  return `Gate 结论 · review · ${verdictText(h.verdict)} · patch ${h.patch} · HEAD ${h.head} · base ${h.base} · issue rev ${h.issueRev} · 设计 ${h.design ?? "无"}`;
}

const HEADER = /^Gate 结论 · review · (PASS|FAIL(?:@Gate[1-6])?) · patch ([0-9a-f]{40}) · HEAD ([0-9a-f]{40}) · base (\S+) · issue rev (\S+) · 设计 (.+)$/;

export function parseHeader(body: string): GateHeader | null {
  const first = body.split(/\r?\n/).find((l) => l.trim() !== "")?.trim();
  if (first === undefined) return null;
  const m = HEADER.exec(first);
  if (m === null) return null;
  const verdict = parseVerdict(m[1] as string);
  if (verdict === null) return null;
  const design = (m[6] as string).trim();
  return { verdict, patch: m[2] as string, head: m[3] as string, base: m[4] as string, issueRev: m[5] as string, design: design === "无" ? null : design };
}

export function headerFor(pr: PrData, issue: IssueData, verdict: string, design: string | null, patch: PatchId): string {
  const v = parseVerdict(verdict);
  if (v === null) throw new UsageError("--result 只能是 PASS 或 FAIL");
  return renderHeader({ verdict: v, patch, head: pr.headRefOid, base: pr.baseRefName, issueRev: issue.bodyRev, design });
}

export type GateEntry = { readonly comment: Comment; readonly header: GateHeader; readonly stale: readonly string[] };

/** Every review verdict on the PR with the inputs that changed since it was given. A verdict is anchored to the patch it reviewed: HEAD moving (by rebase or by catching up with the base) never invalidates a PASS; only a changed patch does. */
export function gateEntries(pr: PrData, issue: IssueData, patch: PatchId): GateEntry[] {
  const out: GateEntry[] = [];
  for (const c of pr.comments) {
    const h = parseHeader(c.body);
    if (h === null) continue;
    const stale: string[] = [];
    if (h.base !== pr.baseRefName) stale.push(`base 已从 ${h.base} 变为 ${pr.baseRefName}`);
    if (h.patch !== patch) stale.push(`patch 已从 ${h.patch.slice(0, 7)} 变为 ${patch.slice(0, 7)}`);
    if (h.verdict.kind !== "pass" && h.issueRev !== issue.bodyRev) stale.push(`issue 正文已修订（${h.issueRev} → ${issue.bodyRev}）`);
    out.push({ comment: c, header: h, stale });
  }
  return out;
}

/** The newest still-valid review verdict, if any; a valid PASS locks in approval for the patch. */
export function latestValid(entries: readonly GateEntry[]): GateEntry | null {
  const valid = entries.filter((e) => e.stale.length === 0);
  return valid.filter((e) => e.header.verdict.kind === "pass").at(-1) ?? valid.at(-1) ?? null;
}
