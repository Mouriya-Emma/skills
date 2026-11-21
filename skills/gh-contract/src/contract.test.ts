import { describe, expect, test } from "bun:test";
import { type CheckResult, checkEvidence } from "./evidence/check.ts";
import type { EvidenceRecord } from "./evidence/record.ts";
import { packComplete, parsePack, renderPack, toPack } from "./evidence/render.ts";
import { clauseText } from "./fetch.ts";
import { gateEntries, latestValid, parseHeader, renderHeader } from "./gate.ts";
import type { IssueData, PrData } from "./github.ts";
import { codeRepo, type IssueBody, parseIssue, type TypedOutcome } from "./issue.ts";
import { checkPlacement, checkTreePr } from "./pr.ts";
import type { Ref } from "./ref.ts";
import { requirementFor } from "./requirements.ts";

const repo = { owner: "acme", name: "app" };
const errors = (text: string, hasParent = false) =>
  parseIssue(text, { repo, hasParent }).diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
const warnings = (text: string) => parseIssue(text, { repo, hasParent: false }).diagnostics.filter((d) => d.severity === "warn").map((d) => d.message);

const SCENE = ["运行 `app run` 得到：", "```text", "error: field missing", "```"];

function standard(opts: { faces?: string[]; form?: string; outcomes?: string[]; extraScope?: string; scene?: string[]; extra?: string[] } = {}): string {
  const faces = opts.faces ?? ["cli"];
  return [
    "# 标题",
    "",
    "## 现场",
    ...(opts.scene ?? SCENE),
    "## 目标",
    "x",
    "## 原因",
    "x",
    "## 责任与必要决策",
    "x",
    "## 预期结果",
    ...(opts.outcomes ?? ["- 结果 1 [改]：输出包含新字段"]),
    "## 范围边界",
    "x",
    "## 影响范围",
    ...faces.map((f) => `- ${f}`),
    ...(opts.extraScope === undefined ? [] : [opts.extraScope]),
    "## 测试形态",
    opts.form ?? "e2e",
    ...(opts.extra ?? []),
  ].join("\n");
}

const standardBody = (text: string, hasParent = false): Extract<IssueBody, { kind: "standard" }> => {
  const body = parseIssue(text, { repo, hasParent }).value;
  if (body?.kind !== "standard") throw new Error("expected a standard issue body");
  return body;
};

describe("issue contract", () => {
  test("a well-formed standard issue has no errors", () => {
    expect(errors(standard())).toEqual([]);
  });

  test("the scene must carry the thing itself, not only a retelling", () => {
    expect(errors(standard({ scene: ["用户说导出很慢，体验不好。"] }))).toEqual(["现场没有原样记录：贴出当时的输出、日志或截图，或引用原文并给出链接"]);
    expect(errors(standard({ scene: ["> 导出 3 万行用了 4 分钟", "见 https://example.com/run/1"] }))).toEqual([]);
    expect(errors(standard({ scene: [""] }))).toEqual(["现场是空的：写提出这条 issue 时已经发生的事"]);
  });

  test("an issue without a scene is rejected", () => {
    expect(errors(standard().replace("## 现场", "## 背景"))).toContain("缺少「## 现场」段");
  });

  test("every result carries a kind tag, and without one no evidence can be planned", () => {
    const text = standard({ outcomes: ["- 结果 1 [改]：a", "- 结果 2：b", "- 结果 3 [修]：c"] });
    expect(errors(text)).toEqual(["结果 2 要标类型：[改]、[新]、[删] 或 [保持]", "结果 3 要标类型：[改]、[新]、[删] 或 [保持]（现在是 [修]）"]);
    expect(parseIssue(text, { repo, hasParent: false }).value).toBeNull();
  });

  test("results parse their kind, and only an integration issue names children a result passes through", () => {
    const body = standardBody(standard({ outcomes: ["- 结果 1 [新]：a", "- 结果 2 [保持]：b"] }));
    expect(body.outcomes.map((o) => [o.id, o.kind, o.text])).toEqual([[1, "新", "a"], [2, "保持", "b"]]);
    expect(errors(standard({ outcomes: ["- 结果 1 [改]；经由 #12：a"] }))).toEqual(["结果 1：只有总体验收 issue 的结果写「经由」"]);
  });

  test("a result's digest follows its wording, sub-bullets included, and nothing else in the body", () => {
    const digest = (text: string) => standardBody(text).outcomes[0]?.digest;
    const base = standard({ outcomes: ["- 结果 1 [改]：拒绝非法输入", "  - 401：提示重新登录"] });
    expect(digest(base.replace("## 目标\nx", "## 目标\n改写了目标"))).toBe(digest(base));
    expect(digest(base.replace("提示重新登录", "跳转登录页"))).not.toBe(digest(base));
    expect(digest(base.replace("[改]", "[新]"))).not.toBe(digest(base));
  });

  test("an acceptance table is not part of an issue", () => {
    const text = standard({ extra: ["## 验收标准", "| # | 面 | Check | Env | Expect |", "|---|---|---|---|---|", "| 1 | cli | 覆盖 结果 1：x | 本地 | ok |"] });
    expect(errors(text)).toEqual(["issue 不写「## 验收标准」：怎样观察由采集证据的人在实现后决定，证据挂在预期结果上"]);
  });

  test("a standalone issue must be e2e; inside a tree 集成 is allowed", () => {
    expect(errors(standard({ form: "集成" }))).toContain("不在 issue 树里的 issue 只能是 e2e（当前 集成）：没有总体验收接手");
    expect(errors(standard({ form: "集成" }), true)).toEqual([]);
  });

  test("iac only admits e2e", () => {
    expect(errors(standard({ faces: ["iac"], form: "集成" }), true)).toContain("面 iac 不允许测试形态 集成，可选：e2e");
  });

  test("crossing families needs a packaging reason, and is still warned", () => {
    expect(errors(standard({ faces: ["gui", "iac"] }))).toContain("打包 issue：跨 应用/基础设施，必须写「打包理由：…」；跨 repo 的组合必须拆分");
    const packed = standard({ faces: ["gui", "iac"], extraScope: "打包理由：同一 repo 内的路由与页面必须一起上线" });
    expect(errors(packed)).toEqual([]);
    expect(warnings(packed)).toContain("打包 issue：跨 应用/基础设施，不推荐，应拆分");
  });

  test("integration results must name the children they pass through", () => {
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
      "- 结果 1 [新]；经由 #12 acme/infra#40：提交后可读",
      "- 结果 2 [新]：缺经由",
      "## 依赖关系",
      "- Depends on: #12, acme/infra#40",
    ].join("\n");
    const parsed = parseIssue(text, { repo, hasParent: true });
    const body = parsed.value;
    expect(body?.kind).toBe("integration");
    const outcomes: readonly TypedOutcome[] = body?.kind === "integration" ? body.outcomes : [];
    expect(outcomes[0]?.via.map((r) => `${r.repo.name}#${r.number}`)).toEqual(["app#12", "infra#40"]);
    expect(parsed.diagnostics.map((d) => d.message)).toEqual(["结果 2 缺少「经由」：总体验收的每条结果写明经过哪些 child"]);
  });

  test("a no-code issue lists exact paths, never globs, and its results carry no kind", () => {
    const text = (outcome: string) =>
      ["# t", "类型：无代码变更", "## 现场", "> 旧说法", "## 目标", "x", "## 范围", "- docs/a.md", "- docs/*.md", "## 预期结果", outcome, "## 范围边界", "x"].join("\n");
    expect(errors(text("- 结果 1：x"))).toEqual(["范围「docs/*.md」含通配符；无代码变更 issue 只列确切路径"]);
    expect(errors(text("- 结果 1 [改]：x"))).toContain("结果 1：无代码变更 issue 的结果不标类型，也不写「经由」");
  });
});

describe("evidence requirements", () => {
  const steps = (face: Parameters<typeof requirementFor>[0], kind: Parameters<typeof requirementFor>[1]) =>
    requirementFor(face, kind).steps.map((s) => `${s.step}@${s.anchor}${s.needsImage ? "+image" : ""}`);

  test("a changed or preserved result is shown before and after; a new or removed one only after", () => {
    expect(steps("cli", "改")).toEqual(["before@base", "run@head"]);
    expect(steps("cli", "保持")).toEqual(["before@base", "run@head"]);
    expect(steps("cli", "新")).toEqual(["run@head"]);
    expect(steps("cli", "删")).toEqual(["run@head"]);
    expect(steps("gui", "改")).toEqual(["before@base+image", "after@head+image"]);
    expect(steps("gui", "新")).toEqual(["after@head+image"]);
  });

  test("a preview or a migration already shows what it replaces", () => {
    expect(steps("iac", "改")).toEqual(["preview@head", "apply@head", "readback@head"]);
    expect(steps("data", "改")).toEqual(["migrate@head", "readback@head"]);
  });
});

const issueData = (body = ""): IssueData => ({
  ref: { repo, number: 7 },
  nodeId: "I_test",
  title: "t",
  state: "OPEN",
  stateReason: null,
  body,
  createdAt: "2026-11-01T00:00:00Z",
  bodyRev: "2026-11-02T00:00:00Z",
  url: "https://github.com/acme/app/issues/7",
  parent: null,
  subIssues: [],
  comments: [],
});

const HEAD = "a".repeat(40);

function recordFor(o: TypedOutcome, over: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "r1",
    issue: "acme/app#7",
    results: [{ id: o.id, digest: o.digest }],
    face: "cli",
    kind: o.kind,
    step: "run",
    shows: "输出第二行出现 `new_field`",
    capture: { kind: "run", command: "app run | grep `x`", shell: "/bin/zsh", cwd: "/w", completion: { kind: "exited", code: 0 }, stdoutLines: 1, stderrLines: 0 },
    startedAt: "2026-11-03T00:00:00.000Z",
    endedAt: "2026-11-03T00:00:01.500Z",
    checkouts: [{ repo: "acme/app", path: "/w", head: HEAD, cleanBefore: true, cleanAfter: true }],
    attachments: [],
    ...over,
  };
}

describe("evidence check", () => {
  // Integration mode judges records without a git checkout: it owes only the head-anchored steps.
  const mode = { kind: "integration" as const, merges: [] };
  const check = (text: string, records: (body: Extract<IssueBody, { kind: "standard" }>) => EvidenceRecord[]): Promise<CheckResult> => {
    const body = standardBody(text);
    return checkEvidence(issueData(text), body, records(body), mode);
  };
  const first = (body: Extract<IssueBody, { kind: "standard" }>): TypedOutcome => {
    const o = body.outcomes[0];
    if (o === undefined) throw new Error("no outcome");
    return o;
  };

  test("a record proves the result it was taken for", async () => {
    const r = await check(standard({ outcomes: ["- 结果 1 [新]：a"] }), (b) => [recordFor(first(b))]);
    expect(r.complete).toBe(true);
  });

  test("rewording a result makes its evidence stale; rewording another part of the issue does not", async () => {
    const before = standard({ outcomes: ["- 结果 1 [新]：a"] });
    const taken = recordFor(first(standardBody(before)));
    const reworded = await check(before.replace("：a", "：b"), () => [taken]);
    expect(reworded.outcomes[0]?.steps[0]?.status).toEqual({ kind: "stale", reason: "结果 1 的文字在采集之后改过" });
    const elsewhere = await check(before.replace("## 目标\nx", "## 目标\n另一种说法"), () => [taken]);
    expect(elsewhere.complete).toBe(true);
  });

  test("the collector's kind decides the template when it differs from the issue's tag", async () => {
    const r = await check(standard({ faces: ["service"], outcomes: ["- 结果 1 [改]：a"] }), (b) => [
      recordFor(first(b), { face: "service", kind: "新", step: "request" }),
    ]);
    expect(r.outcomes[0]?.kind).toBe("新");
    expect(r.outcomes[0]?.steps.map((s) => `${s.rule.step}:${s.status.kind}`)).toEqual(["request:linked", "log:missing"]);
  });

  test("a declared face nothing was observed through keeps the evidence incomplete", async () => {
    const r = await check(standard({ faces: ["cli", "library"], outcomes: ["- 结果 1 [新]：a"] }), (b) => [recordFor(first(b))]);
    expect(r.unseenFaces).toEqual(["library"]);
    expect(r.complete).toBe(false);
  });
});

describe("evidence pack", () => {
  test("a rendered pack parses back to the same summary and tells the reviewer what each record shows", async () => {
    const text = standard({ faces: ["cli", "gui"], outcomes: ["- 结果 1 [新]：输出包含新字段", "- 结果 2 [删]：旧开关消失"] });
    const body = standardBody(text);
    const o1 = body.outcomes[0];
    if (o1 === undefined) throw new Error("no outcome");
    const record = recordFor(o1);
    const check = await checkEvidence(issueData(text), body, [record], { kind: "integration", merges: [] });
    const pack = toPack(check, "2026-11-03T00:00:02Z");
    const rendered = renderPack(
      pack,
      [{ record, stdout: { text: "ok", total: 1, shown: 1, cut: false }, stderr: { text: "", total: 0, shown: 0, cut: false } }],
      check,
    );
    expect(parsePack(rendered)).toEqual(pack);
    expect(pack.linked).toBe(1);
    expect(pack.unseenFaces).toEqual(["gui"]);
    expect(packComplete(pack)).toBe(false);
    expect(rendered).toContain("### 结果 1 · 新功能 · cli");
    expect(rendered).toContain("看点：输出第二行出现 `new_field`");
    expect(rendered).toContain("### 结果 2 · 删功能 · cli");
  });

  test("an edited comment that lost its header is not a pack", () => {
    expect(parsePack("## 证据包\n\n| a | b |\n|---|---|\n")).toBeNull();
  });
});

describe("code repo", () => {
  test("the 上下文 Repo field names the repo whose buffer receives the PR; without it the issue's repo does", () => {
    const body = (repoLine: string) => `## 目标\nx\n\n## 上下文\n\n${repoLine}\n- **Conventions**: x\n\n## 原因\nx`;
    expect(codeRepo(body("- **Repo**: `acme/lib`（PR 开在这里）"), repo)).toEqual({ owner: "acme", name: "lib" });
    expect(codeRepo(body("- **Repo**: acme/lib"), repo)).toEqual({ owner: "acme", name: "lib" });
    expect(codeRepo(body("- **Design doc / source**: acme/lib#3"), repo)).toEqual(repo);
    expect(codeRepo("## 目标\nx", repo)).toEqual(repo);
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
    const hFail = { verdict: { kind: "fail" as const, gate: null }, head: "b".repeat(40), base: "main", issueRev: "2026-11-02T00:00:00Z", design: null };
    const lineFail = renderHeader(hFail);
    expect(lineFail).toBe(`Gate 结论 · review · FAIL · HEAD ${"b".repeat(40)} · base main · issue rev 2026-11-02T00:00:00Z · 设计 无`);
    expect(parseHeader(`${lineFail}\n\n发现……`)).toEqual(hFail);

    const hLegacy = { verdict: { kind: "fail" as const, gate: 3 }, head: "b".repeat(40), base: "main", issueRev: "2026-11-02T00:00:00Z", design: null };
    const lineLegacy = renderHeader(hLegacy);
    expect(lineLegacy).toBe(`Gate 结论 · review · FAIL@Gate3 · HEAD ${"b".repeat(40)} · base main · issue rev 2026-11-02T00:00:00Z · 设计 无`);
    expect(parseHeader(`${lineLegacy}\n\n发现……`)).toEqual(hLegacy);

    expect(parseHeader("Gate 结论 · review · PASS · HEAD abc · base main · issue rev x · 设计 无")).toBeNull();
  });

  test("a PASS verdict stays valid after HEAD advances to resolve merge conflicts, whereas FAIL goes stale", () => {
    const h1 = "a".repeat(40);
    const h2 = "c".repeat(40);
    const iss = issueData();
    const failHeader = renderHeader({ verdict: { kind: "fail", gate: null }, head: h1, base: "tree/acme-app-1", issueRev: iss.bodyRev, design: null });
    const passHeader = renderHeader({ verdict: { kind: "pass" }, head: h1, base: "tree/acme-app-1", issueRev: iss.bodyRev, design: null });
    const prAfterConflictMerge: PrData = {
      ref: { repo, number: 77 },
      title: "p",
      state: "OPEN",
      isDraft: false,
      body: "Closes acme/app#7",
      url: "u",
      headRefOid: h2,
      headRefName: "fix/7",
      headRepo: repo,
      baseRefName: "tree/acme-app-1",
      baseRefOid: "b".repeat(40),
      mergeable: "MERGEABLE",
      defaultBranch: "main",
      checks: [],
      closingIssues: [],
      files: [],
      commits: [],
      comments: [
        { id: "c1", author: "r", createdAt: "2026-11-03T00:00:00Z", updatedAt: "2026-11-03T00:00:00Z", url: "u1", body: failHeader },
        { id: "c2", author: "r", createdAt: "2026-11-03T01:00:00Z", updatedAt: "2026-11-03T01:00:00Z", url: "u2", body: passHeader },
      ],
    };
    const entries = gateEntries(prAfterConflictMerge, iss);
    expect(entries[0]?.stale).toEqual([`HEAD 已从 ${h1.slice(0, 7)} 变为 ${h2.slice(0, 7)}`]);
    expect(entries[1]?.stale).toEqual([]);
    expect(latestValid(entries)?.header.verdict).toEqual({ kind: "pass" });
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
