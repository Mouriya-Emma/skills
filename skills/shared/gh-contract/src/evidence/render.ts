// The evidence pack as a human-readable PR/issue comment, and its parser. One module owns both directions.

import { outcomesDigest } from "../issue.ts";
import { firstTable, parseDoc } from "../markdown.ts";
import { type Face, isFace, isKind, type Kind, templateOf } from "../model.ts";
import { isPatchId, type PatchId } from "../patch.ts";
import { parseRepo, type Repo, refKey, repoKey } from "../ref.ts";
import { isStep, type Step } from "../requirements.ts";
import { type CheckResult, type OutcomeStatus, proves, type StepStatus, outcomeVerdict } from "./check.ts";
import type { EvidenceRecord } from "./record.ts";

export const PACK_TITLE = "## 证据包";

export type PackStatus = "已记录" | "缺失" | "过期" | "无效";

export type PackRow =
  | {
      readonly shape: "steps";
      readonly result: number;
      readonly kind: Kind;
      readonly face: Face;
      readonly step: Step;
      readonly status: PackStatus;
      readonly command: string | null;
      readonly record: string;
    }
  | {
      readonly shape: "test";
      readonly result: number;
      readonly kind: Kind;
      readonly face: Face;
      readonly state: "success" | "deferred" | "pending" | "failure";
      readonly record: string;
    };

export type Pack = {
  readonly issue: string;
  /** Digest of the expected results' wording the pack was taken for. */
  readonly outcomesRev: string;
  readonly linked: number;
  readonly total: number;
  readonly unseenFaces: readonly Face[];
  readonly generatedAt: string;
  readonly heads: readonly { readonly repo: Repo; readonly head: string; readonly patchId: PatchId | null }[];
  readonly rows: readonly PackRow[];
};

const STATUS_TEXT: Record<StepStatus["kind"], PackStatus> = { linked: "已记录", missing: "缺失", stale: "过期", invalid: "无效" };

function recordText(s: StepStatus): string {
  switch (s.kind) {
    case "missing":
      return "没有记录";
    case "stale":
    case "invalid":
      return s.reason;
    case "linked": {
      const r = s.record;
      const images = r.attachments.length > 0 ? `截图 ${r.attachments.length} 张` : "";
      if (r.capture.kind === "attach") return images;
      const secs = ((Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000).toFixed(1);
      const c = r.capture.completion;
      const exit = c.kind === "exited" ? `exit ${c.code}` : c.kind;
      return [exit, `${secs}s`, images].filter((x) => x !== "").join(" · ");
    }
  }
}

const linkedRecords = (check: CheckResult): EvidenceRecord[] =>
  check.outcomes.flatMap((x) => (x.proof.kind === "records" ? x.proof.steps.flatMap((s) => (s.status.kind === "linked" ? [s.status.record] : [])) : []));

export function toPack(check: CheckResult, generatedAt: string): Pack {
  const rows: PackRow[] = [];
  for (const x of check.outcomes) {
    switch (x.proof.kind) {
      case "test":
        rows.push({
          shape: "test",
          result: x.outcome.id,
          kind: x.kind,
          face: x.face,
          state: x.proof.state,
          record: proves(x.proof.state) ? `由 test 检查证明（${x.proof.state}）` : `test 检查 ${x.proof.state}`,
        });
        break;
      case "records":
        for (const s of x.proof.steps) {
          const rec = s.status.kind === "linked" ? s.status.record : null;
          const misordered = x.proof.orderProblem !== null && s.status.kind === "linked";
          rows.push({
            shape: "steps",
            result: x.outcome.id,
            kind: x.kind,
            face: x.face,
            step: s.rule.step,
            status: misordered ? "无效" : STATUS_TEXT[s.status.kind],
            command: rec !== null && rec.capture.kind === "run" ? rec.capture.command : null,
            record: misordered ? `顺序错误：${x.proof.orderProblem}` : recordText(s.status),
          });
        }
        break;
    }
  }
  return {
    issue: refKey(check.issue.ref),
    outcomesRev: outcomesDigest(check.outcomes.map((x) => x.outcome)),
    linked: check.outcomes.filter((x) => outcomeVerdict(x) === "linked").length,
    total: check.outcomes.length,
    unseenFaces: check.unseenFaces,
    generatedAt,
    heads: check.heads.length > 0 ? check.heads : uniqueHeads(linkedRecords(check)),
    rows,
  };
}

function uniqueHeads(records: readonly EvidenceRecord[]): { repo: Repo; head: string; patchId: PatchId | null }[] {
  const out: { repo: Repo; head: string; patchId: PatchId | null }[] = [];
  for (const r of records) {
    for (const c of r.checkouts) {
      const repo = parseRepo(c.repo);
      if (repo !== null && !out.some((x) => repoKey(x.repo) === c.repo && x.head === c.head)) out.push({ repo, head: c.head, patchId: c.patchId });
    }
  }
  return out;
}

const cellCode = (s: string): string => `\`${s.replace(/\|/g, "\\|").replace(/`/g, "ˋ").replace(/\n/g, " ")}\``;
const cellText = (s: string): string => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const html = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = "`".repeat(longest + 1);
  return `${f}text\n${text}\n${f}`;
}

type Tail = { readonly text: string; readonly total: number; readonly shown: number; readonly cut: boolean };
export type RecordDetail = { readonly record: EvidenceRecord; readonly stdout: Tail; readonly stderr: Tail };

function renderDetail(d: RecordDetail): string {
  const r = d.record;
  const out: string[] = [];
  const results = `结果 ${r.results.map((x) => x.id).join("、")}`;
  if (r.capture.kind === "run") {
    const c = r.capture.completion;
    const exit = c.kind === "exited" ? `exit ${c.code}` : c.kind === "timeout" ? `超时 ${c.seconds}s` : `信号 ${c.signal}`;
    out.push(`<details><summary>${results} ${r.step} · ${exit} · <code>${html(r.capture.command)}</code></summary>`, "");
    const clean = r.checkouts.every((x) => x.cleanAfter) ? "工作区干净" : "运行后工作区有改动";
    out.push(`cwd \`${r.capture.cwd}\` · ${r.capture.shell} · ${r.startedAt} – ${r.endedAt} · ${clean} · 记录 \`${r.id}\``, "");
    for (const [name, t] of [["stdout", d.stdout], ["stderr", d.stderr]] as const) {
      if (t.total === 0) continue;
      const part = t.cut ? "末尾 1 行的末段" : `末尾 ${t.shown} 行`;
      const note = t.cut || t.shown < t.total ? `${part}，共 ${t.total} 行` : `共 ${t.total} 行`;
      out.push(`${name}（${note}）：`, "", fence(t.text), "");
    }
    out.push("</details>");
  } else {
    out.push(`<details><summary>${results} ${r.step} · 截图 ${r.attachments.length} 张</summary>`, "");
    out.push(`${r.startedAt} · 记录 \`${r.id}\``, "", "</details>");
  }
  return out.join("\n");
}

/** One result: its template, what each record lets a reviewer see, and the screenshots. */
function renderOutcome(x: OutcomeStatus): string[] {
  const out: string[] = ["", `### 结果 ${x.outcome.id} · ${templateOf(x.kind)} · ${x.face}`, "", `> ${x.outcome.text.replace(/\n/g, " ")}`, ""];
  if (x.kind !== x.outcome.kind) out.push(`issue 给这条结果标的是 [${x.outcome.kind}]，证据按 [${x.kind}] 采集。`, "");
  switch (x.proof.kind) {
    case "test":
      out.push(
        proves(x.proof.state)
          ? `- 由 PR 的 test 检查证明（${x.proof.state}）：对应测试随 PR 提交，见实现说明`
          : `- test 检查 ${x.proof.state}：未证明`,
      );
      return out;
    case "records": {
      for (const s of x.proof.steps) {
        const st = s.status;
        if (st.kind === "linked") {
          const head = st.record.checkouts[0]?.head.slice(0, 7) ?? "?";
          out.push(`- **${s.rule.step}**（\`${head}\`，记录 \`${st.record.id}\`）看点：${st.record.shows.replace(/\n/g, " ")}`);
        } else out.push(`- **${s.rule.step}**：${st.kind === "missing" ? "没有记录" : st.reason}`);
      }
      const withImages = x.proof.steps.flatMap((s) => (s.status.kind === "linked" && s.status.record.attachments.length > 0 ? [s.status.record] : []));
      if (withImages.length > 0) {
        out.push("");
        for (const r of withImages) for (const a of r.attachments) out.push(`<img width="480" src="${a.url}">`);
      }
      return out;
    }
  }
}

export function renderPack(pack: Pack, details: readonly RecordDetail[], check: CheckResult): string {
  const out: string[] = [PACK_TITLE, ""];
  const unseen = pack.unseenFaces.length === 0 ? "无" : pack.unseenFaces.join("、");
  out.push(`> 由 \`ghc\` 生成 · issue ${pack.issue} · 结果摘要 ${pack.outcomesRev} · ${pack.linked}/${pack.total} 条结果齐全 · 未观察的面 ${unseen} · 生成于 ${pack.generatedAt}`);
  const heads = pack.heads.map((h) => `${repoKey(h.repo)}@${h.head}${h.patchId === null ? "" : ` patch ${h.patchId}`}`).join(", ");
  out.push(`> 检出 ${heads || "无"}`, "");
  out.push("| 结果 | 类型 | 面 | 步骤 | 状态 | 命令 | 记录 |", "|---|---|---|---|---|---|---|");
  for (const r of pack.rows) {
    const command = r.shape === "steps" && r.command !== null ? cellCode(r.command) : "—";
    const step = r.shape === "steps" ? r.step : "—";
    const status = r.shape === "steps" ? r.status : proves(r.state) ? "测试证明" : "缺失";
    out.push(`| ${r.result} | ${r.kind} | ${r.face} | ${step} | ${status} | ${command} | ${cellText(r.record)} |`);
  }
  for (const x of check.outcomes) out.push(...renderOutcome(x));
  if (details.length > 0) out.push("", ...details.map((d) => renderDetail(d)).join("\n\n").split("\n"));
  return `${out.join("\n")}\n`;
}

const HEADER = /^> 由 `ghc` 生成 · issue (\S+) · 结果摘要 (\S+) · (\d+)\/(\d+) 条结果齐全 · 未观察的面 (\S+) · 生成于 (\S+)$/;
const STATUSES: readonly PackStatus[] = ["已记录", "缺失", "过期", "无效"];

function testRowState(status: string, record: string): "success" | "deferred" | "pending" | "failure" | null {
  if (status === "测试证明") {
    const m = /^由 test 检查证明（(success|deferred)）$/.exec(record)?.[1];
    return m === "success" || m === "deferred" ? m : null;
  }
  if (status === "缺失") {
    const m = /^test 检查 (pending|failure)$/.exec(record)?.[1];
    return m === "pending" || m === "failure" ? m : null;
  }
  return null;
}

/** Read a published evidence pack back; null when the comment is not one (or was edited out of shape). */
export function parsePack(text: string): Pack | null {
  const doc = parseDoc(text);
  const titleLine = doc.preamble.find((l) => l.text.trim() !== "");
  const sec = doc.sections[0];
  if (titleLine !== undefined || sec === undefined || `## ${sec.title}` !== PACK_TITLE) return null;
  const header = sec.lines.map((l) => HEADER.exec(l.text)).find((m) => m !== null);
  const checkoutLine = sec.lines.find((l) => l.text.startsWith("> 检出 "));
  if (header === undefined || header === null || checkoutLine === undefined) return null;
  const heads: { repo: Repo; head: string; patchId: PatchId | null }[] = [];
  const list = checkoutLine.text.slice("> 检出 ".length).trim();
  if (list !== "无") {
    for (const item of list.split(/,\s*/)) {
      const at = item.indexOf("@");
      if (at < 0) return null;
      const repo = parseRepo(item.slice(0, at));
      const [head, patchText] = item.slice(at + 1).split(" patch ") as [string, string | undefined];
      if (repo === null || !/^[0-9a-f]{40}$/.test(head)) return null;
      if (patchText !== undefined && !isPatchId(patchText)) return null;
      heads.push({ repo, head, patchId: patchText ?? null });
    }
  }
  const unseenText = header[5] as string;
  const unseenFaces: Face[] = [];
  if (unseenText !== "无") {
    for (const f of unseenText.split("、")) {
      if (!isFace(f)) return null;
      unseenFaces.push(f);
    }
  }
  const table = firstTable(sec.lines);
  if (table === null) return null;
  const rows: PackRow[] = [];
  for (const r of table.rows) {
    const [resultText, kindText, faceText, stepText, statusText, commandText, recordText] = r.cells as [string, string, string, string, string, string, string];
    const n = Number(resultText);
    if (!Number.isInteger(n) || !isKind(kindText) || !isFace(faceText)) return null;
    if (stepText === "—") {
      const state = testRowState(statusText, recordText);
      if (state === null) return null;
      rows.push({ shape: "test", result: n, kind: kindText, face: faceText, state, record: recordText });
      continue;
    }
    if (!isStep(stepText)) return null;
    const st = STATUSES.find((s) => s === statusText);
    if (st === undefined) return null;
    rows.push({
      shape: "steps",
      result: n,
      kind: kindText,
      face: faceText,
      step: stepText,
      status: st,
      command: commandText === "—" ? null : commandText.replace(/^`|`$/g, "").replace(/ˋ/g, "`"),
      record: recordText,
    });
  }
  return {
    issue: header[1] as string,
    outcomesRev: header[2] as string,
    linked: Number(header[3]),
    total: Number(header[4]),
    unseenFaces,
    generatedAt: header[6] as string,
    heads,
    rows,
  };
}

export const packComplete = (p: Pack): boolean =>
  p.total > 0 && p.linked === p.total && p.unseenFaces.length === 0 && p.rows.every((r) => (r.shape === "test" ? proves(r.state) : r.status === "已记录"));
