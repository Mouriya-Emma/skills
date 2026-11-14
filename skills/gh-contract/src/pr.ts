// PR contract: identity (closes exactly its issue), body template by issue kind, and the no-code checks.

import { fileAt, type IssueData, type PrData } from "./github.ts";
import type { IssueBody } from "./issue.ts";
import { bullets, findSection, headingSlugs, links, nonEmpty, parseDoc } from "./markdown.ts";
import { type Diagnostic, err, warn } from "./model.ts";
import { parseRef, type Ref, refKey, sameRef, sameRepo, treeBranch } from "./ref.ts";

const at = (line: number): string => `pr-body:${line}`;

/** What the PR body's first line declares: the one issue it delivers, or the tree whose buffer branch it merges. */
export type PrTarget = { readonly kind: "issue"; readonly issue: Ref } | { readonly kind: "tree"; readonly root: Ref };

export function firstLine(body: string, pr: Ref): PrTarget | null {
  const first = body.split(/\r?\n/).find((l) => l.trim() !== "");
  if (first === undefined) return null;
  const closes = /^(?:Closes|Fixes|Resolves)\s+(\S+)\s*$/i.exec(first.trim());
  if (closes !== null) {
    const issue = parseRef(closes[1] as string, pr.repo);
    return issue === null ? null : { kind: "issue", issue };
  }
  const tree = /^Tree\s+(\S+)\s*$/.exec(first.trim());
  if (tree !== null) {
    const root = parseRef(tree[1] as string, pr.repo);
    return root === null ? null : { kind: "tree", root };
  }
  return null;
}

/** The PR's declared target; `expected` pins the issue it must deliver. */
export function checkIdentity(pr: PrData, expected: Ref | null): { target: PrTarget | null; diagnostics: Diagnostic[] } {
  const d: Diagnostic[] = [];
  const target = firstLine(pr.body, pr.ref);
  if (target === null) d.push(err(at(1), "PR 正文第一行必须是 `Closes owner/repo#N`（交付一个 issue）或 `Tree owner/repo#N`（把树的缓冲分支合入默认分支）"));
  if (expected !== null && target !== null && (target.kind !== "issue" || !sameRef(target.issue, expected))) {
    d.push(err(at(1), `PR 第一行声明的不是 ${refKey(expected)}`));
  }
  if (pr.isDraft) d.push(err("pr", "PR 不允许是 draft"));
  return { target, diagnostics: d };
}

/**
 * Where a PR that delivers `issue` must merge. A child of a tree merges into the tree's buffer branch, where GitHub
 * records no closing reference; a standalone issue merges into the default branch and GitHub must record exactly it.
 */
export function checkPlacement(pr: PrData, issue: IssueData): Diagnostic[] {
  const d: Diagnostic[] = [];
  if (issue.parent !== null) {
    const buffer = treeBranch(issue.parent);
    if (pr.baseRefName !== buffer) d.push(err("pr", `${refKey(issue.ref)} 属于 ${refKey(issue.parent)} 的树：PR 的 base 必须是缓冲分支 ${buffer}，现在是 ${pr.baseRefName}`));
    return d;
  }
  if (pr.baseRefName !== pr.defaultBranch) d.push(err("pr", `独立 issue 的 PR 合入默认分支 ${pr.defaultBranch}，现在 base 是 ${pr.baseRefName}`));
  if (pr.closingIssues.length !== 1) {
    d.push(err("closingIssuesReferences", `PR 关闭 ${pr.closingIssues.length} 个 issue（${pr.closingIssues.map(refKey).join(", ") || "无"}），必须恰好一个`));
  } else if (!sameRef(pr.closingIssues[0] as Ref, issue.ref)) {
    d.push(err("closingIssuesReferences", `GitHub 记录关闭 ${refKey(pr.closingIssues[0] as Ref)}，与正文第一行 ${refKey(issue.ref)} 不一致`));
  }
  return d;
}

/**
 * A tree PR merges the buffer branch into the default branch of its repo and closes, by `Closes` lines, every tree
 * issue that lives in that repo: the open children, and the root itself when the root lives there.
 */
export function checkTreePr(pr: PrData, root: IssueData): Diagnostic[] {
  const d: Diagnostic[] = [];
  const buffer = treeBranch(root.ref);
  if (root.parent !== null) d.push(err(refKey(root.ref), `${refKey(root.ref)} 自身挂在 ${refKey(root.parent)} 下：嵌套树不经 tree PR 交付`));
  if (root.subIssues.length === 0) d.push(err(refKey(root.ref), `${refKey(root.ref)} 没有 sub-issue，不是树根`));
  if (pr.headRefName !== buffer) d.push(err("pr", `tree PR 的 head 必须是缓冲分支 ${buffer}，现在是 ${pr.headRefName}`));
  if (pr.baseRefName !== pr.defaultBranch) d.push(err("pr", `tree PR 合入默认分支 ${pr.defaultBranch}，现在 base 是 ${pr.baseRefName}`));
  const expected = [
    ...(sameRepo(root.ref.repo, pr.ref.repo) ? [root.ref] : []),
    ...root.subIssues.filter((s) => s.state === "OPEN" && sameRepo(s.ref.repo, pr.ref.repo)).map((s) => s.ref),
  ];
  for (const r of expected) if (!pr.closingIssues.some((c) => sameRef(c, r))) d.push(err("closingIssuesReferences", `tree PR 没有关闭 ${refKey(r)}：正文写一行 \`Closes ${refKey(r)}\``));
  for (const c of pr.closingIssues) if (!expected.some((r) => sameRef(c, r))) d.push(err("closingIssuesReferences", `tree PR 关闭了树外或别的 repo 的 ${refKey(c)}`));
  return d;
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
/**
 * `inTree`: the PR delivers a tree child, so its diff is the whole round's shared head and files outside this issue's
 * scope belong to sibling children; they are listed for review instead of rejected.
 */
export async function checkNoCode(pr: PrData, issue: Extract<IssueBody, { kind: "no-code" }>, inTree: boolean): Promise<{ report: NoCodeReport; diagnostics: Diagnostic[] }> {
  const declared = new Set(issue.paths.map((p) => p.path));
  const outside = pr.files.filter((f) => !declared.has(f));
  const untouched = [...declared].filter((p) => !pr.files.includes(p));
  const d: Diagnostic[] = outside.map((f) =>
    inTree ? warn("diff", `${f} 不在本 issue「范围」里：同一轮其他 child 的改动，review 核对归属`) : err("diff", `${f} 不在 issue「范围」里；先把它加进 issue 范围再改`),
  );
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
