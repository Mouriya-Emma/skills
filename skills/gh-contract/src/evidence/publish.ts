// `ghc ev check` and `ghc ev publish`: compute completeness for a target, render, post, set the commit status.

import { getIssue, getPr, type IssueData, objectKind, type PrData, postComment, setStatus } from "../github.ts";
import { checkoutAt } from "../git.ts";
import { type IssueBody, parseIssue } from "../issue.ts";
import { type Diagnostic, err } from "../model.ts";
import { checkBody, checkIdentity, checkNoCode, type NoCodeReport } from "../pr.ts";
import { UsageError } from "../proc.ts";
import { type Ref, type Repo, refKey } from "../ref.ts";
import { type CheckResult, type ChildMerge, checkEvidence, describe, type Mode } from "./check.ts";
import { type EvidenceRecord, loadRecords, tail } from "./record.ts";
import { type RecordDetail, renderPack, toPack } from "./render.ts";
import { scanSecrets } from "./secrets.ts";

export const STATUS_CONTEXT = "evidence/complete";
const TAIL_LINES = 40;
/** Characters of log tails one pack may carry: GitHub rejects comments over 65536 characters, and the table, commands
 * and images take the rest. Each stream of each record gets an equal share. */
const PACK_LOG_CHARS = 40000;

type Runnable = Extract<IssueBody, { kind: "standard" | "integration" }>;

export type Target =
  | { readonly kind: "pr"; readonly pr: PrData; readonly issue: IssueData; readonly body: IssueBody }
  | { readonly kind: "issue"; readonly issue: IssueData; readonly body: IssueBody };

function parsedBody(issue: IssueData): IssueBody {
  const p = parseIssue(issue.body, { repo: issue.ref.repo, hasParent: issue.parent !== null });
  if (p.value === null) throw new UsageError(`${refKey(issue.ref)} 的正文不合契约，先跑 ghc lint ${refKey(issue.ref)}`);
  return p.value;
}

export async function resolve(ref: Ref): Promise<Target> {
  if ((await objectKind(ref)) === "PullRequest") {
    const pr = await getPr(ref);
    const id = checkIdentity(pr, null);
    if (id.issue === null) throw new UsageError(`${refKey(ref)} 正文第一行没有 Closes：先修正 PR 身份`);
    const issue = await getIssue(id.issue);
    return { kind: "pr", pr, issue, body: parsedBody(issue) };
  }
  const issue = await getIssue(ref);
  return { kind: "issue", issue, body: parsedBody(issue) };
}

/** Merge commits of an integration issue's composed children; open or unmerged children are problems. */
export async function integrationMerges(body: Extract<IssueBody, { kind: "integration" }>): Promise<{ merges: ChildMerge[]; problems: Diagnostic[] }> {
  const merges: ChildMerge[] = [];
  const problems: Diagnostic[] = [];
  for (const c of body.composed) {
    const child = await getIssue(c);
    const cb = child.closedBy;
    if (child.state !== "CLOSED" || cb === null || !cb.merged || cb.mergeCommit === null || cb.mergedAt === null) {
      problems.push(err(refKey(c), "组合对象尚未经合并的 PR 关闭：总体验收要在全部 child 合并后进行"));
      continue;
    }
    merges.push({ child: refKey(c), repo: cb.pr.repo, commit: cb.mergeCommit, mergedAt: cb.mergedAt });
  }
  return { merges, problems };
}

async function modeFor(t: Target, body: Runnable): Promise<{ mode: Mode; problems: Diagnostic[] }> {
  if (t.kind === "pr") {
    if (body.kind === "integration") throw new UsageError("总体验收 issue 不经 PR 关闭");
    return { mode: { kind: "pr", pr: t.pr }, problems: [] };
  }
  if (body.kind === "integration") {
    const { merges, problems } = await integrationMerges(body);
    return { mode: { kind: "integration", merges }, problems };
  }
  return { mode: { kind: "local", checkout: await checkoutAt(process.cwd()) }, problems: [] };
}

export async function runCheck(t: Target): Promise<{ check: CheckResult; problems: Diagnostic[] }> {
  const body = t.body;
  if (body.kind === "no-code") throw new UsageError(`${refKey(t.issue.ref)} 是无代码变更 issue：用 ghc lint <PR> 检查`);
  const { mode, problems } = await modeFor(t, body);
  const records = (await loadRecords(t.issue.ref)).map((x) => x.record);
  return { check: await checkEvidence(t.issue, body, records, mode), problems };
}

export async function evCheck(ref: Ref): Promise<number> {
  const t = await resolve(ref);
  const { check, problems } = await runCheck(t);
  process.stdout.write(`${describe(check)}\n`);
  for (const p of problems) process.stdout.write(`${p.severity} ${p.where}: ${p.message}\n`);
  return check.complete && problems.length === 0 ? 0 : 1;
}

async function details(t: Target, check: CheckResult): Promise<RecordDetail[]> {
  const dirs = new Map((await loadRecords(t.issue.ref)).map((x) => [x.record.id, x.dir]));
  const linked = new Map<string, { record: EvidenceRecord; dir: string }>();
  for (const r of check.rows) {
    for (const s of r.steps) {
      if (s.status.kind !== "linked") continue;
      const dir = dirs.get(s.status.record.id);
      if (dir !== undefined) linked.set(s.status.record.id, { record: s.status.record, dir });
    }
  }
  const share = Math.floor(PACK_LOG_CHARS / Math.max(1, 2 * linked.size));
  const out: RecordDetail[] = [];
  for (const { record, dir } of linked.values()) {
    out.push({ record, stdout: await tail(dir, "stdout", TAIL_LINES, share), stderr: await tail(dir, "stderr", TAIL_LINES, share) });
  }
  return out.sort((a, b) => (a.record.startedAt < b.record.startedAt ? -1 : 1));
}

function renderNoCode(issue: IssueData, pr: PrData, report: NoCodeReport, d: readonly Diagnostic[], generatedAt: string): string {
  const ok = d.every((x) => x.severity !== "error");
  const badLinks = report.links.filter((l) => !l.ok);
  const resultDiags = d.filter((x) => x.where === "pr-body" && x.message.startsWith("结果 "));
  const lines = [
    "## 无代码变更检查",
    "",
    `> 由 \`ghc\` 生成 · issue ${refKey(issue.ref)} · HEAD \`${pr.headRefOid}\` · ${ok ? "通过" : "未通过"} · 生成于 ${generatedAt}`,
    "",
    "| 检查 | 结果 |",
    "|---|---|",
    `| diff 文件 | ${report.outside.length === 0 ? `${pr.files.length} 个文件，全部在 issue 范围内` : `超出范围：${report.outside.join("、")}`} |`,
    `| 范围内未改动 | ${report.untouched.length === 0 ? "无" : report.untouched.join("、")} |`,
    `| 链接与锚点 | ${badLinks.length === 0 ? `${report.links.length} 个，全部可解析` : `${badLinks.length}/${report.links.length} 个无法解析`} |`,
    `| 预期结果对应 | ${resultDiags.length === 0 ? "每条结果都有要点" : resultDiags.map((x) => x.message).join("；")} |`,
  ];
  const errors = d.filter((x) => x.severity === "error");
  if (errors.length > 0) lines.push("", ...errors.map((e) => `- ${e.where}：${e.message}`));
  return `${lines.join("\n")}\n`;
}

export async function evPublish(ref: Ref): Promise<number> {
  const t = await resolve(ref);
  const generatedAt = new Date().toISOString();
  if (t.body.kind === "no-code") {
    if (t.kind !== "pr") throw new UsageError("无代码变更 issue 的检查发在它的 PR 上：ghc ev publish <PR>");
    const identity = checkIdentity(t.pr, t.issue.ref);
    const nc = await checkNoCode(t.pr, t.body);
    const d = [...identity.diagnostics, ...checkBody(t.pr, t.body), ...nc.diagnostics];
    const ok = d.every((x) => x.severity !== "error");
    const url = await postComment(t.pr.ref, renderNoCode(t.issue, t.pr, nc.report, d, generatedAt));
    await setStatus(t.pr.ref.repo, t.pr.headRefOid, {
      state: ok ? "success" : "failure",
      context: STATUS_CONTEXT,
      description: ok ? `无代码变更检查通过 @${t.pr.headRefOid.slice(0, 7)}` : `无代码变更检查未通过：${d.filter((x) => x.severity === "error").length} 项`,
      targetUrl: url,
    });
    process.stdout.write(`${url}\n`);
    return ok ? 0 : 1;
  }
  const { check, problems } = await runCheck(t);
  const det = await details(t, check);
  const hits = det.flatMap((x) => [
    ...(x.record.capture.kind === "run" ? scanSecrets(`${x.record.id} command`, x.record.capture.command) : []),
    ...scanSecrets(`${x.record.id} stdout`, x.stdout.text),
    ...scanSecrets(`${x.record.id} stderr`, x.stderr.text),
  ]);
  if (hits.length > 0) {
    for (const h of hits) process.stderr.write(`ghc: 疑似凭据（${h.kind}）在 ${h.where} 末尾片段第 ${h.line} 行\n`);
    process.stderr.write("ghc: 拒绝发布。改用不打印凭据的命令重新采集（ghc ev run），再发布。\n");
    return 1;
  }
  const pack = toPack(check, generatedAt);
  const target = t.kind === "pr" ? t.pr.ref : t.issue.ref;
  const url = await postComment(target, renderPack(pack, det, check));
  const complete = check.complete && problems.length === 0;
  const missing = check.rows.filter((r) => r.overall !== "linked").map((r) => `#${r.row.id}`);
  const statusTargets: { repo: Repo; sha: string }[] =
    t.kind === "pr" ? [{ repo: t.pr.ref.repo, sha: t.pr.headRefOid }] : pack.heads.map((h) => ({ repo: h.repo, sha: h.head }));
  for (const s of statusTargets) {
    await setStatus(s.repo, s.sha, {
      state: complete ? "success" : "failure",
      context: STATUS_CONTEXT,
      description: complete ? `${pack.linked}/${pack.total} 行齐全 @${s.sha.slice(0, 7)}` : `缺 ${missing.join(" ")}${problems.length > 0 ? "；组合对象未全部合并" : ""}`,
      targetUrl: url,
    });
  }
  process.stdout.write(`${url}\n`);
  for (const p of problems) process.stderr.write(`ghc: ${p.where}: ${p.message}\n`);
  return complete ? 0 : 1;
}
