// Evidence completeness: for every expected result and every step it owes, is there a record valid for the current inputs?

import { type Changes, type IssueData, mergeBaseRemote, type PrData } from "../github.ts";
import { type Checkout, changedFiles, checkoutAt, headOf, isAncestor, mergeBase } from "../git.ts";
import type { IssueBody, TypedOutcome } from "../issue.ts";
import { type Face, IMAGE_TYPES, type Kind } from "../model.ts";
import { parseRepo, type Repo, refKey, sameRepo } from "../ref.ts";
import { requirementFor, type StepRule } from "../requirements.ts";
import type { EvidenceRecord } from "./record.ts";

export type Mode =
  | { readonly kind: "pr"; readonly pr: PrData }
  /** `baseRef`: the remote branch the issue's PR will merge into (a tree child's buffer branch, else the default branch). */
  | { readonly kind: "local"; readonly checkout: Checkout; readonly baseRef: string }
  | { readonly kind: "integration"; readonly merges: readonly ChildMerge[] };

export type ChildMerge = { readonly child: string; readonly repo: Repo; readonly commit: string; readonly mergedAt: string };

export type StepStatus =
  | { readonly kind: "linked"; readonly record: EvidenceRecord }
  | { readonly kind: "stale"; readonly reason: string }
  | { readonly kind: "invalid"; readonly reason: string }
  | { readonly kind: "missing" };

export type OutcomeStatus = {
  readonly outcome: TypedOutcome;
  /** The face and template the evidence follows: those of the newest record for this wording, else the issue's own. */
  readonly face: Face;
  readonly kind: Kind;
  readonly steps: readonly { readonly rule: StepRule; readonly status: StepStatus }[];
  readonly overall: StepStatus["kind"];
  readonly orderProblem: string | null;
};

export type CheckResult = {
  readonly issue: IssueData;
  readonly outcomes: readonly OutcomeStatus[];
  /** Declared faces no result was observed through. */
  readonly unseenFaces: readonly Face[];
  readonly complete: boolean;
  /** Target commit per repo the evidence must sit on (empty for integration mode). */
  readonly heads: readonly { repo: Repo; head: string }[];
  readonly base: string | null;
};

type Anchors = { head: { repo: Repo; sha: string } | null; base: string | null; local: Checkout | null };

async function anchorsFor(mode: Mode): Promise<Anchors> {
  switch (mode.kind) {
    case "pr": {
      const repo = mode.pr.headRepo ?? mode.pr.ref.repo;
      return {
        head: { repo, sha: mode.pr.headRefOid },
        base: await mergeBaseRemote(mode.pr.ref.repo, mode.pr.baseRefOid, mode.pr.headRefOid),
        local: null,
      };
    }
    case "local": {
      const sha = await headOf(mode.checkout.path);
      return {
        head: { repo: mode.checkout.repo, sha },
        base: await mergeBase(mode.checkout.path, sha, mode.baseRef),
        local: mode.checkout,
      };
    }
    case "integration":
      return { head: null, base: null, local: null };
  }
}

async function localCheckout(path: string): Promise<Checkout | null> {
  return checkoutAt(path).catch(() => null);
}

/** How the target HEAD relates to the HEAD a record was taken on. */
type Drift =
  | { readonly kind: "diverged" }
  | { readonly kind: "docs-only" }
  | { readonly kind: "code"; readonly changes: Changes };

const isMarkdown = (path: string): boolean => path.toLowerCase().endsWith(".md");

/** Whether everything between the record's HEAD and the target HEAD is Markdown, so what the record observed still holds. */
async function driftSince(co: Checkout | null, repo: Repo, from: string, to: string): Promise<Drift> {
  if (!(await isAncestor(co, repo, from, to))) return { kind: "diverged" };
  const changes = await changedFiles(co, repo, from, to);
  return changes.kind === "all" && changes.files.every(isMarkdown) ? { kind: "docs-only" } : { kind: "code", changes };
}

function driftNote(d: Drift | null): string {
  if (d === null) return "";
  switch (d.kind) {
    case "diverged":
      return "；当前 HEAD 不是采集 HEAD 的后代";
    case "docs-only":
      return "";
    case "code": {
      const shown = d.changes.files.slice(0, 5).join(", ");
      return d.changes.files.length === 0 ? "" : `；之后改动 ${shown}${d.changes.files.length > 5 || d.changes.kind === "partial" ? " …" : ""}`;
    }
  }
}

/** Why the record is not valid for the current inputs, or null when it is. */
async function judge(r: EvidenceRecord, rule: StepRule, outcome: TypedOutcome, mode: Mode, a: Anchors): Promise<{ kind: "stale" | "invalid"; reason: string } | null> {
  if (r.capture.kind === "run" && r.capture.completion.kind !== "exited") {
    return { kind: "invalid", reason: r.capture.completion.kind === "timeout" ? "命令超时" : `命令被信号 ${r.capture.completion.signal} 终止` };
  }
  if (rule.needsImage && !r.attachments.some((x) => Object.values(IMAGE_TYPES).includes(x.contentType))) {
    return { kind: "invalid", reason: "缺截图" };
  }
  if (r.checkouts.some((c) => !c.cleanBefore)) return { kind: "invalid", reason: "采集前工作区不干净" };
  if (!takenFor(r, outcome)) return { kind: "stale", reason: `结果 ${outcome.id} 的文字在采集之后改过` };
  switch (mode.kind) {
    case "integration": {
      for (const m of mode.merges) {
        const co = r.checkouts.find((c) => {
          const repo = parseRepo(c.repo);
          return repo !== null && sameRepo(repo, m.repo);
        });
        if (co === undefined) return { kind: "stale", reason: `没有 ${m.repo.owner}/${m.repo.name} 的检出（${m.child}）` };
        if (!(await isAncestor(await localCheckout(co.path), m.repo, m.commit, co.head))) {
          return { kind: "stale", reason: `${m.repo.owner}/${m.repo.name}@${co.head.slice(0, 7)} 不含 ${m.child} 的合并提交` };
        }
        if (r.startedAt <= m.mergedAt) return { kind: "stale", reason: `采集早于 ${m.child} 合并` };
      }
      return null;
    }
    case "pr":
    case "local": {
      const head = a.head;
      if (head === null) return { kind: "invalid", reason: "没有目标 HEAD" };
      if (rule.anchor === "head") {
        if (r.checkouts.some((c) => c.head === head.sha)) return null;
        const co = r.checkouts.find((c) => {
          const repo = parseRepo(c.repo);
          return repo !== null && sameRepo(repo, head.repo);
        });
        const drift = co === undefined ? null : await driftSince(a.local ?? (await localCheckout(co.path)), head.repo, co.head, head.sha);
        if (drift?.kind === "docs-only") return null;
        const from = (co ?? r.checkouts[0])?.head ?? "?";
        return { kind: "stale", reason: `采于 ${from.slice(0, 7)}，当前 HEAD ${head.sha.slice(0, 7)}${driftNote(drift)}` };
      }
      const base = a.base;
      if (base === null) return { kind: "invalid", reason: "无法确定 base" };
      for (const c of r.checkouts) {
        const repo = parseRepo(c.repo);
        if (repo === null || !sameRepo(repo, head.repo)) continue;
        if (await isAncestor(await localCheckout(c.path), repo, c.head, base)) return null;
        return { kind: "stale", reason: `改动前的记录采于 ${c.head.slice(0, 7)}，不是 base ${base.slice(0, 7)} 或其祖先` };
      }
      return { kind: "stale", reason: "改动前的记录不是在本 repo 的检出上采集" };
    }
  }
}

/** The record covers this result as it is worded now. */
const takenFor = (r: EvidenceRecord, o: TypedOutcome): boolean => r.results.some((x) => x.id === o.id && x.digest === o.digest);

const newestFirst = (x: EvidenceRecord, y: EvidenceRecord): number => (x.startedAt < y.startedAt ? 1 : -1);

async function stepStatus(o: TypedOutcome, face: Face, kind: Kind, rule: StepRule, records: readonly EvidenceRecord[], mode: Mode, a: Anchors): Promise<StepStatus> {
  const candidates = records.filter((r) => r.results.some((x) => x.id === o.id) && r.step === rule.step && r.face === face && r.kind === kind).sort(newestFirst);
  let stale: string | null = null;
  let invalid: string | null = null;
  for (const r of candidates) {
    const v = await judge(r, rule, o, mode, a);
    if (v === null) return { kind: "linked", record: r };
    if (v.kind === "stale") stale ??= v.reason;
    else invalid ??= v.reason;
  }
  if (stale !== null) return { kind: "stale", reason: stale };
  if (invalid !== null) return { kind: "invalid", reason: invalid };
  return { kind: "missing" };
}

const RANK: Record<StepStatus["kind"], number> = { missing: 3, invalid: 2, stale: 1, linked: 0 };

export async function checkEvidence(
  issue: IssueData,
  body: Extract<IssueBody, { kind: "standard" | "integration" }>,
  records: readonly EvidenceRecord[],
  mode: Mode,
): Promise<CheckResult> {
  const a = await anchorsFor(mode);
  const outcomes: OutcomeStatus[] = [];
  const firstFace = body.scope.faces[0];
  for (const o of body.outcomes) {
    // The issue's kind tag is a reference: the collector's newest record for this wording says which template applies.
    const lead = records.filter((r) => takenFor(r, o)).sort(newestFirst)[0];
    const face = lead?.face ?? firstFace;
    if (face === undefined) continue; // no declared face: the issue fails lint and owes nothing checkable
    const kind = lead?.kind ?? o.kind;
    const req = requirementFor(face, kind);
    // The composed state has no single base to compare against, so integration results owe only head-anchored steps.
    const rules = mode.kind === "integration" ? req.steps.filter((s) => s.anchor === "head") : req.steps;
    const steps: { rule: StepRule; status: StepStatus }[] = [];
    for (const rule of rules) steps.push({ rule, status: await stepStatus(o, face, kind, rule, records, mode, a) });
    let orderProblem: string | null = null;
    if (req.ordered) {
      const linked = steps.flatMap((s) => (s.status.kind === "linked" ? [{ step: s.rule.step, at: s.status.record.startedAt }] : []));
      for (let i = 1; i < linked.length; i++) {
        const prev = linked[i - 1] as { step: string; at: string };
        const cur = linked[i] as { step: string; at: string };
        if (cur.at < prev.at) orderProblem ??= `${cur.step} 早于 ${prev.step}`;
      }
    }
    const worst = steps.reduce<StepStatus["kind"]>((acc, s) => (RANK[s.status.kind] > RANK[acc] ? s.status.kind : acc), "linked");
    outcomes.push({ outcome: o, face, kind, steps, overall: orderProblem !== null && worst === "linked" ? "invalid" : worst, orderProblem });
  }
  const unseenFaces = body.scope.faces.filter((f) => !outcomes.some((x) => x.face === f));
  return {
    issue,
    outcomes,
    unseenFaces,
    complete: outcomes.length > 0 && outcomes.length === body.outcomes.length && outcomes.every((x) => x.overall === "linked") && unseenFaces.length === 0,
    heads: a.head === null ? [] : [{ repo: a.head.repo, head: a.head.sha }],
    base: a.base,
  };
}

/** How a result's evidence deviates from the issue's tag, for display. */
export const kindNote = (x: OutcomeStatus): string => (x.kind === x.outcome.kind ? `[${x.kind}]` : `[${x.kind}]（issue 标 [${x.outcome.kind}]）`);

export function describe(r: CheckResult): string {
  const lines = [`${refKey(r.issue.ref)}：${r.outcomes.filter((x) => x.overall === "linked").length}/${r.outcomes.length} 条结果齐全`];
  for (const x of r.outcomes) {
    for (const s of x.steps) {
      const st = s.status;
      const detail = st.kind === "linked" ? `记录 ${st.record.id}` : st.kind === "missing" ? "没有记录" : st.reason;
      lines.push(`  结果 ${x.outcome.id} ${kindNote(x)} ${x.face} ${s.rule.step}: ${st.kind}（${detail}）`);
    }
    if (x.orderProblem !== null) lines.push(`  结果 ${x.outcome.id} 顺序错误：${x.orderProblem}`);
  }
  for (const f of r.unseenFaces) lines.push(`  面 ${f}：没有任何结果经它观察（采集时用 --face ${f}）`);
  return lines.join("\n");
}
