// Evidence completeness: for every expected result and every step it owes, is there a record valid for the current inputs?

import { type Changes, type Check, type IssueData, mergeBaseRemote, type PrData } from "../github.ts";
import { type Checkout, changedFiles, checkoutAt, headOf, isAncestor, mergeBase } from "../git.ts";
import type { IssueBody, TypedOutcome } from "../issue.ts";
import { type Face, IMAGE_TYPES, type Kind, proofOf } from "../model.ts";
import { localPatchId, type PatchId, prPatchId } from "../patch.ts";
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

/** The state of the PR's `test` check, the proof testable faces fall back to; a local check defers it to the PR. */
export type TestState = "success" | "pending" | "failure" | "absent" | "deferred";

export type Proof =
  | {
      readonly kind: "records";
      readonly steps: readonly { readonly rule: StepRule; readonly status: StepStatus }[];
      readonly orderProblem: string | null;
    }
  | { readonly kind: "test"; readonly state: "success" | "pending" | "failure" | "deferred" };

export type OutcomeStatus = {
  readonly outcome: TypedOutcome;
  /** The face and template the evidence follows: those of the newest record for this wording, else the issue's own. */
  readonly face: Face;
  readonly kind: Kind;
  readonly proof: Proof;
};

export type CheckResult = {
  readonly issue: IssueData;
  readonly outcomes: readonly OutcomeStatus[];
  /** Declared faces no result was observed through. */
  readonly unseenFaces: readonly Face[];
  readonly complete: boolean;
  /** The patch of the target the evidence is checked against; null for integration mode or when it cannot be computed. */
  readonly patch: PatchId | null;
  /** Target commit and patch per repo the evidence must sit on (empty for integration mode). */
  readonly heads: readonly { readonly repo: Repo; readonly head: string; readonly patchId: PatchId | null }[];
  readonly base: string | null;
};

type Facts = { head: { repo: Repo; sha: string } | null; base: string | null; local: Checkout | null; patch: PatchId | null };

/** A PR's patch and merge base, resolved by the caller so the same check runs without reading GitHub. */
export type TargetFacts = { readonly patch: PatchId; readonly base: string | null };

async function factsFor(mode: Mode, target: TargetFacts | undefined): Promise<Facts> {
  switch (mode.kind) {
    case "pr": {
      const repo = mode.pr.headRepo ?? mode.pr.ref.repo;
      return {
        head: { repo, sha: mode.pr.headRefOid },
        base: target === undefined ? await mergeBaseRemote(mode.pr.ref.repo, mode.pr.baseRefOid, mode.pr.headRefOid) : target.base,
        local: null,
        patch: target === undefined ? await prPatchId(mode.pr.ref) : target.patch,
      };
    }
    case "local": {
      const sha = await headOf(mode.checkout.path);
      let patch: PatchId | null;
      try {
        patch = await localPatchId(mode.checkout.path, mode.baseRef);
      } catch {
        patch = null;
      }
      return {
        head: { repo: mode.checkout.repo, sha },
        base: await mergeBase(mode.checkout.path, sha, mode.baseRef),
        local: mode.checkout,
        patch,
      };
    }
    case "integration":
      return { head: null, base: null, local: null, patch: null };
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
async function judge(r: EvidenceRecord, rule: StepRule, outcome: TypedOutcome, mode: Mode, a: Facts): Promise<{ kind: "stale" | "invalid"; reason: string } | null> {
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
      if (r.checkouts.some((c) => c.head === head.sha)) return null;
      const co = r.checkouts.find((c) => {
        const repo = parseRepo(c.repo);
        return repo !== null && sameRepo(repo, head.repo);
      });
      if (co !== undefined && co.patchId !== null && a.patch !== null && co.patchId === a.patch) return null;
      const drift = co === undefined ? null : await driftSince(a.local ?? (await localCheckout(co.path)), head.repo, co.head, head.sha);
      if (drift?.kind === "docs-only") return null;
      if (co !== undefined && co.patchId !== null && a.patch !== null) {
        return { kind: "stale", reason: `patch 已从 ${co.patchId.slice(0, 7)} 变为 ${a.patch.slice(0, 7)}${driftNote(drift)}` };
      }
      const from = (co ?? r.checkouts[0])?.head ?? "?";
      return { kind: "stale", reason: `采于 ${from.slice(0, 7)}，当前 HEAD ${head.sha.slice(0, 7)}${driftNote(drift)}` };
    }
  }
}

/** The record covers this result as it is worded now. */
const takenFor = (r: EvidenceRecord, o: TypedOutcome): boolean => r.results.some((x) => x.id === o.id && x.digest === o.digest);

const newestFirst = (x: EvidenceRecord, y: EvidenceRecord): number => (x.startedAt < y.startedAt ? 1 : -1);

async function stepStatus(o: TypedOutcome, face: Face, kind: Kind, rule: StepRule, records: readonly EvidenceRecord[], mode: Mode, a: Facts): Promise<StepStatus> {
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

/** The face the `test` check proves a result through: testable faces when its state can satisfy them. */
type TestProof = "success" | "pending" | "failure" | "deferred" | "records";

function testProofOf(face: Face, test: TestState, integration: boolean): TestProof {
  if (integration) return "records";
  switch (proofOf(face)) {
    case "external":
      return "records";
    case "testable":
      switch (test) {
        case "success":
          return "success";
        case "deferred":
          return "deferred";
        case "pending":
          return "pending";
        case "failure":
          return "failure";
        case "absent":
          return "records";
      }
  }
}

function testStateOf(checks: readonly Check[]): TestState {
  const named = checks.filter((c) => c.name === "test");
  if (named.length === 0) return "absent";
  if (named.some((c) => c.state === "failure")) return "failure";
  if (named.some((c) => c.state === "pending")) return "pending";
  return "success";
}

export async function checkEvidence(
  issue: IssueData,
  body: Extract<IssueBody, { kind: "standard" | "integration" }>,
  records: readonly EvidenceRecord[],
  mode: Mode,
  target?: TargetFacts,
): Promise<CheckResult> {
  const a = await factsFor(mode, target);
  const integration = mode.kind === "integration";
  const test: TestState = integration ? "absent" : mode.kind === "pr" ? testStateOf(mode.pr.checks) : "deferred";
  const fallbackFace = body.scope.faces.find((f) => proofOf(f) === "testable") ?? body.scope.faces[0];
  const outcomes: OutcomeStatus[] = [];
  for (const o of body.outcomes) {
    // The issue's kind tag is a reference: the collector's newest record for this wording says which template applies.
    const lead = records.filter((r) => takenFor(r, o)).sort(newestFirst)[0];
    const face = lead?.face ?? fallbackFace;
    if (face === undefined) continue; // no declared face: the issue fails lint and owes nothing checkable
    const kind = lead?.kind ?? o.kind;
    const testProof = testProofOf(face, test, integration);
    switch (testProof) {
      case "success":
      case "deferred":
      case "pending":
      case "failure":
        outcomes.push({ outcome: o, face, kind, proof: { kind: "test", state: testProof } });
        break;
      case "records": {
        const req = requirementFor(face);
        const steps: { rule: StepRule; status: StepStatus }[] = [];
        for (const rule of req.steps) steps.push({ rule, status: await stepStatus(o, face, kind, rule, records, mode, a) });
        let orderProblem: string | null = null;
        if (req.ordered) {
          const linked = steps.flatMap((s) => (s.status.kind === "linked" ? [{ step: s.rule.step, at: s.status.record.startedAt }] : []));
          for (let i = 1; i < linked.length; i++) {
            const prev = linked[i - 1] as { step: string; at: string };
            const cur = linked[i] as { step: string; at: string };
            if (cur.at < prev.at) orderProblem ??= `${cur.step} 早于 ${prev.step}`;
          }
        }
        outcomes.push({ outcome: o, face, kind, proof: { kind: "records", steps, orderProblem } });
        break;
      }
    }
  }
  const unseenFaces = body.scope.faces.filter((f) => (proofOf(f) === "external" || test === "absent") && !outcomes.some((x) => x.face === f));
  return {
    issue,
    outcomes,
    unseenFaces,
    complete: outcomes.length > 0 && outcomes.length === body.outcomes.length && outcomes.every((x) => outcomeVerdict(x) === "linked") && unseenFaces.length === 0,
    patch: a.patch,
    heads: a.head === null ? [] : [{ repo: a.head.repo, head: a.head.sha, patchId: a.patch }],
    base: a.base,
  };
}

/** Whether the `test` check's state proves a testable result. */
export function proves(state: "success" | "deferred" | "pending" | "failure"): boolean {
  switch (state) {
    case "success":
    case "deferred":
      return true;
    case "pending":
    case "failure":
      return false;
  }
}

/** The verdict for one result: linked when records or the test check prove it. */
export function outcomeVerdict(x: OutcomeStatus): StepStatus["kind"] {
  switch (x.proof.kind) {
    case "test":
      return proves(x.proof.state) ? "linked" : "invalid";
    case "records": {
      const worst = x.proof.steps.reduce<StepStatus["kind"]>((acc, s) => (RANK[s.status.kind] > RANK[acc] ? s.status.kind : acc), "linked");
      return x.proof.orderProblem !== null && worst === "linked" ? "invalid" : worst;
    }
  }
}

/** How a result's evidence deviates from the issue's tag, for display. */
export const kindNote = (x: OutcomeStatus): string => (x.kind === x.outcome.kind ? `[${x.kind}]` : `[${x.kind}]（issue 标 [${x.outcome.kind}]）`);

export function describe(r: CheckResult): string {
  const lines = [`${refKey(r.issue.ref)}：${r.outcomes.filter((x) => outcomeVerdict(x) === "linked").length}/${r.outcomes.length} 条结果齐全`];
  for (const x of r.outcomes) {
    switch (x.proof.kind) {
      case "test":
        switch (x.proof.state) {
          case "success":
          case "deferred":
            lines.push(`  结果 ${x.outcome.id} ${kindNote(x)} ${x.face}: 由 test 检查证明（${x.proof.state}）`);
            break;
          case "pending":
          case "failure":
            lines.push(`  结果 ${x.outcome.id} ${kindNote(x)} ${x.face}: test 检查 ${x.proof.state}，未证明`);
            break;
        }
        break;
      case "records": {
        for (const s of x.proof.steps) {
          const st = s.status;
          const detail = st.kind === "linked" ? `记录 ${st.record.id}` : st.kind === "missing" ? "没有记录" : st.reason;
          lines.push(`  结果 ${x.outcome.id} ${kindNote(x)} ${x.face} ${s.rule.step}: ${st.kind}（${detail}）`);
        }
        if (x.proof.orderProblem !== null) lines.push(`  结果 ${x.outcome.id} 顺序错误：${x.proof.orderProblem}`);
        break;
      }
    }
  }
  for (const f of r.unseenFaces) lines.push(`  面 ${f}：没有任何结果经它观察（采集时用 --face ${f}）`);
  return lines.join("\n");
}
