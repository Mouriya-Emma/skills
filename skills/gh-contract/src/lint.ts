// `ghc lint`: the contract checks for one issue, one PR, or a whole issue tree.

import { getIssue, getPr, type IssueData, objectKind } from "./github.ts";
import { type IssueBody, parseIssue, umbrellaIntegrationRef } from "./issue.ts";
import { type Diagnostic, err } from "./model.ts";
import { checkBody, checkIdentity, checkNoCode, checkPlacement, checkTreePr } from "./pr.ts";
import { type Ref, refKey, sameRef } from "./ref.ts";

export function printDiagnostics(d: readonly Diagnostic[]): number {
  for (const x of d) process.stdout.write(`${x.severity === "error" ? "ERROR" : "WARN "} ${x.where}  ${x.message}\n`);
  const errors = d.filter((x) => x.severity === "error").length;
  process.stdout.write(errors === 0 ? `ok（${d.length} 条警告）\n` : `${errors} 个错误，${d.length - errors} 条警告\n`);
  return errors === 0 ? 0 : 1;
}

const prefixed = (prefix: string, d: readonly Diagnostic[]): Diagnostic[] => d.map((x) => ({ ...x, where: `${prefix} ${x.where}` }));

export function lintIssue(issue: IssueData): Diagnostic[] {
  if (issue.subIssues.length > 0) return [...umbrellaIntegrationRef(issue.body, issue.ref.repo).diagnostics];
  return [...parseIssue(issue.body, { repo: issue.ref.repo, hasParent: issue.parent !== null }).diagnostics];
}

export async function lintPr(ref: Ref): Promise<Diagnostic[]> {
  const pr = await getPr(ref);
  const id = checkIdentity(pr, null);
  if (id.target === null) return id.diagnostics;
  if (id.target.kind === "tree") return [...id.diagnostics, ...checkTreePr(pr, await getIssue(id.target.root))];
  const issue = await getIssue(id.target.issue);
  const parsed = parseIssue(issue.body, { repo: issue.ref.repo, hasParent: issue.parent !== null });
  const d = [...id.diagnostics, ...checkPlacement(pr, issue)];
  if (parsed.value === null) {
    d.push(err(refKey(issue.ref), "关闭的 issue 正文不合契约，先修 issue（ghc lint 该 issue）"));
    return d;
  }
  d.push(...checkBody(pr, parsed.value));
  if (parsed.value.kind === "no-code") d.push(...(await checkNoCode(pr, parsed.value, issue.parent !== null)).diagnostics);
  return d;
}

type Child = { data: IssueData; body: IssueBody | null; diagnostics: readonly Diagnostic[] };

export async function lintTree(umbrella: Ref): Promise<Diagnostic[]> {
  const root = await getIssue(umbrella);
  const d: Diagnostic[] = [];
  if (root.subIssues.length === 0) return [err(refKey(umbrella), "没有 sub-issue：--tree 只用于 umbrella")];
  const pointer = umbrellaIntegrationRef(root.body, root.ref.repo);
  d.push(...prefixed(refKey(umbrella), pointer.diagnostics));
  const children: Child[] = [];
  for (const s of root.subIssues) {
    const data = await getIssue(s.ref);
    const p = parseIssue(data.body, { repo: data.ref.repo, hasParent: true });
    children.push({ data, body: p.value, diagnostics: p.diagnostics });
    d.push(...prefixed(refKey(s.ref), p.diagnostics));
  }
  const integrations = children.filter((c) => c.body?.kind === "integration");
  if (integrations.length !== 1) {
    d.push(err(refKey(umbrella), `树里必须恰好有一个总体验收 issue（类型：总体验收），现有 ${integrations.length} 个`));
    return d;
  }
  const integ = integrations[0];
  const ib = integ?.body;
  if (integ === undefined || ib === null || ib === undefined || ib.kind !== "integration") return d;
  if (pointer.value !== null && !sameRef(pointer.value, integ.data.ref)) {
    d.push(err(refKey(umbrella), `「## 总体验收」指向 ${refKey(pointer.value)}，但树里的总体验收是 ${refKey(integ.data.ref)}`));
  }
  const others = children.filter((c) => c !== integ);
  for (const c of others) {
    if (!ib.deps.dependsOn.some((r) => sameRef(r, c.data.ref))) d.push(err(refKey(integ.data.ref), `Depends on 缺少 ${refKey(c.data.ref)}：总体验收要排在所有 child 之后`));
  }
  const runnable = others.filter((c) => c.body !== null && c.body.kind !== "no-code");
  for (const c of runnable) {
    if (!ib.composed.some((r) => sameRef(r, c.data.ref))) d.push(err(refKey(integ.data.ref), `组合对象缺少 ${refKey(c.data.ref)}`));
  }
  for (const r of ib.composed) {
    if (!runnable.some((c) => sameRef(c.data.ref, r))) d.push(err(refKey(integ.data.ref), `组合对象 ${refKey(r)} 不是本树的实现 child`));
  }
  for (const c of runnable) {
    if (c.body?.kind === "standard" && c.body.form !== "e2e" && !ib.rows.some((row) => row.via.some((v) => sameRef(v, c.data.ref)))) {
      d.push(err(refKey(integ.data.ref), `${refKey(c.data.ref)} 的测试形态是 ${c.body.form}，必须出现在总体验收某一行的「经由」里`));
    }
  }
  return d;
}

export async function lint(ref: Ref, tree: boolean): Promise<number> {
  if (tree) return printDiagnostics(await lintTree(ref));
  if ((await objectKind(ref)) === "PullRequest") return printDiagnostics(await lintPr(ref));
  return printDiagnostics(lintIssue(await getIssue(ref)));
}
