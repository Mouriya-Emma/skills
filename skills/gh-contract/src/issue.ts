// Issue body contract: parse the markdown an author wrote into a typed body, collecting line-anchored diagnostics.

import { bullets, type Doc, findSection, firstTable, type Line, nonEmpty, parseDoc, type Section } from "./markdown.ts";
import {
  type Diagnostic,
  type Dimension,
  err,
  type Face,
  type Form,
  familyOf,
  formsFor,
  isDimension,
  isFace,
  isForm,
  type Role,
  warn,
} from "./model.ts";
import { parseRef, type Ref, type Repo, scanRefs } from "./ref.ts";

export type Outcome = { readonly id: number; readonly text: string; readonly line: number };

export type Row = {
  readonly id: number;
  readonly line: number;
  readonly face: Face;
  readonly dimension: Dimension;
  readonly covers: readonly number[];
  readonly role: Role;
  readonly via: readonly Ref[];
  readonly check: string;
  readonly command: string;
  readonly env: string;
  readonly expect: string;
};

export type ContractRef = { readonly issue: Ref; readonly commentId: number; readonly clause: number; readonly line: number };
export type Deps = { readonly dependsOn: readonly Ref[]; readonly blocks: readonly Ref[] };
export type Scope = { readonly faces: readonly Face[]; readonly packReason: string | null };

export type IssueBody =
  | {
      readonly kind: "standard";
      readonly outcomes: readonly Outcome[];
      readonly scope: Scope;
      readonly form: Form;
      readonly rows: readonly Row[];
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
      readonly outcomes: readonly Outcome[];
      readonly scope: Scope;
      readonly rows: readonly Row[];
      readonly composed: readonly Ref[];
      readonly contractRefs: readonly ContractRef[];
      readonly deps: Deps;
    };

export type IssueKind = IssueBody["kind"];
export type Parsed<T> = { readonly value: T | null; readonly diagnostics: readonly Diagnostic[] };

const at = (line: number): string => `body:${line}`;

const KIND_MARKERS: Record<string, IssueKind> = { 无代码变更: "no-code", 总体验收: "integration" };

const REQUIRED: Record<IssueKind, readonly string[]> = {
  standard: ["目标", "问题", "责任与必要决策", "预期结果", "范围边界", "影响范围", "测试形态", "验收标准"],
  "no-code": ["目标", "问题", "范围", "预期结果", "范围边界"],
  integration: ["目标", "组合对象", "影响范围", "预期结果", "验收标准", "依赖关系"],
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

function parseOutcomes(sec: Section, d: Diagnostic[]): Outcome[] {
  const out: Outcome[] = [];
  for (const b of bullets(sec.lines)) {
    const m = /^结果\s*(\d+)\s*[：:]\s*(.+)$/.exec(b.text);
    if (m === null) {
      d.push(err(at(b.n), "预期结果的条目必须写成「- 结果 N：…」"));
      continue;
    }
    const id = Number(m[1]);
    if (out.some((o) => o.id === id)) d.push(err(at(b.n), `结果 ${id} 编号重复`));
    out.push({ id, text: (m[2] as string).trim(), line: b.n });
  }
  if (out.length === 0) d.push(err(at(sec.line), "预期结果至少要有一条「- 结果 N：…」"));
  return out;
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
    d.push(err(at(sec.line), "测试形态只写一个值：e2e、集成、最薄入口 或 driver"));
    return null;
  }
  const only = values[0] as { n: number; v: string };
  if (!isForm(only.v)) {
    d.push(err(at(only.n), `未知的测试形态「${only.v}」，可选：e2e、集成、最薄入口、driver`));
    return null;
  }
  return only.v;
}

const CHECK_RE = /^覆盖\s*((?:结果\s*\d+\s*[、,，]?\s*)+)(?:\[(正例|负例|保持)\])?\s*(?:[；;]\s*经由\s+([^：:]+?))?\s*[：:]/;

function parseRows(sec: Section, repo: Repo, kind: IssueKind, d: Diagnostic[]): Row[] {
  const table = firstTable(sec.lines);
  if (table === null) {
    d.push(err(at(sec.line), "验收标准缺少表格"));
    return [];
  }
  const expected = ["#", "面", "Dimension", "Check", "Command", "Env", "Expect"];
  if (table.header.join("|") !== expected.join("|")) {
    d.push(err(at(table.headerLine), `验收表的表头必须是 | ${expected.join(" | ")} |`));
    return [];
  }
  const rows: Row[] = [];
  for (const r of table.rows) {
    const [idText, faceText, dimText, check, command, env, expect] = r.cells as [string, string, string, string, string, string, string];
    const id = Number(idText);
    if (!Number.isInteger(id) || id <= 0) {
      d.push(err(at(r.n), `行号「${idText}」不是正整数`));
      continue;
    }
    if (rows.some((x) => x.id === id)) d.push(err(at(r.n), `验收行 #${id} 编号重复`));
    if (!isFace(faceText)) {
      d.push(err(at(r.n), `#${id} 的面「${faceText}」未知`));
      continue;
    }
    if (!isDimension(dimText)) {
      d.push(err(at(r.n), `#${id} 的 Dimension「${dimText}」未知，可选 function、environment、integration、assumption`));
      continue;
    }
    if (command.replace(/`/g, "").trim() === "") d.push(err(at(r.n), `#${id} 缺少 Command`));
    const m = CHECK_RE.exec(check);
    let covers: number[] = [];
    let role: Role = "正例";
    let via: Ref[] = [];
    if (m !== null) {
      covers = [...(m[1] as string).matchAll(/\d+/g)].map((x) => Number(x[0]));
      role = (m[2] as Role | undefined) ?? "正例";
      via = m[3] === undefined ? [] : scanRefs(m[3], repo);
      if (m[3] !== undefined && via.length === 0) d.push(err(at(r.n), `#${id} 的「经由」没有可解析的 issue 引用`));
      if (kind !== "integration" && via.length > 0) d.push(err(at(r.n), `#${id}：只有总体验收 issue 的行写「经由」`));
    } else if (/^覆盖/.test(check)) {
      d.push(err(at(r.n), `#${id} 的 Check 写法应为「覆盖 结果 N[、结果 M][负例|保持]：…」`));
    }
    rows.push({ id, line: r.n, face: faceText, dimension: dimText, covers, role, via, check, command, env, expect });
  }
  if (rows.length === 0) d.push(err(at(sec.line), "验收表没有任何行"));
  return rows;
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

function checkCoverage(outcomes: readonly Outcome[], rows: readonly Row[], d: Diagnostic[]): void {
  for (const r of rows) {
    for (const c of r.covers) {
      if (!outcomes.some((o) => o.id === c)) d.push(err(at(r.line), `#${r.id} 覆盖的结果 ${c} 不存在`));
    }
  }
  for (const o of outcomes) {
    if (!rows.some((r) => r.covers.includes(o.id))) d.push(err(at(o.line), `结果 ${o.id} 没有任何验收行覆盖`));
  }
}

function checkFaces(scope: Scope, rows: readonly Row[], d: Diagnostic[]): void {
  for (const r of rows) {
    if (!scope.faces.includes(r.face)) d.push(err(at(r.line), `#${r.id} 的面 ${r.face} 不在影响范围里`));
  }
  for (const f of scope.faces) {
    if (!rows.some((r) => r.face === f)) d.push(err("影响范围", `面 ${f} 没有任何验收行`));
  }
}

export type IssueContext = { readonly repo: Repo; readonly hasParent: boolean };

export function parseIssue(text: string, ctx: IssueContext): Parsed<IssueBody> {
  const doc = parseDoc(text);
  const k = issueKindOf(doc);
  const d: Diagnostic[] = [...k.diagnostics];
  for (const title of REQUIRED[k.kind]) {
    if (findSection(doc, title) === undefined) d.push(err("body", `缺少「## ${title}」段`));
  }
  const allLines = [...doc.preamble, ...doc.sections.flatMap((s) => [{ n: s.line, text: s.title }, ...s.lines])];
  const contractRefs = parseContractRefs(allLines, ctx.repo);
  const deps = parseDeps(findSection(doc, "依赖关系"), ctx.repo);
  const outSec = findSection(doc, "预期结果");
  const outcomes = outSec === undefined ? [] : parseOutcomes(outSec, d);

  switch (k.kind) {
    case "no-code": {
      const pathsSec = findSection(doc, "范围");
      const paths = pathsSec === undefined ? [] : parsePaths(pathsSec, d);
      if (findSection(doc, "验收标准") !== undefined) d.push(err("body", "无代码变更 issue 不写验收标准表"));
      return { value: { kind: "no-code", outcomes, paths, contractRefs, deps }, diagnostics: d };
    }
    case "standard": {
      const scopeSec = findSection(doc, "影响范围");
      const scope = scopeSec === undefined ? { faces: [], packReason: null } : parseScope(scopeSec, d);
      const formSec = findSection(doc, "测试形态");
      const form = formSec === undefined ? null : parseForm(formSec, d);
      const rowsSec = findSection(doc, "验收标准");
      const rows = rowsSec === undefined ? [] : parseRows(rowsSec, ctx.repo, "standard", d);
      checkCoverage(outcomes, rows, d);
      checkFaces(scope, rows, d);
      if (form !== null) {
        if (!ctx.hasParent && form !== "e2e") d.push(err("测试形态", `不在 issue 树里的 issue 只能是 e2e（当前 ${form}）：没有总体验收接手`));
        for (const f of scope.faces) {
          if (!formsFor(f).includes(form)) d.push(err("测试形态", `面 ${f} 不允许测试形态 ${form}，可选：${formsFor(f).join("、")}`));
        }
      }
      if (form === null) return { value: null, diagnostics: d };
      return { value: { kind: "standard", outcomes, scope, form, rows, contractRefs, deps }, diagnostics: d };
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
      const rowsSec = findSection(doc, "验收标准");
      const rows = rowsSec === undefined ? [] : parseRows(rowsSec, ctx.repo, "integration", d);
      checkCoverage(outcomes, rows, d);
      checkFaces(scope, rows, d);
      for (const r of rows) {
        if (r.via.length === 0) d.push(err(at(r.line), `#${r.id} 缺少「经由」：总体验收的每行写明经过哪些 child`));
      }
      return { value: { kind: "integration", outcomes, scope, rows, composed, contractRefs, deps }, diagnostics: d };
    }
  }
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
