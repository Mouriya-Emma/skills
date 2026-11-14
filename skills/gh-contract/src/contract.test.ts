import { describe, expect, test } from "bun:test";
import type { CheckResult } from "./evidence/check.ts";
import type { EvidenceRecord } from "./evidence/record.ts";
import { packComplete, parsePack, renderPack, toPack } from "./evidence/render.ts";
import { clauseText } from "./fetch.ts";
import { parseHeader, renderHeader } from "./gate.ts";
import type { IssueData, PrData } from "./github.ts";
import { parseIssue, type Row } from "./issue.ts";
import { checkPlacement, checkTreePr } from "./pr.ts";
import type { Ref } from "./ref.ts";

const repo = { owner: "acme", name: "app" };
const errors = (text: string, hasParent = false) =>
  parseIssue(text, { repo, hasParent }).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
const warnings = (text: string) => parseIssue(text, { repo, hasParent: false }).diagnostics.filter((d) => d.severity === "warn").map((d) => d.message);

function standard(opts: { faces?: string[]; form?: string; rows?: string[]; outcomes?: string[]; extraScope?: string } = {}): string {
  const faces = opts.faces ?? ["cli"];
  const rows = opts.rows ?? ["| 1 | cli | function | 覆盖 结果 1：输出新字段 | `app run` | 本地 | exit 0 |"];
  return [
    "# 标题",
    "",
    "## 目标",
    "x",
    "## 问题",
    "x",
    "## 责任与必要决策",
    "x",
    "## 预期结果",
    ...(opts.outcomes ?? ["- 结果 1：输出包含新字段"]),
    "## 范围边界",
    "x",
    "## 影响范围",
    ...faces.map((f) => `- ${f}`),
    ...(opts.extraScope === undefined ? [] : [opts.extraScope]),
    "## 测试形态",
    opts.form ?? "e2e",
    "## 验收标准",
    "| # | 面 | Dimension | Check | Command | Env | Expect |",
    "|---|---|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

describe("issue contract", () => {
  test("a well-formed standard issue has no errors", () => {
    expect(errors(standard())).toEqual([]);
  });

  test("an outcome no row covers is an error", () => {
    expect(errors(standard({ outcomes: ["- 结果 1：a", "- 结果 2：b"] }))).toContain("结果 2 没有任何验收行覆盖");
  });

  test("a row on an undeclared face is an error, and a declared face without rows too", () => {
    const e = errors(standard({ faces: ["gui"] }));
    expect(e).toContain("#1 的面 cli 不在影响范围里");
    expect(e).toContain("面 gui 没有任何验收行");
  });

  test("a standalone issue must be e2e; inside a tree 集成 is allowed", () => {
    expect(errors(standard({ form: "集成" }))).toContain("不在 issue 树里的 issue 只能是 e2e（当前 集成）：没有总体验收接手");
    expect(errors(standard({ form: "集成" }), true)).toEqual([]);
  });

  test("iac only admits e2e", () => {
    const text = standard({ faces: ["iac"], form: "集成", rows: ["| 1 | iac | environment | 覆盖 结果 1：路由生效 | `tofu apply` | prod | ok |"] });
    expect(errors(text, true)).toContain("面 iac 不允许测试形态 集成，可选：e2e");
  });

  test("crossing families needs a packaging reason, and is still warned", () => {
    const rows = [
      "| 1 | gui | function | 覆盖 结果 1：页面显示 | `x` | 本地 | ok |",
      "| 2 | iac | environment | 覆盖 结果 1：路由 | `y` | prod | ok |",
    ];
    expect(errors(standard({ faces: ["gui", "iac"], rows }))).toContain(
      "打包 issue：跨 应用/基础设施，必须写「打包理由：…」；跨 repo 的组合必须拆分",
    );
    const packed = standard({ faces: ["gui", "iac"], rows, extraScope: "打包理由：同一 repo 内的路由与页面必须一起上线" });
    expect(errors(packed)).toEqual([]);
    expect(warnings(packed)).toContain("打包 issue：跨 应用/基础设施，不推荐，应拆分");
  });

  test("role and multi-outcome coverage parse from the Check column", () => {
    const text = standard({
      outcomes: ["- 结果 1：a", "- 结果 2：b"],
      rows: ["| 1 | cli | function | 覆盖 结果 1、结果 2 [负例]：拒绝非法输入 | `x` | 本地 | exit 2 |"],
    });
    const body = parseIssue(text, { repo, hasParent: false }).value;
    expect(body?.kind).toBe("standard");
    const row = body?.kind === "standard" ? body.rows[0] : undefined;
    expect(row?.covers).toEqual([1, 2]);
    expect(row?.role).toBe("负例");
  });

  test("integration rows must name the children they pass through", () => {
    const text = [
      "# 总体验收",
      "类型：总体验收",
      "## 目标",
      "x",
      "## 组合对象",
      "- acme/app#12",
      "- acme/infra#40",
      "## 影响范围",
      "- gui",
      "## 预期结果",
      "- 结果 1：端到端可读",
      "## 验收标准",
      "| # | 面 | Dimension | Check | Command | Env | Expect |",
      "|---|---|---|---|---|---|---|",
      "| 1 | gui | integration | 覆盖 结果 1；经由 #12 acme/infra#40：提交后可读 | `x` | prod | ok |",
      "| 2 | gui | integration | 覆盖 结果 1：缺经由 | `y` | prod | ok |",
      "## 依赖关系",
      "- Depends on: #12, acme/infra#40",
    ].join("\n");
    const parsed = parseIssue(text, { repo, hasParent: true });
    const body = parsed.value;
    expect(body?.kind).toBe("integration");
    const rows: readonly Row[] = body?.kind === "integration" ? body.rows : [];
    expect(rows[0]?.via.map((r) => `${r.repo.name}#${r.number}`)).toEqual(["app#12", "infra#40"]);
    expect(parsed.diagnostics.map((d) => d.message)).toContain("#2 缺少「经由」：总体验收的每行写明经过哪些 child");
  });

  test("a no-code issue lists exact paths, never globs", () => {
    const text = ["# t", "类型：无代码变更", "## 目标", "x", "## 问题", "x", "## 范围", "- docs/a.md", "- docs/*.md", "## 预期结果", "- 结果 1：x", "## 范围边界", "x"].join("\n");
    expect(errors(text)).toEqual(["范围「docs/*.md」含通配符；无代码变更 issue 只列确切路径"]);
  });
});

describe("evidence pack", () => {
  test("a rendered pack parses back to the same summary", () => {
    const issue: IssueData = {
      ref: { repo, number: 7 },
      nodeId: "I_test",
      title: "t",
      state: "OPEN",
      stateReason: null,
      body: "",
      createdAt: "2026-11-01T00:00:00Z",
      bodyRev: "2026-11-02T00:00:00Z",
      url: "https://github.com/acme/app/issues/7",
      parent: null,
      subIssues: [],
      comments: [],
    };
    const head = "a".repeat(40);
    const record: EvidenceRecord = {
      id: "r1",
      issue: "acme/app#7",
      rows: [1],
      step: "run",
      capture: { kind: "run", command: "app run | grep `x`", shell: "/bin/zsh", cwd: "/w", completion: { kind: "exited", code: 0 }, stdoutLines: 1, stderrLines: 0 },
      startedAt: "2026-11-03T00:00:00.000Z",
      endedAt: "2026-11-03T00:00:01.500Z",
      checkouts: [{ repo: "acme/app", path: "/w", head, cleanBefore: true, cleanAfter: true }],
      attachments: [],
      issueRev: issue.bodyRev,
    };
    const row = (id: number): Row => ({ id, line: 1, face: "cli", dimension: "function", covers: [id], role: "正例", via: [], check: "", command: "", env: "", expect: "" });
    const check: CheckResult = {
      issue,
      rows: [
        { row: row(1), steps: [{ rule: { step: "run", anchor: "head", needsImage: false }, status: { kind: "linked", record } }], overall: "linked", orderProblem: null },
        { row: row(2), steps: [{ rule: { step: "run", anchor: "head", needsImage: false }, status: { kind: "missing" } }], overall: "missing", orderProblem: null },
      ],
      complete: false,
      heads: [{ repo, head }],
      base: null,
    };
    const pack = toPack(check, "2026-11-03T00:00:02Z");
    const text = renderPack(
      pack,
      [{ record, stdout: { text: "ok", total: 1, shown: 1, cut: false }, stderr: { text: "", total: 0, shown: 0, cut: false } }],
      check,
    );
    expect(parsePack(text)).toEqual(pack);
    expect(packComplete(pack)).toBe(false);
  });

  test("an edited comment that lost its header is not a pack", () => {
    expect(parsePack("## 证据包\n\n| a | b |\n|---|---|\n")).toBeNull();
  });
});

describe("contract references", () => {
  test("a clause runs from its § line to the next §-numbered line", () => {
    const body = "裁决记录\n\n### §1 状态\n只有 owner 写\n\n### §2 错误\n分三类\n- 细节\n### §10 其他\nz";
    expect(clauseText(body, 2)).toBe("### §2 错误\n分三类\n- 细节");
    expect(clauseText(body, 1)).toBe("### §1 状态\n只有 owner 写");
    expect(clauseText(body, 3)).toBeNull();
  });
});

describe("gate header", () => {
  test("renders and parses the inputs a verdict observed", () => {
    const h = { verdict: { kind: "fail" as const, gate: 3 }, head: "b".repeat(40), base: "main", issueRev: "2026-11-02T00:00:00Z", design: null };
    const line = renderHeader(h);
    expect(line).toBe(`Gate 结论 · review · FAIL@Gate3 · HEAD ${"b".repeat(40)} · base main · issue rev 2026-11-02T00:00:00Z · 设计 无`);
    expect(parseHeader(`${line}\n\n发现……`)).toEqual(h);
    expect(parseHeader("Gate 结论 · review · PASS · HEAD abc · base main · issue rev x · 设计 无")).toBeNull();
  });
});

describe("PR placement", () => {
  const ref = (number: number): Ref => ({ repo, number });
  const issue = (number: number, o: { parent?: Ref; subs?: { n: number; state: "OPEN" | "CLOSED" }[] } = {}): IssueData => ({
    ref: ref(number),
    nodeId: "I",
    title: "t",
    state: "OPEN",
    stateReason: null,
    body: "",
    createdAt: "2026-11-01T00:00:00Z",
    bodyRev: "2026-11-01T00:00:00Z",
    url: "u",
    parent: o.parent ?? null,
    subIssues: (o.subs ?? []).map((s) => ({ ref: ref(s.n), state: s.state, title: "c" })),
    comments: [],
  });
  const pr = (o: { base: string; head?: string; closing?: number[] }): PrData => ({
    ref: ref(100),
    title: "p",
    state: "OPEN",
    isDraft: false,
    body: "",
    url: "u",
    headRefOid: "a".repeat(40),
    headRefName: o.head ?? "work",
    headRepo: repo,
    baseRefName: o.base,
    baseRefOid: "b".repeat(40),
    mergeable: "MERGEABLE",
    defaultBranch: "main",
    checks: [],
    closingIssues: (o.closing ?? []).map(ref),
    files: [],
    commits: [],
    comments: [],
  });
  const msgs = (d: { message: string }[]) => d.map((x) => x.message);

  test("a tree child merges into its tree's buffer branch, never the default branch", () => {
    const child = issue(5, { parent: ref(1) });
    expect(checkPlacement(pr({ base: "tree/acme-app-1" }), child)).toEqual([]);
    expect(msgs(checkPlacement(pr({ base: "main", closing: [5] }), child))).toEqual([
      "acme/app#5 属于 acme/app#1 的树：PR 的 base 必须是缓冲分支 tree/acme-app-1，现在是 main",
    ]);
  });

  test("a standalone issue merges into the default branch and GitHub records exactly it", () => {
    expect(checkPlacement(pr({ base: "main", closing: [7] }), issue(7))).toEqual([]);
    expect(msgs(checkPlacement(pr({ base: "dev", closing: [] }), issue(7)))).toEqual([
      "独立 issue 的 PR 合入默认分支 main，现在 base 是 dev",
      "PR 关闭 0 个 issue（无），必须恰好一个",
    ]);
  });

  test("a tree PR closes the root and every open child in its repo, and nothing else", () => {
    const root = issue(1, { subs: [{ n: 5, state: "OPEN" }, { n: 6, state: "CLOSED" }, { n: 9, state: "OPEN" }] });
    expect(checkTreePr(pr({ base: "main", head: "tree/acme-app-1", closing: [1, 5, 9] }), root)).toEqual([]);
    expect(msgs(checkTreePr(pr({ base: "main", head: "tree/acme-app-1", closing: [1, 5, 6] }), root))).toEqual([
      "tree PR 没有关闭 acme/app#9：正文写一行 `Closes acme/app#9`",
      "tree PR 关闭了树外或别的 repo 的 acme/app#6",
    ]);
    expect(msgs(checkTreePr(pr({ base: "tree/acme-app-1", head: "work", closing: [] }), root))).toContain(
      "tree PR 的 head 必须是缓冲分支 tree/acme-app-1，现在是 work",
    );
  });
});
