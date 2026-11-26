import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type CheckResult, checkEvidence, type OutcomeStatus, outcomeVerdict, type Proof, type StepStatus } from "./evidence/check.ts";
import { type EvidenceRecord, loadRecords } from "./evidence/record.ts";
import { packComplete, parsePack, renderPack, toPack } from "./evidence/render.ts";
import { clauseText } from "./fetch.ts";
import { type GateHeader, gateEntries, headerFor, latestValid, parseHeader, renderHeader } from "./gate.ts";
import type { Comment, IssueData, PrData, PrState } from "./github.ts";
import { codeRepo, type IssueBody, parseIssue, type TypedOutcome } from "./issue.ts";
import { checkWaitDecision, type LandDeps, landOrder, landPipeline, type Pipeline, readbackIssue, readbackTree, type ReadbackDeps, rebaseOnto, type RebaseOutcome } from "./land.ts";
import { checkPrMergeReady } from "./merge.ts";
import { err, FACES, templateOf } from "./model.ts";
import { EMPTY_PATCH, localPatchId, patchIdOfDiff } from "./patch.ts";
import { checkPlacement, checkTreePr } from "./pr.ts";
import type { Ref } from "./ref.ts";
import { defaultStep, requirementFor } from "./requirements.ts";

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

const firstOutcome = (body: Extract<IssueBody, { kind: "standard" }>): TypedOutcome => {
  const o = body.outcomes[0];
  if (o === undefined) throw new Error("no outcome");
  return o;
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

  test("a standalone issue must be e2e; a tree child never is, its feature e2e belongs to the integration issue", () => {
    expect(errors(standard({ form: "集成" }))).toContain("不在 issue 树里的 issue 只能是 e2e（当前 集成）：没有总体验收接手");
    expect(errors(standard({ form: "集成" }), true)).toEqual([]);
    expect(errors(standard({ form: "e2e" }), true)).toEqual(["树内 child 不做 e2e：选 集成 或 最薄入口，功能 e2e 由总体验收 issue 在缓冲分支上做"]);
  });

  test("iac and agent-config have no thinnest entry, so a tree child on them is 集成", () => {
    expect(errors(standard({ faces: ["iac"], form: "集成" }), true)).toEqual([]);
    expect(errors(standard({ faces: ["agent-config"], form: "最薄入口" }), true)).toContain("面 agent-config 不允许测试形态 最薄入口，可选：e2e、集成");
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
  test("no face owes a before step: the changed product is observed at its new behaviour only", () => {
    const steps: string[] = FACES.flatMap((face) => requirementFor(face).steps.map((s) => s.step));
    expect(steps.length).toBeGreaterThan(0);
    expect(steps).not.toContain("before");
  });

  test("iac owes an ordered preview, apply and readback", () => {
    expect(requirementFor("iac")).toEqual({
      steps: [
        { step: "preview", needsImage: false },
        { step: "apply", needsImage: false },
        { step: "readback", needsImage: false },
      ],
      ordered: true,
    });
  });

  test("gui needs an image of the result", () => {
    expect(requirementFor("gui")).toEqual({ steps: [{ step: "after", needsImage: true }], ordered: false });
  });

  test("a step may be omitted only when its face owes exactly one", () => {
    expect(defaultStep("gui")).toBe("after");
    expect(defaultStep("cli")).toBe("run");
    expect(defaultStep("service")).toBeNull();
    expect(defaultStep("data")).toBeNull();
  });

  test("the changed and preserved templates no longer promise a before/after pair", () => {
    expect(templateOf("改")).toBe("改功能");
    expect(templateOf("保持")).toBe("保持不变");
    expect(templateOf("新")).toBe("新功能");
    expect(templateOf("删")).toBe("删功能");
  });
});

const root = mkdtempSync(join(tmpdir(), "ghc-contract-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function git(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

let repoCount = 0;

/** A fresh repo under the temporary root: `main` holds `files`, origin looks like the fixture repo. */
function newRepo(files: Record<string, string> = { "a.txt": "1\n" }): { dir: string; first: string } {
  const dir = join(root, `repo${repoCount++}`);
  mkdirSync(dir);
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "remote", "add", "origin", "https://github.com/acme/app.git");
  return { dir, first: commit(dir, files) };
}

/** Commit the given files (path → content) on the current branch; returns the new HEAD. */
function commit(dir: string, files: Record<string, string>): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "c");
  return git(dir, "rev-parse", "HEAD");
}

describe("patch identity", () => {
  test("a clean rebase onto an advanced base keeps the patch id", async () => {
    const { dir } = newRepo({ "a.txt": "1\n", "c.txt": "1\n" });
    git(dir, "checkout", "-b", "work");
    commit(dir, { "a.txt": "2\n" });
    const before = await localPatchId(dir, "main");
    expect(before).not.toBe(EMPTY_PATCH);
    git(dir, "checkout", "main");
    commit(dir, { "c.txt": "2\n" });
    git(dir, "checkout", "work");
    const r = await rebaseOnto(dir, "main");
    if (r.kind !== "rebased") throw new Error(`expected a rebase, got ${r.kind}`);
    expect(r.oldPatch).toBe(before);
    expect(r.newPatch).toBe(before);
    expect(r.newHead).not.toBe(r.oldHead);
  });

  test("editing an own hunk changes the patch id", async () => {
    const { dir } = newRepo({ "a.txt": "1\n", "c.txt": "1\n" });
    git(dir, "checkout", "-b", "work");
    commit(dir, { "a.txt": "2\n" });
    const before = await localPatchId(dir, "main");
    git(dir, "checkout", "main");
    commit(dir, { "c.txt": "2\n" });
    git(dir, "checkout", "work");
    const r = await rebaseOnto(dir, "main");
    if (r.kind !== "rebased") throw new Error(`expected a rebase, got ${r.kind}`);
    commit(dir, { "a.txt": "3\n" });
    const after = await localPatchId(dir, "main");
    expect(after).not.toBe(before);
    expect(after).not.toBe(r.newPatch);
  });

  test("a checkout already on its base, and an empty diff, are the fixed empty patch", async () => {
    const { dir } = newRepo();
    expect(await localPatchId(dir, "main")).toBe(EMPTY_PATCH);
    expect(await patchIdOfDiff("")).toBe(EMPTY_PATCH);
    expect(await patchIdOfDiff(" \n\t\n")).toBe(EMPTY_PATCH);
    expect(EMPTY_PATCH).toBe("0".repeat(40));
  });

  test("a conflicting rebase reports the files, aborts, and leaves HEAD untouched with no merge commit", async () => {
    const { dir } = newRepo({ "a.txt": "base\n" });
    git(dir, "checkout", "-b", "work");
    const workHead = commit(dir, { "a.txt": "work\n" });
    git(dir, "checkout", "main");
    commit(dir, { "a.txt": "main\n" });
    git(dir, "checkout", "work");
    const r = await rebaseOnto(dir, "main");
    expect(r).toEqual({ kind: "conflict", files: ["a.txt"] });
    expect(git(dir, "rev-parse", "HEAD")).toBe(workHead);
    expect(git(dir, "rev-parse", "--abbrev-ref", "HEAD")).toBe("work");
    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(git(dir, "rev-list", "--count", "--merges", "HEAD")).toBe("0");
    expect(git(dir, "rev-list", "--count", "HEAD")).toBe("2");
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
const H2 = "c".repeat(40);
const P1 = "1".repeat(40);
const P2 = "2".repeat(40);

const prData = (over: Partial<PrData> = {}): PrData => ({
  ref: { repo, number: 77 },
  title: "p",
  state: "OPEN",
  isDraft: false,
  body: "Closes acme/app#7",
  url: "u",
  headRefOid: HEAD,
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
  comments: [],
  ...over,
});

const comment = (id: number, createdAt: string, body: string): Comment => ({ id, author: "r", createdAt, url: `u${id}`, body });

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
    checkouts: [{ repo: "acme/app", path: "/w", head: HEAD, patchId: null, cleanBefore: true, cleanAfter: true }],
    attachments: [],
    ...over,
  };
}

const localMode = (dir: string) => ({ kind: "local" as const, checkout: { path: dir, repo }, baseRef: "main" });

const checkLocal = async (dir: string, text: string, records: readonly EvidenceRecord[]): Promise<CheckResult> => {
  const body = standardBody(text);
  return checkEvidence(issueData(text), body, records, localMode(dir));
};

describe("evidence check", () => {
  // Integration mode judges records without a checkout: every face falls back to records.
  const mode = { kind: "integration" as const, merges: [] };
  const check = (text: string, records: (body: Extract<IssueBody, { kind: "standard" }>) => EvidenceRecord[]): Promise<CheckResult> => {
    const body = standardBody(text);
    return checkEvidence(issueData(text), body, records(body), mode);
  };

  test("a record proves the result it was taken for", async () => {
    const r = await check(standard({ outcomes: ["- 结果 1 [新]：a"] }), (b) => [recordFor(firstOutcome(b))]);
    expect(r.complete).toBe(true);
  });

  test("rewording a result makes its evidence stale; rewording another part of the issue does not", async () => {
    const before = standard({ outcomes: ["- 结果 1 [新]：a"] });
    const taken = recordFor(firstOutcome(standardBody(before)));
    const reworded = await check(before.replace("：a", "：b"), () => [taken]);
    expect(reworded.outcomes[0]?.proof).toEqual({
      kind: "records",
      steps: [{ rule: { step: "run", needsImage: false }, status: { kind: "stale", reason: "结果 1 的文字在采集之后改过" } }],
      orderProblem: null,
    });
    const elsewhere = await check(before.replace("## 目标\nx", "## 目标\n另一种说法"), () => [taken]);
    expect(elsewhere.complete).toBe(true);
  });

  test("the collector's kind decides the template when it differs from the issue's tag", async () => {
    const r = await check(standard({ faces: ["service"], outcomes: ["- 结果 1 [改]：a"] }), (b) => [
      recordFor(firstOutcome(b), { face: "service", kind: "新", step: "request" }),
    ]);
    expect(r.outcomes[0]?.kind).toBe("新");
    const proof = r.outcomes[0]?.proof;
    expect(proof?.kind).toBe("records");
    expect(proof !== undefined && proof.kind === "records" ? proof.steps.map((s) => `${s.rule.step}:${s.status.kind}`) : null).toEqual(["request:linked", "log:missing"]);
  });

  test("a declared face nothing was observed through keeps the evidence incomplete", async () => {
    const r = await check(standard({ faces: ["cli", "library"], outcomes: ["- 结果 1 [新]：a"] }), (b) => [recordFor(firstOutcome(b))]);
    expect(r.unseenFaces).toEqual(["library"]);
    expect(r.complete).toBe(false);
  });
});

describe("evidence check on a PR", () => {
  const checkPr = (text: string, checks: PrData["checks"], records: readonly EvidenceRecord[] = []): Promise<CheckResult> =>
    checkEvidence(issueData(text), standardBody(text), records, { kind: "pr", pr: prData({ checks }) }, { patch: P1, base: null });

  test("test: success proves every testable result, so a PR with no records is complete", async () => {
    const text = standard({ outcomes: ["- 结果 1 [新]：a", "- 结果 2 [改]：b"] });
    const r = await checkPr(text, [{ name: "test", state: "success" }]);
    expect(r.complete).toBe(true);
    expect(r.outcomes.map((x) => x.proof)).toEqual([
      { kind: "test", state: "success" },
      { kind: "test", state: "success" },
    ]);
  });

  test("without a test check the same PR needs records and is incomplete bare", async () => {
    const text = standard({ outcomes: ["- 结果 1 [新]：a"] });
    const r = await checkPr(text, []);
    expect(r.complete).toBe(false);
    expect(r.outcomes[0]?.proof).toEqual({
      kind: "records",
      steps: [{ rule: { step: "run", needsImage: false }, status: { kind: "missing" } }],
      orderProblem: null,
    });
    expect(r.unseenFaces).toEqual([]);
  });

  test("a pending or failing test check leaves the PR incomplete", async () => {
    const text = standard({ outcomes: ["- 结果 1 [新]：a"] });
    const pending = await checkPr(text, [{ name: "test", state: "pending" }]);
    expect(pending.complete).toBe(false);
    expect(pending.outcomes[0]?.proof).toEqual({ kind: "test", state: "pending" });
    const failing = await checkPr(text, [{ name: "test", state: "failure" }]);
    expect(failing.complete).toBe(false);
    expect(failing.outcomes[0]?.proof).toEqual({ kind: "test", state: "failure" });
  });

  test("a mixed service and gui PR with test: success still needs a gui record", async () => {
    const text = standard({ faces: ["service", "gui"], outcomes: ["- 结果 1 [新]：接口返回新字段", "- 结果 2 [新]：页面显示新字段"] });
    const gui = standardBody(text).outcomes[1];
    if (gui === undefined) throw new Error("no second outcome");
    const record = recordFor(gui, {
      face: "gui",
      step: "after",
      attachments: [{ source: "shot.png", url: "https://example.com/shot.png", contentType: "image/png", bytes: 10 }],
    });
    const without = await checkPr(text, [{ name: "test", state: "success" }]);
    expect(without.outcomes.map((x) => x.proof.kind)).toEqual(["test", "test"]);
    expect(without.unseenFaces).toEqual(["gui"]);
    expect(without.complete).toBe(false);
    const withRecord = await checkPr(text, [{ name: "test", state: "success" }], [record]);
    expect(withRecord.outcomes.map((x) => [x.face, outcomeVerdict(x)])).toEqual([
      ["service", "linked"],
      ["gui", "linked"],
    ]);
    expect(withRecord.unseenFaces).toEqual([]);
    expect(withRecord.complete).toBe(true);
  });
});

describe("evidence check for testable faces", () => {
  test("a testable issue owes no records: the test check proves every result", async () => {
    const text = standard({ outcomes: ["- 结果 1 [新]：a", "- 结果 2 [改]：b"] });
    const { dir } = newRepo();
    const r = await checkLocal(dir, text, []);
    expect(r.complete).toBe(true);
    expect(r.outcomes.map((x) => x.proof)).toEqual([
      { kind: "test", state: "deferred" },
      { kind: "test", state: "deferred" },
    ]);
    expect(r.unseenFaces).toEqual([]);
  });

  test("a pending or failing test check does not prove a testable result", () => {
    const o = firstOutcome(standardBody(standard()));
    const outcome = (state: "success" | "deferred" | "pending" | "failure"): OutcomeStatus => ({ outcome: o, face: "service", kind: o.kind, proof: { kind: "test", state } });
    expect(outcomeVerdict(outcome("success"))).toBe("linked");
    expect(outcomeVerdict(outcome("deferred"))).toBe("linked");
    expect(outcomeVerdict(outcome("pending"))).toBe("invalid");
    expect(outcomeVerdict(outcome("failure"))).toBe("invalid");
  });

  test("a mixed service and gui issue needs a gui record but no service records", async () => {
    const text = standard({ faces: ["service", "gui"], outcomes: ["- 结果 1 [新]：接口返回新字段", "- 结果 2 [新]：页面显示新字段"] });
    const { dir, first } = newRepo();
    const body = standardBody(text);
    const gui = body.outcomes[1];
    if (gui === undefined) throw new Error("no second outcome");
    const record = recordFor(gui, {
      face: "gui",
      step: "after",
      checkouts: [{ repo: "acme/app", path: dir, head: first, patchId: null, cleanBefore: true, cleanAfter: true }],
      attachments: [{ source: "shot.png", url: "https://example.com/shot.png", contentType: "image/png", bytes: 10 }],
    });
    const r = await checkLocal(dir, text, [record]);
    expect(r.outcomes.map((x) => [x.face, x.proof.kind, outcomeVerdict(x)])).toEqual([
      ["service", "test", "linked"],
      ["gui", "records", "linked"],
    ]);
    expect(r.unseenFaces).toEqual([]);
    expect(r.complete).toBe(true);
  });

  test("a gui record without an image does not prove the gui result", async () => {
    const text = standard({ faces: ["gui"], outcomes: ["- 结果 1 [新]：页面显示新字段"] });
    const { dir, first } = newRepo();
    const record = recordFor(firstOutcome(standardBody(text)), {
      face: "gui",
      step: "after",
      checkouts: [{ repo: "acme/app", path: dir, head: first, patchId: null, cleanBefore: true, cleanAfter: true }],
    });
    const r = await checkLocal(dir, text, [record]);
    expect(r.outcomes[0]?.proof).toEqual({
      kind: "records",
      steps: [{ rule: { step: "after", needsImage: true }, status: { kind: "invalid", reason: "缺截图" } }],
      orderProblem: null,
    });
    expect(r.complete).toBe(false);
  });
});

describe("evidence check after the HEAD moved", () => {
  const text = standard({ faces: ["agent-config"], outcomes: ["- 结果 1 [新]：新指令生效"] });
  const recordAt = (dir: string, taken: string): EvidenceRecord =>
    recordFor(firstOutcome(standardBody(text)), {
      face: "agent-config",
      step: "session",
      capture: { kind: "attach" },
      checkouts: [{ repo: "acme/app", path: dir, head: taken, patchId: null, cleanBefore: true, cleanAfter: true }],
    });

  /** Evidence taken at `taken` is judged against whatever the checkout's HEAD is now. */
  const statusAt = async (dir: string, taken: string): Promise<OutcomeStatus["proof"] | undefined> => {
    const r = await checkLocal(dir, text, [recordAt(dir, taken)]);
    return r.outcomes[0]?.proof;
  };

  const stepped = (status: StepStatus): Proof => ({ kind: "records", steps: [{ rule: { step: "session", needsImage: false }, status }], orderProblem: null });

  test("only Markdown changed since the record: it stays linked", async () => {
    const { dir, first } = newRepo({ "src/a.ts": "1", "README.md": "1" });
    commit(dir, { "README.md": "2", "docs/Guide.MD": "new" });
    expect(await statusAt(dir, first)).toEqual(stepped({ kind: "linked", record: recordAt(dir, first) }));
  });

  test("a code file changed next to Markdown: stale, naming the files", async () => {
    const { dir, first } = newRepo({ "src/a.ts": "1", "README.md": "1" });
    const head = commit(dir, { "README.md": "2", "src/a.ts": "2" });
    const proof = await statusAt(dir, first);
    expect(proof?.kind).toBe("records");
    expect(proof !== undefined && proof.kind === "records" ? proof.steps[0]?.status : null).toEqual({
      kind: "stale",
      reason: `采于 ${first.slice(0, 7)}，当前 HEAD ${head.slice(0, 7)}；之后改动 README.md, src/a.ts`,
    });
  });

  test("a code file renamed to a Markdown name is still a code change", async () => {
    const { dir, first } = newRepo({ "src/a.ts": "1", "README.md": "1" });
    git(dir, "mv", "src/a.ts", "src/a.md");
    commit(dir, {});
    const proof = await statusAt(dir, first);
    expect(proof !== undefined && proof.kind === "records" ? proof.steps[0]?.status.kind : null).toBe("stale");
  });

  test("a HEAD that does not descend from the record's HEAD is stale even when only Markdown differs", async () => {
    const { dir, first } = newRepo({ "src/a.ts": "1", "README.md": "1" });
    git(dir, "checkout", "-b", "other");
    const side = commit(dir, { "NOTES.md": "x" });
    git(dir, "checkout", "main");
    const head = commit(dir, { "README.md": "2" });
    const proof = await statusAt(dir, side);
    expect(proof?.kind).toBe("records");
    expect(proof !== undefined && proof.kind === "records" ? proof.steps[0]?.status : null).toEqual({
      kind: "stale",
      reason: `采于 ${side.slice(0, 7)}，当前 HEAD ${head.slice(0, 7)}；当前 HEAD 不是采集 HEAD 的后代`,
    });
    expect(first).not.toBe(side);
  });
});

describe("evidence records on the target patch", () => {
  const text = standard({ faces: ["agent-config"], outcomes: ["- 结果 1 [新]：新指令生效"] });
  const recordAt = (dir: string, head: string, patchId: string | null): EvidenceRecord =>
    recordFor(firstOutcome(standardBody(text)), {
      face: "agent-config",
      step: "session",
      capture: { kind: "attach" },
      checkouts: [{ repo: "acme/app", path: dir, head, patchId, cleanBefore: true, cleanAfter: true }],
    });

  test("a record stays linked across a clean rebase: its checkout patch equals the current patch although HEAD moved", async () => {
    const { dir } = newRepo({ "a.txt": "1\n", "c.txt": "1\n" });
    git(dir, "checkout", "-b", "work");
    const taken = commit(dir, { "a.txt": "2\n" });
    const patch = await localPatchId(dir, "main");
    git(dir, "checkout", "main");
    commit(dir, { "c.txt": "2\n" });
    git(dir, "checkout", "work");
    const rebased = await rebaseOnto(dir, "main");
    if (rebased.kind !== "rebased") throw new Error(`expected a rebase, got ${rebased.kind}`);
    expect(rebased.newHead).not.toBe(taken);
    const r = await checkLocal(dir, text, [recordAt(dir, taken, patch)]);
    expect(r.outcomes[0]?.proof.kind).toBe("records");
    expect(outcomeVerdict(r.outcomes[0] as OutcomeStatus)).toBe("linked");
    expect(r.complete).toBe(true);
  });

  test("editing the PR's own hunk after capture goes stale, naming both patches and the file", async () => {
    const { dir } = newRepo();
    git(dir, "checkout", "-b", "work");
    const taken = commit(dir, { "a.txt": "2\n" });
    const takenPatch = await localPatchId(dir, "main");
    commit(dir, { "a.txt": "3\n" });
    const current = await localPatchId(dir, "main");
    const r = await checkLocal(dir, text, [recordAt(dir, taken, takenPatch)]);
    expect(r.outcomes[0]?.proof).toEqual({
      kind: "records",
      steps: [
        {
          rule: { step: "session", needsImage: false },
          status: { kind: "stale", reason: `patch 已从 ${takenPatch.slice(0, 7)} 变为 ${current.slice(0, 7)}；之后改动 a.txt` },
        },
      ],
      orderProblem: null,
    });
    expect(r.complete).toBe(false);
  });
});

describe("evidence store", () => {
  test("a stored before-step record is skipped, not parsed, and does not hide valid records", async () => {
    const state = join(root, "state");
    const legacyDir = join(state, "ghc", "acme", "app", "7", "20260101T000000Z-aaaaaa");
    const validDir = join(state, "ghc", "acme", "app", "7", "20260101T010000Z-bbbbbb");
    mkdirSync(legacyDir, { recursive: true });
    mkdirSync(validDir, { recursive: true });
    const legacy = {
      id: "old",
      issue: "acme/app#7",
      results: [],
      face: "cli",
      kind: "改",
      step: "before",
      shows: "x",
      capture: { kind: "attach" },
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:00:00.000Z",
      checkouts: [],
      attachments: [],
    };
    writeFileSync(join(legacyDir, "record.json"), JSON.stringify(legacy));
    const text = standard({ outcomes: ["- 结果 1 [新]：a"] });
    writeFileSync(join(validDir, "record.json"), JSON.stringify(recordFor(firstOutcome(standardBody(text)))));
    const saved = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = state;
    try {
      expect((await loadRecords({ repo, number: 7 })).map((x) => x.record.id)).toEqual(["r1"]);
    } finally {
      if (saved === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = saved;
    }
  });

  test("any other unknown step is still a malformed record, not silently skipped", async () => {
    const state = join(root, "state-bad");
    const dir = join(state, "ghc", "acme", "app", "8", "20260101T000000Z-cccccc");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "record.json"),
      JSON.stringify({ id: "bad", issue: "acme/app#8", results: [], face: "cli", kind: "改", step: "bogus", shows: "x", capture: { kind: "attach" }, startedAt: "t", endedAt: "t", checkouts: [], attachments: [] }),
    );
    const saved = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = state;
    try {
      expect(loadRecords({ repo, number: 8 })).rejects.toThrow("record: unknown step bogus");
    } finally {
      if (saved === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = saved;
    }
  });
});

describe("evidence pack", () => {
  test("a rendered pack parses back to the same summary and tells the reviewer what each record shows", async () => {
    const text = standard({ faces: ["cli", "gui"], outcomes: ["- 结果 1 [新]：输出包含新字段", "- 结果 2 [删]：旧开关消失"] });
    const body = standardBody(text);
    const o1 = firstOutcome(body);
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
  const issue = issueData(standard());
  const passLine = (patch: string, head: string, base = "main") => renderHeader({ verdict: { kind: "pass" }, patch, head, base, issueRev: issue.bodyRev, design: null });
  const failLine = (patch: string, issueRev: string, base = "main") =>
    renderHeader({ verdict: { kind: "fail", gate: null }, patch, head: HEAD, base, issueRev, design: null });
  const entries = (patch: string, comments: readonly Comment[], pr: Partial<PrData> = {}) =>
    gateEntries(prData({ comments, baseRefName: "main", ...pr }), issue, patch);

  test("a verdict line roundtrips with the patch it reviewed", () => {
    const h: GateHeader = { verdict: { kind: "pass" }, patch: P1, head: HEAD, base: "main", issueRev: issue.bodyRev, design: null };
    expect(renderHeader(h)).toBe(`Gate 结论 · review · PASS · patch ${P1} · HEAD ${HEAD} · base main · issue rev ${issue.bodyRev} · 设计 无`);
    expect(parseHeader(`Gate 结论 · review · PASS · patch ${P1} · HEAD ${HEAD} · base main · issue rev ${issue.bodyRev} · 设计 无\n\n发现后记`)).toEqual(h);
    const failed = `Gate 结论 · review · FAIL@Gate3 · patch ${P2} · HEAD ${H2} · base tree/acme-app-1 · issue rev 2026-01-01T00:00:00Z · 设计 acme/app#3`;
    expect(parseHeader(failed)).toEqual({
      verdict: { kind: "fail", gate: 3 },
      patch: P2,
      head: H2,
      base: "tree/acme-app-1",
      issueRev: "2026-01-01T00:00:00Z",
      design: "acme/app#3",
    });
  });

  test("a line without the patch is not a verdict: it observed nothing identifiable", () => {
    expect(parseHeader(`Gate 结论 · review · PASS · HEAD ${HEAD} · base main · issue rev x · 设计 无`)).toBeNull();
    expect(parseHeader(`Gate 结论 · review · PASS · patch ${P1} · HEAD ${HEAD.slice(0, 7)} · base main · issue rev x · 设计 无`)).toBeNull();
  });

  test("a PASS stays valid after HEAD moves while the patch is the same", () => {
    const e = entries(P1, [comment(1, "2026-11-03T01:00:00Z", passLine(P1, HEAD))], { headRefOid: H2 });
    expect(e[0]?.stale).toEqual([]);
    expect(latestValid(e)?.header.verdict).toEqual({ kind: "pass" });
  });

  test("a PASS is not invalidated by a revised issue body: only the reviewed patch anchors it", () => {
    const revised = renderHeader({ verdict: { kind: "pass" }, patch: P1, head: HEAD, base: "main", issueRev: "2026-11-01T00:00:00Z", design: null });
    const e = entries(P1, [comment(1, "2026-11-03T01:00:00Z", revised)]);
    expect(e[0]?.stale).toEqual([]);
    expect(latestValid(e)?.header.issueRev).toBe("2026-11-01T00:00:00Z");
  });

  test("the verdict line names the live PR inputs and the patch being reviewed", () => {
    const line = headerFor(prData({ baseRefName: "main" }), issue, "PASS", null, P1);
    expect(line).toBe(`Gate 结论 · review · PASS · patch ${P1} · HEAD ${HEAD} · base main · issue rev ${issue.bodyRev} · 设计 无`);
  });

  test("a PASS goes stale against a changed patch, naming both patches", () => {
    const e = entries(P2, [comment(1, "2026-11-03T01:00:00Z", passLine(P1, HEAD))]);
    expect(e[0]?.stale).toEqual([`patch 已从 ${P1.slice(0, 7)} 变为 ${P2.slice(0, 7)}`]);
    expect(latestValid(e)).toBeNull();
  });

  test("a FAIL goes stale when the issue body was revised after it", () => {
    const e = entries(P1, [comment(1, "2026-11-03T01:00:00Z", failLine(P1, "2026-11-01T00:00:00Z"))]);
    expect(e[0]?.stale).toEqual([`issue 正文已修订（2026-11-01T00:00:00Z → ${issue.bodyRev}）`]);
    expect(latestValid(e)).toBeNull();
  });

  test("a verdict goes stale when the PR's base branch changed", () => {
    const e = entries(P1, [comment(1, "2026-11-03T01:00:00Z", passLine(P1, HEAD, "tree/acme-app-1"))], { baseRefName: "main" });
    expect(e[0]?.stale).toEqual(["base 已从 tree/acme-app-1 变为 main"]);
  });

  test("the newest valid verdict decides: a FAIL after a PASS on the same patch blocks", () => {
    const e = entries(P1, [
      comment(1, "2026-11-03T01:00:00Z", passLine(P1, HEAD)),
      comment(2, "2026-11-03T02:00:00Z", failLine(P1, issue.bodyRev)),
    ]);
    expect(latestValid(e)?.header.verdict).toEqual({ kind: "fail", gate: null });
  });
});

describe("merge readiness", () => {
  const text = standard();
  const issue = issueData(text);
  const passLine = (patch: string, head: string) => renderHeader({ verdict: { kind: "pass" }, patch, head, base: "main", issueRev: issue.bodyRev, design: null });
  const failLine = () => renderHeader({ verdict: { kind: "fail", gate: null }, patch: P1, head: HEAD, base: "main", issueRev: issue.bodyRev, design: null });
  const evidence = (complete: boolean): CheckResult => ({
    issue,
    outcomes: [],
    unseenFaces: [],
    complete,
    patch: P1,
    heads: [{ repo, head: HEAD, patchId: P1 }],
    base: "b".repeat(40),
  });
  const readyPr = (over: Partial<PrData> = {}): PrData => prData({ baseRefName: "main", closingIssues: [{ repo, number: 7 }], ...over });
  const problems = async (
    o: { pr?: Partial<PrData>; comments?: readonly Comment[]; patch?: string; evidence?: CheckResult | null; head?: string | null } = {},
  ): Promise<string[]> => {
    const d = await checkPrMergeReady(
      readyPr({ comments: o.comments ?? [comment(1, "2026-11-03T01:00:00Z", passLine(P1, HEAD))], ...o.pr }),
      issue,
      { issue: issue.ref, head: o.head ?? null },
      { patch: o.patch ?? P1, evidence: o.evidence === undefined ? evidence(true) : o.evidence },
    );
    return d.map((x) => x.message);
  };

  test("a PASS whose HEAD moved but whose patch matches is accepted (the patch is the input, not recomputed here)", async () => {
    expect(await problems()).toEqual([]);
    expect(await problems({ pr: { headRefOid: H2 } })).toEqual([]);
    expect(await problems({ pr: { headRefOid: H2 }, head: H2 })).toEqual([]);
  });

  test("an optimistic --head that no longer matches the PR blocks the merge", async () => {
    expect(await problems({ pr: { headRefOid: H2 }, head: HEAD })).toEqual([`HEAD 是 ${H2}，授权的是 ${HEAD}`]);
  });

  test("a draft PR is rejected", async () => {
    expect(await problems({ pr: { isDraft: true } })).toEqual(["PR 不允许是 draft"]);
  });

  test("a non-success check blocks the merge, evidence/ statuses are ignored", async () => {
    const checks = [
      { name: "test", state: "failure" as const },
      { name: "evidence/acme/app#7", state: "failure" as const },
    ];
    expect(await problems({ pr: { checks } })).toEqual(["test：failure"]);
  });

  test("a missing or stale PASS is rejected", async () => {
    expect(await problems({ comments: [] })).toEqual(["没有对当前输入有效的 review 结论"]);
    expect(await problems({ comments: [comment(1, "2026-11-03T01:00:00Z", passLine(P2, HEAD))] })).toEqual(["没有对当前输入有效的 review 结论"]);
    expect(await problems({ comments: [comment(9, "2026-11-03T01:00:00Z", failLine())] })).toEqual(["当前有效的 review 结论不是 PASS：u9"]);
    expect(
      await problems({
        comments: [comment(1, "2026-11-03T01:00:00Z", passLine(P1, HEAD)), comment(2, "2026-11-03T02:00:00Z", failLine())],
      }),
    ).toEqual(["当前有效的 review 结论不是 PASS：u2"]);
  });

  test("a FAIL given after a PASS on the same patch blocks the merge", async () => {
    const comments = [comment(1, "2026-11-03T01:00:00Z", passLine(P1, HEAD)), comment(2, "2026-11-03T02:00:00Z", failLine())];
    expect(await problems({ comments })).toEqual(["当前有效的 review 结论不是 PASS：u2"]);
  });

  test("incomplete evidence, or evidence never computed, blocks the merge", async () => {
    expect(await problems({ evidence: null })).toEqual(["没有计算证据完备性：先 ghc ev check"]);
    const [first] = await problems({ evidence: evidence(false) });
    expect(first).toStartWith("证据不齐全：");
  });

  test("a no-code issue merges on its PR body checks without an evidence package", async () => {
    const noCode = [
      "# t",
      "类型：无代码变更",
      "## 现场",
      "> 旧说法",
      "## 目标",
      "x",
      "## 范围",
      "- docs/a.md",
      "## 预期结果",
      "- 结果 1：改说法",
      "## 范围边界",
      "x",
    ].join("\n");
    const nc = issueData(noCode);
    const body = [
      "Closes acme/app#7",
      "",
      "## 摘要",
      "x",
      "## 做了什么",
      "- 改说法（结果 1）",
      "## 调整思路",
      "- 换掉旧句（结果 1）",
      "## 增加",
      "- 新说明（结果 1）",
      "## 减少",
      "- 旧说法（结果 1）",
    ].join("\n");
    const d = await checkPrMergeReady(
      readyPr({ comments: [comment(1, "2026-11-03T01:00:00Z", passLine(P1, HEAD))], body }),
      nc,
      { issue: nc.ref, head: null },
      { patch: P1, evidence: null },
    );
    expect(d.map((x) => x.message)).toEqual([]);
  });

  test("a no-code PR whose body misses a result tag is rejected", async () => {
    const noCode = ["# t", "类型：无代码变更", "## 现场", "> 旧说法", "## 目标", "x", "## 范围", "- docs/a.md", "## 预期结果", "- 结果 1：改说法", "## 范围边界", "x"].join("\n");
    const nc = issueData(noCode);
    const d = await checkPrMergeReady(
      readyPr({ comments: [comment(1, "2026-11-03T01:00:00Z", passLine(P1, HEAD))], body: "Closes acme/app#7\n\n## 摘要\nx\n## 做了什么\n- x\n## 调整思路\n- x\n## 增加\n- x\n## 减少\n- x" }),
      nc,
      { issue: nc.ref, head: null },
      { patch: P1, evidence: null },
    );
    expect(d.map((x) => x.message)).toContain("结果 1 没有要点标注「（结果 1）」");
  });
});

describe("land check wait", () => {
  const at = { head: HEAD, now: 1_000, startedAt: 0, noChecksAt: 60_000, deadline: 600_000, timeoutSeconds: 600 };
  const snapshot = (head: string, checks: PrData["checks"]) => ({ head, checks });

  test("all checks success merges on, and evidence/ statuses never count", () => {
    expect(
      checkWaitDecision({
        ...at,
        snapshot: snapshot(HEAD, [
          { name: "test", state: "success" },
          { name: "evidence/acme/app#7", state: "failure" },
        ]),
      }),
    ).toEqual({ kind: "success", detail: "1 个检查 success" });
  });

  test("a failed check stops the landing; a cancelled or timed-out run is a failure by the time it is read", () => {
    expect(checkWaitDecision({ ...at, snapshot: snapshot(HEAD, [{ name: "test", state: "success" }, { name: "build", state: "failure" }]) })).toEqual({
      kind: "failure",
      detail: "build=failure",
    });
  });

  test("pending checks keep waiting, then fail at the deadline", () => {
    const pending = snapshot(HEAD, [{ name: "test", state: "pending" }]);
    expect(checkWaitDecision({ ...at, snapshot: pending })).toEqual({ kind: "wait" });
    expect(checkWaitDecision({ ...at, now: 600_000, snapshot: pending })).toEqual({
      kind: "failure",
      detail: `600s 内未全部 success（GitHub HEAD ${HEAD.slice(0, 7)}）`,
    });
  });

  test("a rollup still reporting another HEAD is not read before the deadline", () => {
    const other = snapshot(H2, [{ name: "test", state: "success" }]);
    expect(checkWaitDecision({ ...at, snapshot: other })).toEqual({ kind: "wait" });
    expect(checkWaitDecision({ ...at, now: 600_000, snapshot: other })).toEqual({
      kind: "failure",
      detail: `600s 内未全部 success（GitHub HEAD ${H2.slice(0, 7)}）`,
    });
  });

  test("a repository without checks merges on only after the grace period", () => {
    expect(checkWaitDecision({ ...at, snapshot: snapshot(HEAD, []) })).toEqual({ kind: "wait" });
    expect(checkWaitDecision({ ...at, now: 60_000, snapshot: snapshot(HEAD, []) })).toEqual({
      kind: "success",
      detail: "无检查（GitHub 在 60s 内未登记）",
    });
  });
});

describe("land pipeline", () => {
  const ref: Ref = { repo, number: 77 };
  const fetched = "h-fetched";
  type Calls = { pushed: string[]; merged: string[]; verified: string[]; readbacks: string[]; lines: string[] };

  const harness = (o: { rebase?: RebaseOutcome; checks?: number; mergeOk?: boolean; state?: PrState["state"] } = {}) => {
    const calls: Calls = { pushed: [], merged: [], verified: [], readbacks: [], lines: [] };
    const deps: LandDeps = {
      workspace: async () => ({ path: "/w", close: async () => {} }),
      fetchRefs: async () => {},
      revParse: async () => fetched,
      checkoutDetached: async () => {},
      rebaseOnto: async () => o.rebase ?? { kind: "up-to-date", head: fetched },
      localPatchId: async () => P1,
      pushWithLease: async (_path, _headRef, expected) => {
        calls.pushed.push(expected);
      },
      waitChecks: async () => o.checks ?? 0,
      squashMerge: async (_ref, head) => {
        calls.merged.push(head);
        return { ok: o.mergeOk ?? true, output: "merge failed" };
      },
      prState: async () => ({ state: o.state ?? "MERGED", headRefOid: fetched, baseRefName: "main", defaultBranch: "main" }),
      issueState: async () => "CLOSED",
      now: () => 0,
      sleep: async () => {},
      log: (line) => {
        calls.lines.push(line);
      },
    };
    const pipeline = (over: Partial<Pipeline> = {}): Pipeline => ({
      ref,
      pr: prData({ baseRefName: "main" }),
      base: "main",
      headRef: "work",
      checkout: null,
      pollSeconds: 0,
      timeoutSeconds: 600,
      verify: async (head) => {
        calls.verified.push(head);
        return [];
      },
      readback: async (state) => {
        calls.readbacks.push(state.state);
        return { ok: true, detail: "MERGED" };
      },
      ...over,
    });
    return { calls, deps, pipeline };
  };

  test("an up-to-date branch merges the fetched head and reads back", async () => {
    const { calls, deps, pipeline } = harness();
    expect(await landPipeline(pipeline(), deps)).toBe(0);
    expect(calls.pushed).toEqual([]);
    expect(calls.verified).toEqual([fetched]);
    expect(calls.merged).toEqual([fetched]);
    expect(calls.readbacks).toEqual(["MERGED"]);
  });

  test("a clean rebase that keeps the patch pushes the rewritten head and merges it", async () => {
    const { calls, deps, pipeline } = harness({ rebase: { kind: "rebased", oldHead: "h-old", newHead: "h-new", oldPatch: P1, newPatch: P1 } });
    expect(await landPipeline(pipeline(), deps)).toBe(0);
    expect(calls.pushed).toEqual(["h-old"]);
    expect(calls.merged).toEqual(["h-new"]);
  });

  test("a clean rebase that changed the patch pushes, then stops for a new review without merging", async () => {
    const { calls, deps, pipeline } = harness({ rebase: { kind: "rebased", oldHead: "h-old", newHead: "h-new", oldPatch: P1, newPatch: P2 } });
    expect(await landPipeline(pipeline(), deps)).toBe(1);
    expect(calls.pushed).toEqual(["h-old"]);
    expect(calls.merged).toEqual([]);
    expect(calls.lines.join("")).toContain(`patch 已从 ${P1.slice(0, 7)} 变为 ${P2.slice(0, 7)}，需要复核`);
  });

  test("a conflicting rebase stops before any push or merge and lists the files", async () => {
    const { calls, deps, pipeline } = harness({ rebase: { kind: "conflict", files: ["a.txt"] } });
    expect(await landPipeline(pipeline(), deps)).toBe(1);
    expect(calls.pushed).toEqual([]);
    expect(calls.merged).toEqual([]);
    expect(calls.lines.join("")).toContain("冲突\ta.txt");
  });

  test("a failed check stops before merge readiness is even checked", async () => {
    const { calls, deps, pipeline } = harness({ checks: 1 });
    expect(await landPipeline(pipeline(), deps)).toBe(1);
    expect(calls.verified).toEqual([]);
    expect(calls.merged).toEqual([]);
  });

  test("merge-ready problems stop the landing without merging", async () => {
    const { calls, deps, pipeline } = harness();
    const code = await landPipeline(
      pipeline({
        verify: async (head) => {
          calls.verified.push(head);
          return [err("review", "没有对当前输入有效的 review 结论")];
        },
      }),
      deps,
    );
    expect(code).toBe(1);
    expect(calls.verified).toEqual([fetched]);
    expect(calls.merged).toEqual([]);
    expect(calls.lines.join("")).toContain("ERROR review");
  });

  test("a refused merge stops without a readback", async () => {
    const { calls, deps, pipeline } = harness({ mergeOk: false });
    expect(await landPipeline(pipeline(), deps)).toBe(1);
    expect(calls.merged).toEqual([fetched]);
    expect(calls.readbacks).toEqual([]);
    expect(calls.lines.join("")).toContain("merge failed");
  });

  test("a PR that GitHub did not report MERGED stops without a readback", async () => {
    const { calls, deps, pipeline } = harness({ state: "CLOSED" });
    expect(await landPipeline(pipeline(), deps)).toBe(1);
    expect(calls.readbacks).toEqual([]);
    expect(calls.lines.join("")).toContain("PR 状态是 CLOSED");
  });

  test("a readback that fails turns the landing into a failure", async () => {
    const { calls, deps, pipeline } = harness();
    const code = await landPipeline(
      pipeline({
        readback: async (state) => {
          calls.readbacks.push(state.state);
          return { ok: false, detail: "PR 已 MERGED，但 acme/app#7 是 OPEN" };
        },
      }),
      deps,
    );
    expect(code).toBe(1);
    expect(calls.merged).toEqual([fetched]);
    expect(calls.readbacks).toEqual(["MERGED"]);
  });
});

describe("land readback", () => {
  const issue: Ref = { repo, number: 7 };
  const root: Ref = { repo, number: 11 };
  const sub: Ref = { repo, number: 12 };
  const keyOf = (r: Ref): string => `${r.repo.owner}/${r.repo.name}#${r.number}`;

  const readbackDeps = (script: Record<string, readonly ("OPEN" | "CLOSED")[]>) => {
    const calls = { reads: [] as string[], sleeps: [] as number[], lines: [] as string[] };
    const queues = new Map(Object.entries(script).map(([key, states]) => [key, [...states]]));
    let now = 0;
    const deps: ReadbackDeps = {
      issueState: async (r) => {
        const key = keyOf(r);
        calls.reads.push(key);
        const states = queues.get(key) ?? [];
        const state = states.length > 1 ? states.shift() : states[0];
        if (state === undefined) throw new Error(`no scripted state for ${key}`);
        return state;
      },
      now: () => now,
      sleep: async (ms) => {
        calls.sleeps.push(ms);
        now += ms;
      },
      log: (line) => {
        calls.lines.push(line);
      },
    };
    return { calls, deps };
  };

  test("a tree readback that already reads CLOSED returns at once", async () => {
    const { calls, deps } = readbackDeps({ [keyOf(root)]: ["CLOSED"], [keyOf(sub)]: ["CLOSED"] });
    expect(await readbackTree([root, sub], 20, 60, deps)).toEqual({ ok: true, detail: "2 个树 issue 全部 CLOSED" });
    expect(calls.sleeps).toEqual([]);
    expect(calls.lines).toEqual([]);
  });

  test("a tree readback waits for the root issue to propagate CLOSED", async () => {
    const { calls, deps } = readbackDeps({ [keyOf(root)]: ["OPEN", "CLOSED"], [keyOf(sub)]: ["CLOSED"] });
    expect(await readbackTree([root, sub], 20, 60, deps)).toEqual({ ok: true, detail: "2 个树 issue 全部 CLOSED" });
    expect(calls.sleeps).toEqual([20_000]);
    expect(calls.lines).toEqual(["readback\t等待 acme/app#11 CLOSED（最多 60s）\n"]);
  });

  test("a tree readback fails with the existing message only after the bound", async () => {
    const { calls, deps } = readbackDeps({ [keyOf(root)]: ["OPEN"], [keyOf(sub)]: ["CLOSED"] });
    expect(await readbackTree([root, sub], 20, 60, deps)).toEqual({ ok: false, detail: "仍未 CLOSED：acme/app#11" });
    expect(calls.sleeps).toEqual([20_000, 20_000, 20_000]);
    expect(calls.lines).toHaveLength(1);
  });

  test("a standalone readback waits for the issue to propagate CLOSED", async () => {
    const { calls, deps } = readbackDeps({ [keyOf(issue)]: ["OPEN", "CLOSED"] });
    expect(await readbackIssue(issue, 20, 60, deps)).toEqual({ ok: true, detail: "MERGED; acme/app#7 CLOSED" });
    expect(calls.sleeps).toEqual([20_000]);
    expect(calls.lines).toEqual(["readback\t等待 acme/app#7 CLOSED（OPEN，最多 60s）\n"]);
  });

  test("a standalone readback fails with the existing message only after the bound", async () => {
    const { calls, deps } = readbackDeps({ [keyOf(issue)]: ["OPEN"] });
    expect(await readbackIssue(issue, 20, 60, deps)).toEqual({ ok: false, detail: "PR 已 MERGED，但 acme/app#7 是 OPEN" });
    expect(calls.sleeps).toEqual([20_000, 20_000, 20_000]);
    expect(calls.lines).toHaveLength(1);
  });
});

describe("tree landing order", () => {
  test("tree PRs land every other repo first and the root repo last", () => {
    const app = { owner: "acme", name: "app" };
    const lib = { owner: "acme", name: "lib" };
    const infra = { owner: "acme", name: "infra" };
    expect(
      landOrder([{ repo: app }, { repo: infra }, { repo: lib }], app).map((s) => s.repo.name),
    ).toEqual(["infra", "lib", "app"]);
    expect(landOrder([{ repo: app }], app).map((s) => s.repo.name)).toEqual(["app"]);
  });
});

describe("ghc cli", () => {
  const run = (...args: string[]) => {
    const r = Bun.spawnSync([process.execPath, join(import.meta.dir, "main.ts"), ...args], { cwd: import.meta.dir });
    return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
  };

  test("ghc gate diff is gone: it exits 2 as a usage error", () => {
    const r = run("gate", "diff", "acme/app#77");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("未知的 gate 子命令 diff");
  });

  test("ghc help lists no gate diff", () => {
    const r = run("help");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("ghc gate header <PR>");
    expect(r.stdout).not.toContain("gate diff");
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
