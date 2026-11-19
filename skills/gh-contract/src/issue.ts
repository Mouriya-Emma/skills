// Issue body contract: parse the markdown an author wrote into a typed body, collecting line-anchored diagnostics.

import { bullets, type Doc, findSection, type Line, nonEmpty, parseDoc, type Section } from "./markdown.ts";
import { type Diagnostic, err, type Face, type Form, familyOf, formsFor, isFace, isForm, isKind, type Kind, warn } from "./model.ts";
import { parseRef, parseRepo, type Ref, type Repo, scanRefs } from "./ref.ts";

/** One expected result. `digest` identifies its wording: evidence taken for one wording does not prove another. */
export type Outcome = { readonly id: number; readonly text: string; readonly line: number; readonly digest: string };
/** A result that owes evidence: the kind the author expects (a reference, the collector may record another), and for an
 * integration issue the children its path passes through. */
export type TypedOutcome = Outcome & { readonly kind: Kind; readonly via: readonly Ref[] };

export type ContractRef = { readonly issue: Ref; readonly commentId: number; readonly clause: number; readonly line: number };
export type Deps = { readonly dependsOn: readonly Ref[]; readonly blocks: readonly Ref[] };
export type Scope = { readonly faces: readonly Face[]; readonly packReason: string | null };

export type IssueBody =
  | {
      readonly kind: "standard";
      readonly outcomes: readonly TypedOutcome[];
      readonly scope: Scope;
      readonly form: Form;
      readonly contractRefs: readonly ContractRef[];
      readonly deps: Deps;
    }
  | {
      readonly kind: "no-code";
      readonly outcomes: readonly Outcome[];
      readonly paths: readonly { path: string; line: number }[];
      readonly contractRefs: readonly ContractRef[];
      readonly deps: Deps;
    }
  | {
      readonly kind: "integration";
      readonly outcomes: readonly TypedOutcome[];
      readonly scope: Scope;
      readonly composed: readonly Ref[];
      readonly contractRefs: readonly ContractRef[];
      readonly deps: Deps;
    };

export type IssueKind = IssueBody["kind"];
export type Parsed<T> = { readonly value: T | null; readonly diagnostics: readonly Diagnostic[] };

const at = (line: number): string => `body:${line}`;

const KIND_MARKERS: Record<string, IssueKind> = { 无代码变更: "no-code", 总体验收: "integration" };

const REQUIRED: Record<IssueKind, readonly string[]> = {
  standard: ["现场", "目标", "原因", "责任与必要决策", "预期结果", "范围边界", "影响范围", "测试形态"],
  "no-code": ["现场", "目标", "范围", "预期结果", "范围边界"],
  integration: ["目标", "组合对象", "影响范围", "预期结果", "依赖关系"],
};

export function issueKindOf(doc: Doc): { kind: IssueKind; diagnostics: Diagnostic[] } {
  const typeLine = doc.preamble.find((l) => /^类型\s*[：:]/.test(l.text.trim()));
  if (typeLine === undefined) return { kind: "standard", diagnostics: [] };
  const value = typeLine.text.trim().replace(/^类型\s*[：:]\s*/, "");
  const kind = KIND_MARKERS[value];
  if (kind === undefined) {
    return {
      kind: "standard",
      diagnostics: [err(at(typeLine.n), `未知的 issue 类型「${value}」，可选：${Object.keys(KIND_MARKERS).join("、")}`)],
    };
  }
  return { kind, diagnostics: [] };
}

function digestOf(parts: readonly string[]): string {
  return new Bun.CryptoHasher("sha256").update(parts.map((p) => p.replace(/\s+/g, " ").trim()).join("\n")).digest("hex").slice(0, 12);
}

/** One digest for a whole result list: a published evidence pack names the wording it was taken for. */
export const outcomesDigest = (outcomes: readonly Outcome[]): string => digestOf(outcomes.map((o) => `${o.id} ${o.digest}`));

/** What happened that raised the issue. The record must be the thing itself, not a retelling. */
function checkScene(sec: Section, d: Diagnostic[]): void {
  const lines = sec.lines.map((l) => l.text);
  if (lines.every((t) => t.trim() === "")) {
    d.push(err(at(sec.line), "现场是空的：写提出这条 issue 时已经发生的事"));
    return;
  }
  const verbatim = lines.some((t) => /^\s*(```|~~~)/.test(t) || /^\s*>/.test(t) || /!\[[^\]]*\]\(|<img\s/.test(t) || /https?:\/\//.test(t));
  if (!verbatim) d.push(err(at(sec.line), "现场没有原样记录：贴出当时的输出、日志或截图，或引用原文并给出链接"));
}

const OUTCOME_RE = /^结果\s*(\d+)\s*(?:\[([^\]]*)\])?\s*(?:[；;]\s*经由\s+([^：:]+?))?\s*[：:]\s*(.+)$/;

type RawOutcome = Outcome & { readonly kindText: string | null; readonly viaText: string | null };

function parseOutcomes(sec: Section, d: Diagnostic[]): RawOutcome[] {
  const out: RawOutcome[] = [];
  const tops = bullets(sec.lines);
  for (const [i, b] of tops.entries()) {
    const next = tops[i + 1]?.n ?? Number.POSITIVE_INFINITY;
    // Sub-bullets and wrapped lines belong to the result: its wording includes them.
    const rest = sec.lines.filter((l) => l.n > b.n && l.n < next && l.text.trim() !== "").map((l) => l.text);
    const m = OUTCOME_RE.exec(b.text);
    if (m === null) {
      d.push(err(at(b.n), "预期结果的条目必须写成「- 结果 N [改|新|删|保持]：…」"));
      continue;
    }
    const id = Number(m[1]);
    if (out.some((o) => o.id === id)) d.push(err(at(b.n), `结果 ${id} 编号重复`));
    const kindText = m[2]?.trim() ?? null;
    const viaText = m[3]?.trim() ?? null;
    const text = (m[4] as string).trim();
    out.push({ id, text, line: b.n, digest: digestOf([kindText ?? "", viaText ?? "", text, ...rest]), kindText, viaText });
  }
  if (out.length === 0) d.push(err(at(sec.line), "预期结果至少要有一条「- 结果 N [改|新|删|保持]：…」"));
  return out;
}

/** Results of an issue that owes evidence; null when any of them lacks a usable kind, since evidence cannot be planned for it. */
function typed(raw: readonly RawOutcome[], repo: Repo, kind: "standard" | "integration", d: Diagnostic[]): TypedOutcome[] | null {
  const out: TypedOutcome[] = [];
  let ok = true;
  for (const o of raw) {
    if (o.kindText === null || !isKind(o.kindText)) {
      d.push(err(at(o.line), `结果 ${o.id} 要标类型：[改]、[新]、[删] 或 [保持]${o.kindText === null ? "" : `（现在是 [${o.kindText}]）`}`));
      ok = false;
      continue;
    }
    const via = o.viaText === null ? [] : scanRefs(o.viaText, repo);
    if (o.viaText !== null && via.length === 0) d.push(err(at(o.line), `结果 ${o.id} 的「经由」没有可解析的 issue 引用`));
    if (kind === "standard" && o.viaText !== null) d.push(err(at(o.line), `结果 ${o.id}：只有总体验收 issue 的结果写「经由」`));
    if (kind === "integration" && via.length === 0 && o.viaText === null) {
      d.push(err(at(o.line), `结果 ${o.id} 缺少「经由」：总体验收的每条结果写明经过哪些 child`));
    }
    out.push({ id: o.id, text: o.text, line: o.line, digest: o.digest, kind: o.kindText, via });
  }
  return ok ? out : null;
}

function parseScope(sec: Section, d: Diagnostic[]): Scope {
  const faces: Face[] = [];
  let packReason: string | null = null;
  for (const l of nonEmpty(sec.lines)) {
    const t = l.text.trim();
    const reason = /^打包理由\s*[：:]\s*(.*)$/.exec(t);
    if (reason !== null) {
      packReason = (reason[1] as string).trim() || null;
      if (packReason === null) d.push(err(at(l.n), "打包理由不能为空"));
      continue;
    }
    const b = /^[-*]\s+(.+)$/.exec(t);
    if (b === null) {
      d.push(err(at(l.n), "影响范围只能是「- <面>」条目和一行「打包理由：…」"));
      continue;
    }
    const face = (b[1] as string).trim();
    if (!isFace(face)) {
      d.push(err(at(l.n), `未知的面「${face}」，可选：gui、cli、service、library、data、iac、agent-config`));
      continue;
    }
    if (faces.includes(face)) d.push(err(at(l.n), `面 ${face} 重复`));
    else faces.push(face);
  }
  if (faces.length === 0) d.push(err(at(sec.line), "影响范围至少声明一个面"));
  const families = [...new Set(faces.map(familyOf))];
  if (families.length > 1) {
    const span = families.join("/");
    if (packReason === null) {
      d.push(err(at(sec.line), `打包 issue：跨 ${span}，必须写「打包理由：…」；跨 repo 的组合必须拆分`));
    } else {
      d.push(warn(at(sec.line), `打包 issue：跨 ${span}，不推荐，应拆分`));
    }
  }
  return { faces, packReason };
}

function parseForm(sec: Section, d: Diagnostic[]): Form | null {
  const values = nonEmpty(sec.lines).map((l) => ({ n: l.n, v: l.text.trim().replace(/^[-*]\s+/, "") }));
  if (values.length !== 1) {
    d.push(err(at(sec.line), "测试形态只写一个值：e2e、集成 或 最薄入口"));
    return null;
  }
  const only = values[0] as { n: number; v: string };
  if (!isForm(only.v)) {
    d.push(err(at(only.n), `未知的测试形态「${only.v}」，可选：e2e、集成、最薄入口`));
    return null;
  }
  return only.v;
}

function parseDeps(sec: Section | undefined, repo: Repo): Deps {
  if (sec === undefined) return { dependsOn: [], blocks: [] };
  const dependsOn: Ref[] = [];
  const blocks: Ref[] = [];
  for (const b of bullets(sec.lines)) {
    const dm = /^Depends on\s*[：:]\s*(.*)$/i.exec(b.text);
    const bm = /^Blocks\s*[：:]\s*(.*)$/i.exec(b.text);
    if (dm !== null) dependsOn.push(...scanRefs(dm[1] as string, repo));
    if (bm !== null) blocks.push(...scanRefs(bm[1] as string, repo));
  }
  return { dependsOn, blocks };
}

function parseContractRefs(lines: readonly Line[], repo: Repo): ContractRef[] {
  const out: ContractRef[] = [];
  for (const l of lines) {
    for (const m of l.text.matchAll(/((?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#\d+)\s*决策\s*(\d+)\s*§\s*(\d+)/g)) {
      const issue = parseRef(m[1] as string, repo);
      if (issue !== null) out.push({ issue, commentId: Number(m[2]), clause: Number(m[3]), line: l.n });
    }
  }
  return out;
}

function parsePaths(sec: Section, d: Diagnostic[]): { path: string; line: number }[] {
  const out: { path: string; line: number }[] = [];
  for (const b of bullets(sec.lines)) {
    const p = b.text.replace(/^`|`$/g, "").trim();
    if (/[*?[\]{}]/.test(p)) d.push(err(at(b.n), `范围「${p}」含通配符；无代码变更 issue 只列确切路径`));
    else if (p.startsWith("/") || p.includes("..") || p === "") d.push(err(at(b.n), `范围「${p}」不是 repo 内的相对路径`));
    else out.push({ path: p, line: b.n });
  }
  if (out.length === 0) d.push(err(at(sec.line), "范围至少列出一个文件路径"));
  return out;
}

export type IssueContext = { readonly repo: Repo; readonly hasParent: boolean };

export function parseIssue(text: string, ctx: IssueContext): Parsed<IssueBody> {
  const doc = parseDoc(text);
  const k = issueKindOf(doc);
  const d: Diagnostic[] = [...k.diagnostics];
  for (const title of REQUIRED[k.kind]) {
    if (findSection(doc, title) === undefined) d.push(err("body", `缺少「## ${title}」段`));
  }
  if (findSection(doc, "验收标准") !== undefined) {
    d.push(err("body", "issue 不写「## 验收标准」：怎样观察由采集证据的人在实现后决定，证据挂在预期结果上"));
  }
  const sceneSec = findSection(doc, "现场");
  if (sceneSec !== undefined) checkScene(sceneSec, d);
  const allLines = [...doc.preamble, ...doc.sections.flatMap((s) => [{ n: s.line, text: s.title }, ...s.lines])];
  const contractRefs = parseContractRefs(allLines, ctx.repo);
  const deps = parseDeps(findSection(doc, "依赖关系"), ctx.repo);
  const outSec = findSection(doc, "预期结果");
  const raw = outSec === undefined ? [] : parseOutcomes(outSec, d);

  switch (k.kind) {
    case "no-code": {
      const pathsSec = findSection(doc, "范围");
      const paths = pathsSec === undefined ? [] : parsePaths(pathsSec, d);
      for (const o of raw) {
        if (o.kindText !== null || o.viaText !== null) d.push(err(at(o.line), `结果 ${o.id}：无代码变更 issue 的结果不标类型，也不写「经由」`));
      }
      const outcomes = raw.map((o) => ({ id: o.id, text: o.text, line: o.line, digest: o.digest }));
      return { value: { kind: "no-code", outcomes, paths, contractRefs, deps }, diagnostics: d };
    }
    case "standard": {
      const scopeSec = findSection(doc, "影响范围");
      const scope = scopeSec === undefined ? { faces: [], packReason: null } : parseScope(scopeSec, d);
      const formSec = findSection(doc, "测试形态");
      const form = formSec === undefined ? null : parseForm(formSec, d);
      const outcomes = typed(raw, ctx.repo, "standard", d);
      if (form !== null) {
        if (!ctx.hasParent && form !== "e2e") d.push(err("测试形态", `不在 issue 树里的 issue 只能是 e2e（当前 ${form}）：没有总体验收接手`));
        for (const f of scope.faces) {
          if (!formsFor(f).includes(form)) d.push(err("测试形态", `面 ${f} 不允许测试形态 ${form}，可选：${formsFor(f).join("、")}`));
        }
      }
      if (form === null || outcomes === null) return { value: null, diagnostics: d };
      return { value: { kind: "standard", outcomes, scope, form, contractRefs, deps }, diagnostics: d };
    }
    case "integration": {
      const scopeSec = findSection(doc, "影响范围");
      const scope = scopeSec === undefined ? { faces: [], packReason: null } : parseScope(scopeSec, d);
      const formSec = findSection(doc, "测试形态");
      if (formSec !== undefined) {
        const form = parseForm(formSec, d);
        if (form !== null && form !== "e2e") d.push(err("测试形态", "总体验收 issue 只能是 e2e"));
      }
      const compSec = findSection(doc, "组合对象");
      const composed = compSec === undefined ? [] : bullets(compSec.lines).flatMap((b) => scanRefs(b.text, ctx.repo).slice(0, 1));
      if (compSec !== undefined && composed.length === 0) d.push(err(at(compSec.line), "组合对象至少列出一个 issue 引用"));
      const outcomes = typed(raw, ctx.repo, "integration", d);
      if (outcomes === null) return { value: null, diagnostics: d };
      return { value: { kind: "integration", outcomes, scope, composed, contractRefs, deps }, diagnostics: d };
    }
  }
}

/**
 * The repo that carries the issue's code, from `## 上下文` → `**Repo**`; the issue's own repo when the field is absent.
 * An issue may live in one repo while its PR goes to another (a coordination repo hosting issues for code repos).
 */
export function codeRepo(text: string, repo: Repo): Repo {
  const sec = findSection(parseDoc(text), "上下文");
  if (sec === undefined) return repo;
  for (const b of bullets(sec.lines)) {
    const m = /^\*\*Repo\*\*\s*[：:]\s*`?([^`\s（(]+)/.exec(b.text);
    const declared = m === null ? null : parseRepo(m[1] as string);
    if (declared !== null) return declared;
  }
  return repo;
}

/** The umbrella's pointer to its integration issue (`## 总体验收` section). */
export function umbrellaIntegrationRef(text: string, repo: Repo): Parsed<Ref> {
  const doc = parseDoc(text);
  const sec = findSection(doc, "总体验收");
  if (sec === undefined) return { value: null, diagnostics: [err("body", "umbrella 缺少「## 总体验收」段（指向总体验收 issue）")] };
  const refs = scanRefs(sec.lines.map((l) => l.text).join("\n"), repo);
  if (refs.length !== 1) return { value: null, diagnostics: [err(`body:${sec.line}`, "「## 总体验收」段必须恰好引用一个 issue")] };
  return { value: refs[0] as Ref, diagnostics: [] };
}
