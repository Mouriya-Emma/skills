// Evidence completeness: for every acceptance row and every step it owes, is there a record valid for the current inputs?

import { type IssueData, mergeBaseRemote, type PrData } from "../github.ts";
import { type Checkout, changedFiles, checkoutAt, headOf, isAncestor, mergeBase } from "../git.ts";
import type { IssueBody, Row } from "../issue.ts";
import { type Form, IMAGE_TYPES } from "../model.ts";
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

export type RowStatus = {
  readonly row: Row;
  readonly steps: readonly { readonly rule: StepRule; readonly status: StepStatus }[];
  readonly overall: StepStatus["kind"];
  readonly orderProblem: string | null;
};

export type CheckResult = {
  readonly issue: IssueData;
  readonly rows: readonly RowStatus[];
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

/** Why the record is not valid for the current inputs, or null when it is. */
async function judge(r: EvidenceRecord, rule: StepRule, issue: IssueData, mode: Mode, a: Anchors): Promise<{ kind: "stale" | "invalid"; reason: string } | null> {
  if (r.capture.kind === "run" && r.capture.completion.kind !== "exited") {
    return { kind: "invalid", reason: r.capture.completion.kind === "timeout" ? "命令超时" : `命令被信号 ${r.capture.completion.signal} 终止` };
  }
  if (rule.needsImage && !r.attachments.some((x) => Object.values(IMAGE_TYPES).includes(x.contentType))) {
    return { kind: "invalid", reason: "缺截图" };
  }
  if (r.checkouts.some((c) => !c.cleanBefore)) return { kind: "invalid", reason: "采集前工作区不干净" };
  if (r.issueRev !== issue.bodyRev) return { kind: "stale", reason: `issue 正文已修订（记录对应 ${r.issueRev}）` };
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
        const from = r.checkouts[0]?.head ?? "?";
        const changed = a.local === null ? [] : await changedFiles(a.local.path, from, head.sha);
        const tailNote = changed.length === 0 ? "" : `；之后改动 ${changed.slice(0, 5).join(", ")}${changed.length > 5 ? " …" : ""}`;
        return { kind: "stale", reason: `采于 ${from.slice(0, 7)}，当前 HEAD ${head.sha.slice(0, 7)}${tailNote}` };
      }
      const base = a.base;
      if (base === null) return { kind: "invalid", reason: "无法确定 base" };
      for (const c of r.checkouts) {
        const repo = parseRepo(c.repo);
        if (repo === null || !sameRepo(repo, head.repo)) continue;
        if (await isAncestor(await localCheckout(c.path), repo, c.head, base)) return null;
        return { kind: "stale", reason: `改动前截图采于 ${c.head.slice(0, 7)}，不是 base ${base.slice(0, 7)} 或其祖先` };
      }
      return { kind: "stale", reason: "改动前截图不是在本 repo 的检出上采集" };
    }
  }
}

async function stepStatus(row: Row, rule: StepRule, records: readonly EvidenceRecord[], issue: IssueData, mode: Mode, a: Anchors): Promise<StepStatus> {
  const candidates = records.filter((r) => r.rows.includes(row.id) && r.step === rule.step).sort((x, y) => (x.startedAt < y.startedAt ? 1 : -1));
  let stale: string | null = null;
  let invalid: string | null = null;
  for (const r of candidates) {
    const v = await judge(r, rule, issue, mode, a);
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
  const form: Form = body.kind === "standard" ? body.form : "e2e";
  const a = await anchorsFor(mode);
  const rows: RowStatus[] = [];
  for (const row of body.rows) {
    const req = requirementFor(row.face, form);
    // The composed state has no single base to compare against, so integration rows owe only head-anchored steps.
    const rules = mode.kind === "integration" ? req.steps.filter((s) => s.anchor === "head") : req.steps;
    const steps: { rule: StepRule; status: StepStatus }[] = [];
    for (const rule of rules) steps.push({ rule, status: await stepStatus(row, rule, records, issue, mode, a) });
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
    rows.push({ row, steps, overall: orderProblem !== null && worst === "linked" ? "invalid" : worst, orderProblem });
  }
  return {
    issue,
    rows,
    complete: rows.length > 0 && rows.every((r) => r.overall === "linked"),
    heads: a.head === null ? [] : [{ repo: a.head.repo, head: a.head.sha }],
    base: a.base,
  };
}

export function describe(r: CheckResult): string {
  const lines = [`${refKey(r.issue.ref)}：${r.rows.filter((x) => x.overall === "linked").length}/${r.rows.length} 行齐全`];
  for (const row of r.rows) {
    for (const s of row.steps) {
      const st = s.status;
      const detail =
        st.kind === "linked" ? `记录 ${st.record.id}` : st.kind === "missing" ? "没有记录" : st.reason;
      lines.push(`  #${row.row.id} ${row.row.face} ${s.rule.step}: ${st.kind}（${detail}）`);
    }
    if (row.orderProblem !== null) lines.push(`  #${row.row.id} 顺序错误：${row.orderProblem}`);
  }
  return lines.join("\n");
}
