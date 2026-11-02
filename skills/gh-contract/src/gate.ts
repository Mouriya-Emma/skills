// Gate verdict comments: a fixed first line names the inputs the verdict observed; validity is recomputed from live inputs.

import type { Comment, IssueData, PrData } from "./github.ts";
import { UsageError } from "./proc.ts";

export const GATE_KINDS = ["review", "验收"] as const;
export type GateKind = (typeof GATE_KINDS)[number];

export type Verdict =
  | { readonly kind: "pass" }
  | { readonly kind: "fail"; readonly gate: number }
  | { readonly kind: "not-accepted" };

export type GateHeader = {
  readonly gate: GateKind;
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
      return `FAIL@Gate${v.gate}`;
    case "not-accepted":
      return "NOT ACCEPTED";
  }
}

export function parseVerdict(text: string): Verdict | null {
  if (text === "PASS") return { kind: "pass" };
  if (text === "NOT ACCEPTED") return { kind: "not-accepted" };
  const m = /^FAIL@Gate([1-6])$/.exec(text);
  return m === null ? null : { kind: "fail", gate: Number(m[1]) };
}

export function renderHeader(h: GateHeader): string {
  return `Gate 结论 · ${h.gate} · ${verdictText(h.verdict)} · HEAD ${h.head} · base ${h.base} · issue rev ${h.issueRev} · 设计 ${h.design ?? "无"}`;
}

const HEADER = /^Gate 结论 · (review|验收) · (PASS|NOT ACCEPTED|FAIL@Gate[1-6]) · HEAD ([0-9a-f]{40}) · base (\S+) · issue rev (\S+) · 设计 (.+)$/;

export function parseHeader(body: string): GateHeader | null {
  const first = body.split(/\r?\n/).find((l) => l.trim() !== "")?.trim();
  if (first === undefined) return null;
  const m = HEADER.exec(first);
  if (m === null) return null;
  const verdict = parseVerdict(m[2] as string);
  if (verdict === null) return null;
  const design = (m[6] as string).trim();
  return {
    gate: m[1] === "review" ? "review" : "验收",
    verdict,
    head: m[3] as string,
    base: m[4] as string,
    issueRev: m[5] as string,
    design: design === "无" ? null : design,
  };
}

export function headerFor(pr: PrData, issue: IssueData, gate: string, verdict: string, design: string | null): string {
  const g = GATE_KINDS.find((k) => k === gate);
  if (g === undefined) throw new UsageError(`--kind 只能是 ${GATE_KINDS.join(" 或 ")}`);
  const v = parseVerdict(verdict);
  if (v === null) throw new UsageError("--result 只能是 PASS、FAIL@GateN 或 NOT ACCEPTED");
  return renderHeader({ gate: g, verdict: v, head: pr.headRefOid, base: pr.baseRefName, issueRev: issue.bodyRev, design });
}

export type GateEntry = { readonly comment: Comment; readonly header: GateHeader; readonly stale: readonly string[] };

/** Every gate verdict on the PR with the inputs that changed since it was given. */
export function gateEntries(pr: PrData, issue: IssueData): GateEntry[] {
  const out: GateEntry[] = [];
  for (const c of pr.comments) {
    const h = parseHeader(c.body);
    if (h === null) continue;
    const stale: string[] = [];
    if (h.head !== pr.headRefOid) stale.push(`HEAD 已从 ${h.head.slice(0, 7)} 变为 ${pr.headRefOid.slice(0, 7)}`);
    if (h.base !== pr.baseRefName) stale.push(`base 已从 ${h.base} 变为 ${pr.baseRefName}`);
    if (h.issueRev !== issue.bodyRev) stale.push(`issue 正文已修订（${h.issueRev} → ${issue.bodyRev}）`);
    out.push({ comment: c, header: h, stale });
  }
  return out;
}

/** The newest still-valid verdict of a gate kind, if any. */
export function latestValid(entries: readonly GateEntry[], gate: GateKind): GateEntry | null {
  const valid = entries.filter((e) => e.header.gate === gate && e.stale.length === 0);
  return valid.at(-1) ?? null;
}
