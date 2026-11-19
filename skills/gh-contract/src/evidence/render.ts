// The evidence pack as a human-readable PR/issue comment, and its parser. One module owns both directions.

import { outcomesDigest } from "../issue.ts";
import { firstTable, parseDoc } from "../markdown.ts";
import { type Face, isFace, isKind, type Kind, templateOf } from "../model.ts";
import { parseRepo, type Repo, refKey, repoKey } from "../ref.ts";
import { isStep, type Step } from "../requirements.ts";
import type { CheckResult, OutcomeStatus, StepStatus } from "./check.ts";
import type { EvidenceRecord } from "./record.ts";

export const PACK_TITLE = "## 证据包";

export type PackStatus = "已记录" | "缺失" | "过期" | "无效";

export type PackRow = {
  readonly result: number;
  readonly kind: Kind;
  readonly face: Face;
  readonly step: Step;
  readonly status: PackStatus;
  readonly command: string | null;
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
  readonly heads: readonly { repo: Repo; head: string }[];
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
  check.outcomes.flatMap((x) => x.steps.flatMap((s) => (s.status.kind === "linked" ? [s.status.record] : [])));

export function toPack(check: CheckResult, generatedAt: string): Pack {
  const rows: PackRow[] = [];
  for (const x of check.outcomes) {
    for (const s of x.steps) {
      const rec = s.status.kind === "linked" ? s.status.record : null;
      const misordered = x.orderProblem !== null && s.status.kind === "linked";
      rows.push({
        result: x.outcome.id,
        kind: x.kind,
        face: x.face,
        step: s.rule.step,
        status: misordered ? "无效" : STATUS_TEXT[s.status.kind],
        command: rec !== null && rec.capture.kind === "run" ? rec.capture.command : null,
        record: misordered ? `顺序错误：${x.orderProblem}` : recordText(s.status),
      });
    }
  }
  return {
    issue: refKey(check.issue.ref),
    outcomesRev: outcomesDigest(check.outcomes.map((x) => x.outcome)),
    linked: check.outcomes.filter((x) => x.overall === "linked").length,
    total: check.outcomes.length,
    unseenFaces: check.unseenFaces,
    generatedAt,
    heads: check.heads.length > 0 ? check.heads : uniqueHeads(linkedRecords(check)),
    rows,
  };
}

function uniqueHeads(records: readonly EvidenceRecord[]): { repo: Repo; head: string }[] {
  const out: { repo: Repo; head: string }[] = [];
  for (const r of records) {
    for (const c of r.checkouts) {
      const repo = parseRepo(c.repo);
      if (repo !== null && !out.some((x) => repoKey(x.repo) === c.repo && x.head === c.head)) out.push({ repo, head: c.head });
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

const WHEN: Record<"base" | "head", string> = { base: "改动前", head: "改动后" };

/** One result: its template, what each record lets a reviewer see, and the screenshots. */
function renderOutcome(x: OutcomeStatus): string[] {
  const out: string[] = ["", `### 结果 ${x.outcome.id} · ${templateOf(x.kind)} · ${x.face}`, "", `> ${x.outcome.text.replace(/\n/g, " ")}`, ""];
  if (x.kind !== x.outcome.kind) out.push(`issue 给这条结果标的是 [${x.outcome.kind}]，证据按 [${x.kind}] 采集。`, "");
  for (const s of x.steps) {
    const st = s.status;
    const label = `**${WHEN[s.rule.anchor]} · ${s.rule.step}**`;
    if (st.kind === "linked") {
      const head = st.record.checkouts[0]?.head.slice(0, 7) ?? "?";
      out.push(`- ${label}（\`${head}\`，记录 \`${st.record.id}\`）看点：${st.record.shows.replace(/\n/g, " ")}`);
    } else out.push(`- ${label}：${st.kind === "missing" ? "没有记录" : st.reason}`);
  }
  const withImages = x.steps.flatMap((s) => (s.status.kind === "linked" && s.status.record.attachments.length > 0 ? [{ rule: s.rule, record: s.status.record }] : []));
  const before = withImages.find((l) => l.rule.anchor === "base");
  const after = withImages.find((l) => l.rule.anchor === "head");
  if (before !== undefined && after !== undefined && withImages.length === 2) {
    const bh = before.record.checkouts[0]?.head.slice(0, 7) ?? "?";
    const ah = after.record.checkouts[0]?.head.slice(0, 7) ?? "?";
    out.push("", `| 改动前（\`${bh}\`） | 改动后（\`${ah}\`） |`, "|---|---|");
    const n = Math.max(before.record.attachments.length, after.record.attachments.length);
    for (let i = 0; i < n; i++) {
      const b = before.record.attachments[i];
      const a = after.record.attachments[i];
      out.push(`| ${b === undefined ? "" : `<img width="360" src="${b.url}">`} | ${a === undefined ? "" : `<img width="360" src="${a.url}">`} |`);
    }
  } else if (withImages.length > 0) {
    out.push("");
    for (const l of withImages) for (const a of l.record.attachments) out.push(`<img width="480" src="${a.url}">`);
  }
  return out;
}

export function renderPack(pack: Pack, details: readonly RecordDetail[], check: CheckResult): string {
  const out: string[] = [PACK_TITLE, ""];
  const unseen = pack.unseenFaces.length === 0 ? "无" : pack.unseenFaces.join("、");
  out.push(`> 由 \`ghc\` 生成 · issue ${pack.issue} · 结果摘要 ${pack.outcomesRev} · ${pack.linked}/${pack.total} 条结果齐全 · 未观察的面 ${unseen} · 生成于 ${pack.generatedAt}`);
  out.push(`> 检出 ${pack.heads.map((h) => `${repoKey(h.repo)}@${h.head}`).join(", ") || "无"}`, "");
  out.push("| 结果 | 类型 | 面 | 步骤 | 状态 | 命令 | 记录 |", "|---|---|---|---|---|---|---|");
  for (const r of pack.rows) {
    out.push(`| ${r.result} | ${r.kind} | ${r.face} | ${r.step} | ${r.status} | ${r.command === null ? "—" : cellCode(r.command)} | ${cellText(r.record)} |`);
  }
  for (const x of check.outcomes) out.push(...renderOutcome(x));
  if (details.length > 0) out.push("", ...details.map((d) => renderDetail(d)).join("\n\n").split("\n"));
  return `${out.join("\n")}\n`;
}

const HEADER = /^> 由 `ghc` 生成 · issue (\S+) · 结果摘要 (\S+) · (\d+)\/(\d+) 条结果齐全 · 未观察的面 (\S+) · 生成于 (\S+)$/;
const STATUSES: readonly PackStatus[] = ["已记录", "缺失", "过期", "无效"];

/** Read a published evidence pack back; null when the comment is not one (or was edited out of shape). */
export function parsePack(text: string): Pack | null {
  const doc = parseDoc(text);
  const titleLine = doc.preamble.find((l) => l.text.trim() !== "");
  const sec = doc.sections[0];
  if (titleLine !== undefined || sec === undefined || `## ${sec.title}` !== PACK_TITLE) return null;
  const header = sec.lines.map((l) => HEADER.exec(l.text)).find((m) => m !== null);
  const checkoutLine = sec.lines.find((l) => l.text.startsWith("> 检出 "));
  if (header === undefined || header === null || checkoutLine === undefined) return null;
  const heads: { repo: Repo; head: string }[] = [];
  const list = checkoutLine.text.slice("> 检出 ".length).trim();
  if (list !== "无") {
    for (const item of list.split(/,\s*/)) {
      const [repoText, head] = item.split("@") as [string, string | undefined];
      const repo = parseRepo(repoText);
      if (repo === null || head === undefined || !/^[0-9a-f]{40}$/.test(head)) return null;
      heads.push({ repo, head });
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
    const [resultText, kind, face, step, status, command, record] = r.cells as [string, string, string, string, string, string, string];
    const n = Number(resultText);
    if (!Number.isInteger(n) || !isKind(kind) || !isFace(face) || !isStep(step)) return null;
    const st = STATUSES.find((s) => s === status);
    if (st === undefined) return null;
    rows.push({ result: n, kind, face, step, status: st, command: command === "—" ? null : command.replace(/^`|`$/g, "").replace(/ˋ/g, "`"), record });
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
  p.total > 0 && p.linked === p.total && p.unseenFaces.length === 0 && p.rows.every((r) => r.status === "已记录");
