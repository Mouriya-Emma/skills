// `ghc ev plan`: the evidence an issue owes: per expected result the template its kind asks for, and per declared face
// the capture steps that record it.

import { getIssue } from "../github.ts";
import { parseIssue } from "../issue.ts";
import { templateOf } from "../model.ts";
import { UsageError } from "../proc.ts";
import { type Ref, refKey } from "../ref.ts";
import { requirementFor } from "../requirements.ts";

export async function evPlan(ref: Ref): Promise<void> {
  const issue = await getIssue(ref);
  const parsed = parseIssue(issue.body, { repo: ref.repo, hasParent: issue.parent !== null });
  const body = parsed.value;
  if (body === null) throw new UsageError(`${refKey(ref)} 的正文不合契约，先跑 ghc lint ${refKey(ref)}`);
  if (body.kind === "no-code") {
    process.stdout.write(`${refKey(ref)} 是无代码变更 issue：不采集运行证据；PR 开出后跑 ghc lint <PR> 与 ghc ev publish <PR>\n`);
    return;
  }
  const integration = body.kind === "integration";
  process.stdout.write(`${refKey(ref)}（${integration ? "总体验收" : `测试形态 ${body.form}`}；面 ${body.scope.faces.join("、")}）\n`);
  const faceFlag = body.scope.faces.length > 1;
  for (const o of body.outcomes) {
    process.stdout.write(`\n结果 ${o.id} [${o.kind}] · ${templateOf(o.kind)}\n  ${o.text}\n`);
    for (const face of body.scope.faces) {
      const req = requirementFor(face, o.kind);
      const steps = integration ? req.steps.filter((s) => s.anchor === "head") : req.steps;
      process.stdout.write(`  经 ${face} 观察${req.ordered ? "（步骤按顺序）" : ""}：\n`);
      for (const s of steps) {
        const where = s.anchor === "base" ? "在 base 提交的干净检出上" : integration ? "在包含全部 child 合并提交的检出上" : "在当前 HEAD 的干净检出上";
        const flags = `--result ${o.id}${faceFlag ? ` --face ${face}` : ""}${steps.length > 1 ? ` --step ${s.step}` : ""} --shows "<reviewer 能看出什么>"`;
        const capture = s.needsImage
          ? `ghc ev attach ${refKey(ref)} ${flags} <真实会话里截的图>`
          : `ghc ev run ${refKey(ref)} ${flags} -- <经真实入口的观察>`;
        process.stdout.write(`    ${s.step}：${where}\n      ${capture}\n`);
      }
    }
  }
  process.stdout.write("\n结果上的类型是 issue 的参考：实际情况不同时采集用 --kind 改|新|删|保持 指定，证据包会标出差异。\n");
}
