// `ghc ev run` and `ghc ev attach`: observe one command (or files) and store the record.

import { createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { getIssue, type IssueData } from "../github.ts";
import { type Checkout, checkoutAt, headOf, isClean } from "../git.ts";
import { type IssueBody, parseIssue, type Row } from "../issue.ts";
import { type Form, IMAGE_TYPES } from "../model.ts";
import { UsageError } from "../proc.ts";
import { type Ref, type Repo, refKey, repoKey } from "../ref.ts";
import { defaultStep, isStep, requirementFor, type Step } from "../requirements.ts";
import { uploadAttachment } from "../upload.ts";
import { type Attachment, type CheckoutState, type Completion, type EvidenceRecord, newRecordDir, saveRecord } from "./record.ts";

export type CaptureOptions = {
  readonly issue: Ref;
  readonly rows: readonly number[];
  readonly step: string | null;
  readonly checkouts: readonly string[];
};

type Target = { issueData: IssueData; body: IssueBody & { kind: "standard" | "integration" }; rows: Row[]; step: Step; form: Form };

async function resolveTarget(o: CaptureOptions): Promise<Target> {
  const issueData = await getIssue(o.issue);
  const parsed = parseIssue(issueData.body, { repo: o.issue.repo, hasParent: issueData.parent !== null });
  const body = parsed.value;
  if (body === null) throw new UsageError(`${refKey(o.issue)} 的正文不合契约，先跑 ghc lint ${refKey(o.issue)}`);
  if (body.kind === "no-code") throw new UsageError(`${refKey(o.issue)} 是无代码变更 issue，不采集运行证据`);
  const form: Form = body.kind === "standard" ? body.form : "e2e";
  if (o.rows.length === 0) throw new UsageError("--row 至少给一个验收行号");
  const rows = o.rows.map((n) => {
    const r = body.rows.find((x) => x.id === n);
    if (r === undefined) throw new UsageError(`${refKey(o.issue)} 没有验收行 #${n}`);
    return r;
  });
  let step: Step;
  if (o.step === null) {
    const defaults = [...new Set(rows.map((r) => defaultStep(r.face, form)))];
    const only = defaults[0];
    if (defaults.length !== 1 || only === null || only === undefined) {
      throw new UsageError(`这些行需要指定 --step：${rows.map((r) => `#${r.id} ${r.face}: ${requirementFor(r.face, form).steps.map((s) => s.step).join(" → ")}`).join("；")}`);
    }
    step = only;
  } else {
    if (!isStep(o.step)) throw new UsageError(`未知的 --step ${o.step}`);
    step = o.step;
  }
  for (const r of rows) {
    if (!requirementFor(r.face, form).steps.some((s) => s.step === step)) {
      throw new UsageError(`#${r.id}（${r.face}，${form}）不需要步骤 ${step}；需要：${requirementFor(r.face, form).steps.map((s) => s.step).join(" → ")}`);
    }
  }
  return { issueData, body, rows, step, form };
}

type Opened = { readonly co: Checkout; readonly head: string };

/** Every checkout must be clean: evidence only means something for a committed HEAD. */
async function openCheckouts(paths: readonly string[]): Promise<Opened[]> {
  const list = paths.length === 0 ? [process.cwd()] : paths;
  const out: Opened[] = [];
  for (const p of list) {
    const co = await checkoutAt(resolve(p));
    if (!(await isClean(co.path))) {
      throw new UsageError(`${co.path} 有未提交的 tracked 改动：证据只对提交过的 HEAD 有意义，先提交再采集`);
    }
    out.push({ co, head: await headOf(co.path) });
  }
  return out;
}

async function stateAfter(opened: readonly Opened[]): Promise<CheckoutState[]> {
  const out: CheckoutState[] = [];
  for (const { co, head } of opened) {
    out.push({
      repo: repoKey(co.repo),
      path: co.path,
      head,
      cleanBefore: true,
      cleanAfter: (await isClean(co.path)) && (await headOf(co.path)) === head,
    });
  }
  return out;
}

/** Upload target: the integration issue's repo, else the first checkout's repo (where the PR lives). */
function uploadRepo(t: Target, opened: readonly Opened[], issue: Ref): Repo {
  if (t.body.kind === "integration") return issue.repo;
  const first = opened[0];
  if (first === undefined) throw new UsageError("没有可用的 checkout");
  return first.co.repo;
}

async function uploadAll(repo: Repo, files: readonly string[]): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const f of files) out.push(await uploadAttachment(repo, f));
  return out;
}

async function imageFiles(paths: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    const abs = resolve(p);
    const s = await stat(abs).catch(() => null);
    if (s === null) throw new UsageError(`${p} 不存在`);
    if (s.isDirectory()) {
      for (const name of (await readdir(abs)).sort()) if (IMAGE_TYPES[extname(name).toLowerCase()] !== undefined) out.push(join(abs, name));
    } else if (IMAGE_TYPES[extname(abs).toLowerCase()] !== undefined) out.push(abs);
    else throw new UsageError(`${p} 不是图片（png/jpg/gif/webp）`);
  }
  return out;
}

async function snapshot(dir: string | null): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (dir === null) return m;
  const names = await readdir(dir).catch(() => [] as string[]);
  for (const n of names) {
    if (IMAGE_TYPES[extname(n).toLowerCase()] === undefined) continue;
    m.set(join(dir, n), (await stat(join(dir, n))).mtimeMs);
  }
  return m;
}

export type RunOptions = CaptureOptions & {
  readonly argv: readonly string[];
  readonly artifacts: string | null;
  readonly timeoutSeconds: number | null;
};

/** Run the command, tee its output, store the record. Returns the command's exit status. */
export async function evRun(o: RunOptions): Promise<number> {
  if (o.argv.length === 0) throw new UsageError("缺少要执行的命令：ghc ev run <issue> --row N [--step S] -- <command>");
  const t = await resolveTarget(o);
  const cos = await openCheckouts(o.checkouts);
  const artifactsDir = o.artifacts === null ? null : resolve(o.artifacts);
  const pre = await snapshot(artifactsDir);
  const { id, dir } = await newRecordDir(o.issue);
  const shell = process.env.SHELL ?? "/bin/sh";
  const command = o.argv.length === 1 ? (o.argv[0] as string) : o.argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`)).join(" ");
  const startedAt = new Date().toISOString();
  const proc = Bun.spawn([shell, "-c", command], { stdin: "inherit", stdout: "pipe", stderr: "pipe" });
  const tee = async (stream: ReadableStream<Uint8Array>, file: string, sink: NodeJS.WriteStream): Promise<number> => {
    const out = createWriteStream(join(dir, file));
    let lines = 0;
    let last = 10;
    for await (const chunk of stream) {
      out.write(chunk);
      sink.write(chunk);
      for (const b of chunk) if (b === 10) lines++;
      last = chunk.at(-1) ?? last;
    }
    const done = Promise.withResolvers<void>();
    out.end(done.resolve);
    await done.promise;
    return last === 10 ? lines : lines + 1;
  };
  let timedOut = false;
  const timer =
    o.timeoutSeconds === null
      ? null
      : setTimeout(() => {
          timedOut = true;
          proc.kill("SIGTERM");
        }, o.timeoutSeconds * 1000);
  const [stdoutLines, stderrLines, code] = await Promise.all([
    tee(proc.stdout, "stdout.txt", process.stdout),
    tee(proc.stderr, "stderr.txt", process.stderr),
    proc.exited,
  ]);
  clearTimeout(timer ?? undefined);
  const endedAt = new Date().toISOString();
  const completion: Completion = timedOut
    ? { kind: "timeout", seconds: o.timeoutSeconds ?? 0 }
    : proc.signalCode !== null
      ? { kind: "signal", signal: String(proc.signalCode) }
      : { kind: "exited", code };
  const post = await snapshot(artifactsDir);
  const fresh = [...post].filter(([p, m]) => pre.get(p) !== m).map(([p]) => p).sort();
  const attachments = await uploadAll(uploadRepo(t, cos, o.issue), fresh);
  const record: EvidenceRecord = {
    id,
    issue: refKey(o.issue),
    rows: t.rows.map((r) => r.id),
    step: t.step,
    capture: { kind: "run", command, shell, cwd: process.cwd(), completion, stdoutLines, stderrLines },
    startedAt,
    endedAt,
    checkouts: await stateAfter(cos),
    attachments,
    issueRev: t.issueData.bodyRev,
  };
  await saveRecord(dir, record);
  const att = attachments.length > 0 ? `，截图 ${attachments.length} 张` : "";
  process.stderr.write(`ghc: 已记录 ${id}（${refKey(o.issue)} #${record.rows.join(",")} ${t.step}${att}）\n`);
  switch (completion.kind) {
    case "exited":
      return completion.code;
    case "timeout":
      return 124;
    case "signal":
      return 128;
  }
}

export type AttachOptions = CaptureOptions & { readonly files: readonly string[] };

export async function evAttach(o: AttachOptions): Promise<void> {
  const t = await resolveTarget(o);
  const cos = await openCheckouts(o.checkouts);
  const files = await imageFiles(o.files);
  if (files.length === 0) throw new UsageError("没有找到图片文件");
  const { id, dir } = await newRecordDir(o.issue);
  const startedAt = new Date().toISOString();
  const attachments = await uploadAll(uploadRepo(t, cos, o.issue), files);
  const record: EvidenceRecord = {
    id,
    issue: refKey(o.issue),
    rows: t.rows.map((r) => r.id),
    step: t.step,
    capture: { kind: "attach" },
    startedAt,
    endedAt: new Date().toISOString(),
    checkouts: await stateAfter(cos),
    attachments,
    issueRev: t.issueData.bodyRev,
  };
  await saveRecord(dir, record);
  process.stderr.write(`ghc: 已记录 ${id}（${refKey(o.issue)} #${record.rows.join(",")} ${t.step}，截图 ${attachments.length} 张）\n`);
}
