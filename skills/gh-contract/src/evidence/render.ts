// The evidence pack as a human-readable PR/issue comment, and its parser. One module owns both directions.

import { firstTable, parseDoc } from "../markdown.ts";
import { type Face, isFace, isRole, type Role } from "../model.ts";
import { parseRepo, type Repo, refKey, repoKey } from "../ref.ts";
import { isStep, type Step } from "../requirements.ts";
import type { CheckResult, StepStatus } from "./check.ts";
import type { EvidenceRecord } from "./record.ts";

export const PACK_TITLE = "## 证据包";

export type PackStatus = "已记录" | "缺失" | "过期" | "无效";

export type PackRow = {
  readonly row: number;
  readonly face: Face;
  readonly covers: readonly number[];
  readonly role: Role;
  readonly step: Step;
  readonly status: PackStatus;
  readonly command: string | null;
  readonly result: string;
};

export type Pack = {
  readonly issue: string;
  readonly issueRev: string;
  readonly linked: number;
  readonly total: number;
  readonly generatedAt: string;
  readonly heads: readonly { repo: Repo; head: string }[];
  readonly rows: readonly PackRow[];
};

const STATUS_TEXT: Record<StepStatus["kind"], PackStatus> = { linked: "已记录", missing: "缺失", stale: "过期", invalid: "无效" };

function resultText(s: StepStatus): string {
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

export function toPack(check: CheckResult, generatedAt: string): Pack {
  const rows: PackRow[] = [];
  for (const r of check.rows) {
    for (const s of r.steps) {
      const rec = s.status.kind === "linked" ? s.status.record : null;
      rows.push({
        row: r.row.id,
        face: r.row.face,
        covers: r.row.covers,
        role: r.row.role,
        step: s.rule.step,
        status: r.orderProblem !== null && s.status.kind === "linked" ? "无效" : STATUS_TEXT[s.status.kind],
        command: rec !== null && rec.capture.kind === "run" ? rec.capture.command : null,
        result: r.orderProblem !== null && s.status.kind === "linked" ? `顺序错误：${r.orderProblem}` : resultText(s.status),
      });
    }
  }
  const heads =
    check.heads.length > 0
      ? check.heads
      : uniqueHeads(check.rows.flatMap((r) => r.steps.flatMap((s) => (s.status.kind === "linked" ? [s.status.record] : []))));
  return {
    issue: refKey(check.issue.ref),
    issueRev: check.issue.bodyRev,
    linked: check.rows.filter((r) => r.overall === "linked").length,
    total: check.rows.length,
    generatedAt,
    heads,
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

export type RecordDetail = { readonly record: EvidenceRecord; readonly stdout: { text: string; total: number }; readonly stderr: { text: string; total: number } };

function renderDetail(d: RecordDetail, tailLines: number): string {
  const r = d.record;
  const out: string[] = [];
  const rows = `#${r.rows.join(" #")}`;
  if (r.capture.kind === "run") {
    const c = r.capture.completion;
    const exit = c.kind === "exited" ? `exit ${c.code}` : c.kind === "timeout" ? `超时 ${c.seconds}s` : `信号 ${c.signal}`;
    out.push(`<details><summary>${rows} ${r.step} · ${exit} · <code>${html(r.capture.command)}</code></summary>`, "");
    const clean = r.checkouts.every((x) => x.cleanAfter) ? "工作区干净" : "运行后工作区有改动";
    out.push(`cwd \`${r.capture.cwd}\` · ${r.capture.shell} · ${r.startedAt} – ${r.endedAt} · ${clean} · 记录 \`${r.id}\``, "");
    for (const [name, t] of [["stdout", d.stdout], ["stderr", d.stderr]] as const) {
      if (t.total === 0) continue;
      const note = t.total > tailLines ? `末尾 ${tailLines} 行，共 ${t.total} 行` : `共 ${t.total} 行`;
      out.push(`${name}（${note}）：`, "", fence(t.text), "");
    }
    out.push("</details>");
  } else {
    out.push(`<details><summary>${rows} ${r.step} · 截图 ${r.attachments.length} 张</summary>`, "");
    out.push(`${r.startedAt} · 记录 \`${r.id}\``, "", "</details>");
  }
  return out.join("\n");
}

function renderImages(check: CheckResult): string[] {
  const out: string[] = [];
  for (const r of check.rows) {
    const linked = r.steps.flatMap((s) => (s.status.kind === "linked" ? [{ step: s.rule.step, record: s.status.record }] : []));
    const withImages = linked.filter((l) => l.record.attachments.length > 0);
    if (withImages.length === 0) continue;
    out.push("", `#${r.row.id} ${r.row.role} · ${r.row.covers.map((c) => `结果 ${c}`).join("、") || "卫生"} · ${r.row.face}`, "");
    const before = withImages.find((l) => l.step === "before");
    const after = withImages.find((l) => l.step === "after");
    if (before !== undefined && after !== undefined) {
      const bh = before.record.checkouts[0]?.head.slice(0, 7) ?? "?";
      const ah = after.record.checkouts[0]?.head.slice(0, 7) ?? "?";
      out.push(`| 改动前（\`${bh}\`） | 改动后（\`${ah}\`） |`, "|---|---|");
      const n = Math.max(before.record.attachments.length, after.record.attachments.length);
      for (let i = 0; i < n; i++) {
        const b = before.record.attachments[i];
        const a = after.record.attachments[i];
        out.push(`| ${b === undefined ? "" : `<img width="360" src="${b.url}">`} | ${a === undefined ? "" : `<img width="360" src="${a.url}">`} |`);
      }
    } else {
      for (const l of withImages) for (const a of l.record.attachments) out.push(`<img width="480" src="${a.url}">`);
    }
  }
  return out;
}

export function renderPack(pack: Pack, details: readonly RecordDetail[], check: CheckResult, tailLines: number): string {
  const out: string[] = [PACK_TITLE, ""];
  out.push(`> 由 \`ghc\` 生成 · issue ${pack.issue} · 正文修订 ${pack.issueRev} · ${pack.linked}/${pack.total} 行齐全 · 生成于 ${pack.generatedAt}`);
  out.push(`> 检出 ${pack.heads.map((h) => `${repoKey(h.repo)}@${h.head}`).join(", ") || "无"}`, "");
  out.push("| 验收 | 面 | 覆盖 | 角色 | 步骤 | 状态 | 命令 | 结果 |", "|---|---|---|---|---|---|---|---|");
  for (const r of pack.rows) {
    const covers = r.covers.length === 0 ? "卫生" : r.covers.map((c) => `结果 ${c}`).join("、");
    out.push(`| #${r.row} | ${r.face} | ${covers} | ${r.role} | ${r.step} | ${r.status} | ${r.command === null ? "—" : cellCode(r.command)} | ${cellText(r.result)} |`);
  }
  out.push(...renderImages(check));
  if (details.length > 0) out.push("", ...details.map((d) => renderDetail(d, tailLines)).join("\n\n").split("\n"));
  return `${out.join("\n")}\n`;
}

const HEADER = /^> 由 `ghc` 生成 · issue (\S+) · 正文修订 (\S+) · (\d+)\/(\d+) 行齐全 · 生成于 (\S+)$/;
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
  const table = firstTable(sec.lines);
  if (table === null) return null;
  const rows: PackRow[] = [];
  for (const r of table.rows) {
    const [rowText, face, coversText, role, step, status, command, result] = r.cells as [string, string, string, string, string, string, string, string];
    const n = Number(rowText.replace(/^#/, ""));
    if (!Number.isInteger(n) || !isFace(face) || !isRole(role) || !isStep(step)) return null;
    const st = STATUSES.find((s) => s === status);
    if (st === undefined) return null;
    rows.push({
      row: n,
      face,
      covers: coversText === "卫生" ? [] : [...coversText.matchAll(/\d+/g)].map((m) => Number(m[0])),
      role,
      step,
      status: st,
      command: command === "—" ? null : command.replace(/^`|`$/g, "").replace(/ˋ/g, "`"),
      result,
    });
  }
  return {
    issue: header[1] as string,
    issueRev: header[2] as string,
    linked: Number(header[3]),
    total: Number(header[4]),
    generatedAt: header[5] as string,
    heads,
    rows,
  };
}

export const packComplete = (p: Pack): boolean => p.total > 0 && p.linked === p.total && p.rows.every((r) => r.status === "已记录");
