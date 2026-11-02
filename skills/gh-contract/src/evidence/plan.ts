// `ghc ev plan`: the evidence an issue owes, as the commands that would capture it.

import { getIssue } from "../github.ts";
import { parseIssue } from "../issue.ts";
import type { Form } from "../model.ts";
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
  const form: Form = body.kind === "standard" ? body.form : "e2e";
  process.stdout.write(`${refKey(ref)}（${body.kind === "integration" ? "总体验收" : `测试形态 ${form}`}）\n`);
  for (const row of body.rows) {
    const req = requirementFor(row.face, form);
    const covers = row.covers.length === 0 ? "卫生" : row.covers.map((c) => `结果 ${c}`).join("、");
    process.stdout.write(`\n#${row.id} ${row.face} · ${covers} · ${row.role} · Command: ${row.command}\n`);
    const steps = body.kind === "integration" ? req.steps.filter((s) => s.anchor === "head") : req.steps;
    for (const s of steps) {
      const where = s.anchor === "base" ? "在 base 提交的干净检出上" : body.kind === "integration" ? "在包含全部 child 合并提交的检出上" : "在当前 HEAD 的干净检出上";
      const capture = s.needsImage ? `--artifacts <截图目录> -- <产生截图的命令>（或 ghc ev attach ${refKey(ref)} --row ${row.id} --step ${s.step} <图片>）` : "-- <命令>";
      process.stdout.write(`  ${s.step}${req.ordered ? "（按顺序）" : ""}：${where}\n    ghc ev run ${refKey(ref)} --row ${row.id} --step ${s.step} ${capture}\n`);
    }
  }
}
