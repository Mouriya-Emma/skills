// ghc: programmatic GitHub issue/PR contracts. Exit 0 ok, 1 a check failed, 2 usage or environment error.
// `ghc ev run` exits with the observed command's status instead.

import { evAttach, evRun } from "./evidence/capture.ts";
import { evPlan } from "./evidence/plan.ts";
import { evCheck, evPublish } from "./evidence/publish.ts";
import { fetchAll } from "./fetch.ts";
import { gateEntries, headerFor } from "./gate.ts";
import { getIssue, getPr } from "./github.ts";
import { lint, printDiagnostics } from "./lint.ts";
import { prMergeReady, treeMergeReady } from "./merge.ts";
import { checkIdentity } from "./pr.ts";
import { EnvError, UsageError } from "./proc.ts";
import { parseRefArg } from "./ref.ts";

const HELP = `ghc — GitHub issue/PR 内容契约

  ghc fetch <ref> [--out DIR]                 完整抓取 issue/PR 到本地（默认 /tmp/ghc/<owner>-<repo>-<N>）
  ghc lint <ref> [--tree]                     检查 issue / PR / 整棵 issue 树
  ghc ev plan <issue>                         列出该 issue 要采集的证据
  ghc ev run <issue> --row N[,M] [--step S] [--artifacts DIR] [--checkout PATH]... [--timeout SEC] -- <command>
  ghc ev attach <issue> --row N[,M] [--step S] [--checkout PATH]... <image|dir>...
  ghc ev check <issue|PR>                     证据是否齐全（issue：对当前检出 HEAD；PR：对 PR HEAD）
  ghc ev publish <PR|总体验收 issue>          发布证据包 comment，并写 evidence/<issue> 状态
  ghc gate header <PR> --result PASS|FAIL@GateN [--design REF]
  ghc gate list <PR>                          列出 review 结论及其是否仍有效
  ghc merge-ready <PR> --issue <ref> --head <sha>
  ghc merge-ready <树根> --tree

<ref> 写 owner/repo#N 或 github.com 链接。`;

type Flags = { positional: string[]; values: Map<string, string[]>; bools: Set<string>; rest: string[] };

function parseFlags(args: readonly string[], valued: readonly string[], booleans: readonly string[]): Flags {
  const f: Flags = { positional: [], values: new Map(), bools: new Set(), rest: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "--") {
      f.rest = args.slice(i + 1);
      break;
    }
    if (valued.includes(a)) {
      const v = args[i + 1];
      if (v === undefined) throw new UsageError(`${a} 缺少值`);
      f.values.set(a, [...(f.values.get(a) ?? []), v]);
      i++;
    } else if (booleans.includes(a)) f.bools.add(a);
    else if (a.startsWith("--")) throw new UsageError(`未知参数 ${a}`);
    else f.positional.push(a);
  }
  return f;
}

const one = (f: Flags, k: string): string | null => f.values.get(k)?.at(-1) ?? null;

function rowsOf(f: Flags): number[] {
  const v = one(f, "--row");
  if (v === null) throw new UsageError("缺少 --row");
  return v.split(",").map((x) => {
    const n = Number(x.trim());
    if (!Number.isInteger(n) || n <= 0) throw new UsageError(`--row ${v}：行号必须是正整数`);
    return n;
  });
}

async function main(argv: readonly string[]): Promise<number> {
  const [cmd, sub, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(`${HELP}\n`);
      return 0;
    case "fetch": {
      const f = parseFlags([sub ?? "", ...rest].filter((x) => x !== ""), ["--out"], []);
      process.stdout.write(`${await fetchAll(parseRefArg(f.positional[0], "ref"), one(f, "--out"))}\n`);
      return 0;
    }
    case "lint": {
      const f = parseFlags([sub ?? "", ...rest].filter((x) => x !== ""), [], ["--tree"]);
      return lint(parseRefArg(f.positional[0], "ref"), f.bools.has("--tree"));
    }
    case "ev": {
      switch (sub) {
        case "plan": {
          await evPlan(parseRefArg(rest[0], "issue"));
          return 0;
        }
        case "run": {
          const f = parseFlags(rest, ["--row", "--step", "--artifacts", "--checkout", "--timeout"], []);
          const t = one(f, "--timeout");
          const timeout = t === null ? null : Number(t);
          if (timeout !== null && (!Number.isFinite(timeout) || timeout <= 0)) throw new UsageError("--timeout 必须是正数秒");
          return evRun({
            issue: parseRefArg(f.positional[0], "issue"),
            rows: rowsOf(f),
            step: one(f, "--step"),
            checkouts: f.values.get("--checkout") ?? [],
            artifacts: one(f, "--artifacts"),
            timeoutSeconds: timeout,
            argv: f.rest,
          });
        }
        case "attach": {
          const f = parseFlags(rest, ["--row", "--step", "--checkout"], []);
          await evAttach({
            issue: parseRefArg(f.positional[0], "issue"),
            rows: rowsOf(f),
            step: one(f, "--step"),
            checkouts: f.values.get("--checkout") ?? [],
            files: f.positional.slice(1),
          });
          return 0;
        }
        case "check":
          return evCheck(parseRefArg(rest[0], "issue 或 PR"));
        case "publish":
          return evPublish(parseRefArg(rest[0], "PR 或总体验收 issue"));
        default:
          throw new UsageError(`未知的 ev 子命令 ${sub ?? ""}`);
      }
    }
    case "gate": {
      const f = parseFlags(rest, ["--result", "--design"], []);
      const pr = await getPr(parseRefArg(f.positional[0], "PR"));
      const target = checkIdentity(pr, null).target;
      if (target === null) throw new UsageError("PR 正文第一行没有 Closes，无法确定 issue");
      if (target.kind === "tree") throw new UsageError("tree PR 没有 review 结论：合并前提用 ghc merge-ready <树根> --tree");
      const issue = await getIssue(target.issue);
      switch (sub) {
        case "header": {
          const result = one(f, "--result");
          if (result === null) throw new UsageError("gate header 需要 --result");
          process.stdout.write(`${headerFor(pr, issue, result, one(f, "--design"))}\n`);
          return 0;
        }
        case "list": {
          for (const e of gateEntries(pr, issue)) {
            const state = e.stale.length === 0 ? "有效" : `失效（${e.stale.join("；")}）`;
            process.stdout.write(`review\t${e.header.verdict.kind}\t${state}\t${e.comment.url}\n`);
          }
          return 0;
        }
        default:
          throw new UsageError(`未知的 gate 子命令 ${sub ?? ""}`);
      }
    }
    case "merge-ready": {
      const f = parseFlags([sub ?? "", ...rest].filter((x) => x !== ""), ["--issue", "--head"], ["--tree"]);
      const ref = parseRefArg(f.positional[0], "PR 或树根");
      if (f.bools.has("--tree")) return printDiagnostics(await treeMergeReady(ref));
      const head = one(f, "--head");
      if (head === null) throw new UsageError("merge-ready 需要 --head <授权的 sha>");
      return printDiagnostics(await prMergeReady(ref, { issue: parseRefArg(one(f, "--issue") ?? undefined, "--issue"), head }));
    }
    default:
      throw new UsageError(`未知命令 ${cmd}；ghc help 查看用法`);
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  if (e instanceof UsageError || e instanceof EnvError) {
    process.stderr.write(`ghc: ${e.message}\n`);
    process.exitCode = 2;
  } else throw e;
}
