// PR contract: identity (closes exactly its issue), body template by issue kind, and the no-code checks.

import { fileAt, type PrData } from "./github.ts";
import type { IssueBody } from "./issue.ts";
import { bullets, findSection, headingSlugs, links, nonEmpty, parseDoc } from "./markdown.ts";
import { type Diagnostic, err, warn } from "./model.ts";
import { parseRef, type Ref, refKey, sameRef } from "./ref.ts";

const at = (line: number): string => `pr-body:${line}`;

/** The issue named on the PR body's first line. */
export function closesLine(body: string, pr: Ref): Ref | null {
  const first = body.split(/\r?\n/).find((l) => l.trim() !== "");
  if (first === undefined) return null;
  const m = /^(?:Closes|Fixes|Resolves)\s+(\S+)\s*$/i.exec(first.trim());
  return m === null ? null : parseRef(m[1] as string, pr.repo);
}

export function checkIdentity(pr: PrData, expected: Ref | null): { issue: Ref | null; diagnostics: Diagnostic[] } {
  const d: Diagnostic[] = [];
  const named = closesLine(pr.body, pr.ref);
  if (named === null) d.push(err(at(1), "PR 正文第一行必须是 `Closes owner/repo#N`（或 Fixes/Resolves）"));
  if (pr.closingIssues.length !== 1) {
    d.push(err("closingIssuesReferences", `PR 关闭 ${pr.closingIssues.length} 个 issue（${pr.closingIssues.map(refKey).join(", ") || "无"}），必须恰好一个`));
  } else if (named !== null && !sameRef(pr.closingIssues[0] as Ref, named)) {
    d.push(err("closingIssuesReferences", `GitHub 记录关闭 ${refKey(pr.closingIssues[0] as Ref)}，与正文第一行 ${refKey(named)} 不一致`));
  }
  if (expected !== null && named !== null && !sameRef(named, expected)) d.push(err(at(1), `PR 关闭 ${refKey(named)}，目标是 ${refKey(expected)}`));
  if (pr.isDraft) d.push(err("pr", "PR 不允许是 draft"));
  return { issue: named, diagnostics: d };
}

const STANDARD_SECTIONS = ["摘要", "实现说明"];
const NO_CODE_SECTIONS = ["摘要", "做了什么", "调整思路", "增加", "减少"];
const LEGACY_EVIDENCE = /Layer\s*\d|变更预演|落地核对|启动\s*\/\s*运行时|端到端业务行为|卫生检查|^分析$|^证据/;

export function checkBody(pr: PrData, issue: IssueBody): Diagnostic[] {
  const doc = parseDoc(pr.body);
  const d: Diagnostic[] = [];
  switch (issue.kind) {
    case "integration":
      d.push(err("pr", "总体验收 issue 不经 PR 关闭：证据发在 issue 上"));
      return d;
    case "standard":
      for (const t of STANDARD_SECTIONS) if (findSection(doc, t) === undefined) d.push(err("pr-body", `缺少「## ${t}」段`));
      for (const s of doc.sections) {
        if (LEGACY_EVIDENCE.test(s.title)) d.push(err(at(s.line), `「## ${s.title}」：证据不写进 PR 正文，由 ghc ev publish 发成证据包 comment`));
      }
      return d;
    case "no-code": {
      for (const t of NO_CODE_SECTIONS) if (findSection(doc, t) === undefined) d.push(err("pr-body", `缺少「## ${t}」段`));
      const tagged = new Set<number>();
      for (const t of NO_CODE_SECTIONS.slice(1)) {
        const sec = findSection(doc, t);
        if (sec === undefined) continue;
        if (nonEmpty(sec.lines).length > 0 && bullets(sec.lines).length === 0) d.push(err(at(sec.line), `「## ${t}」用无序列表写要点`));
        for (const b of bullets(sec.lines)) for (const m of b.text.matchAll(/[（(]结果\s*(\d+)[）)]/g)) tagged.add(Number(m[1]));
      }
      for (const o of issue.outcomes) if (!tagged.has(o.id)) d.push(err("pr-body", `结果 ${o.id} 没有要点标注「（结果 ${o.id}）」`));
      return d;
    }
  }
}

export type LinkCheck = { readonly file: string; readonly line: number; readonly target: string; readonly ok: boolean; readonly reason: string };
export type NoCodeReport = {
  readonly outside: readonly string[];
  readonly untouched: readonly string[];
  readonly links: readonly LinkCheck[];
};

function resolvePath(fromFile: string, target: string): string {
  const base = target.startsWith("/") ? [] : fromFile.split("/").slice(0, -1);
  for (const seg of target.replace(/^\//, "").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") base.pop();
    else base.push(decodeURIComponent(seg));
  }
  return base.join("/");
}

/** Diff stays inside the issue's declared files; relative links and anchors in changed markdown resolve at head. */
export async function checkNoCode(pr: PrData, issue: Extract<IssueBody, { kind: "no-code" }>): Promise<{ report: NoCodeReport; diagnostics: Diagnostic[] }> {
  const declared = new Set(issue.paths.map((p) => p.path));
  const outside = pr.files.filter((f) => !declared.has(f));
  const untouched = [...declared].filter((p) => !pr.files.includes(p));
  const d: Diagnostic[] = outside.map((f) => err("diff", `${f} 不在 issue「范围」里；先把它加进 issue 范围再改`));
  for (const u of untouched) d.push(warn("diff", `issue 范围里的 ${u} 没有改动`));
  const checks: LinkCheck[] = [];
  const repo = pr.headRepo ?? pr.ref.repo;
  const cache = new Map<string, string | null>();
  const content = async (p: string): Promise<string | null> => {
    if (!cache.has(p)) cache.set(p, await fileAt(repo, pr.headRefOid, p));
    return cache.get(p) ?? null;
  };
  for (const file of pr.files.filter((f) => /\.(md|markdown|mdx)$/i.test(f))) {
    const text = await content(file);
    if (text === null) continue; // deleted in this PR
    for (const l of links(text)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(l.target)) continue; // absolute URL or mailto:
      const hash = l.target.indexOf("#");
      const pathPart = hash < 0 ? l.target : l.target.slice(0, hash);
      const anchor = hash < 0 ? "" : l.target.slice(hash + 1);
      const targetFile = pathPart === "" ? file : resolvePath(file, pathPart);
      const targetText = pathPart === "" ? text : await content(targetFile);
      let ok: boolean;
      let reason = "";
      if (targetText === null) {
        ok = false;
        reason = `${targetFile} 在 HEAD 不存在`;
      } else if (anchor !== "" && /\.(md|markdown|mdx)$/i.test(targetFile)) {
        ok = headingSlugs(targetText).has(decodeURIComponent(anchor).toLowerCase());
        if (!ok) reason = `${targetFile} 没有锚点 #${anchor}`;
      } else ok = true;
      checks.push({ file, line: l.n, target: l.target, ok, reason });
      if (!ok) d.push(err(`${file}:${l.n}`, `链接 ${l.target}：${reason}`));
    }
  }
  return { report: { outside, untouched, links: checks }, diagnostics: d };
}
