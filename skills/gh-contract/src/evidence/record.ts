// Evidence records: what `ghc ev run/attach` observed. ghc is their source; the store is a directory per issue.

import { mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { arr, bool, field, num, type Obj, obj, str } from "../json.ts";
import { type Ref, refKey } from "../ref.ts";
import { isStep, type Step } from "../requirements.ts";

export type Completion =
  | { readonly kind: "exited"; readonly code: number }
  | { readonly kind: "timeout"; readonly seconds: number }
  | { readonly kind: "signal"; readonly signal: string };

export type Capture =
  | {
      readonly kind: "run";
      readonly command: string;
      readonly shell: string;
      readonly cwd: string;
      readonly completion: Completion;
      readonly stdoutLines: number;
      readonly stderrLines: number;
    }
  | { readonly kind: "attach" };

export type Attachment = { readonly source: string; readonly url: string; readonly contentType: string; readonly bytes: number };

export type CheckoutState = {
  readonly repo: string;
  readonly path: string;
  readonly head: string;
  readonly cleanBefore: boolean;
  readonly cleanAfter: boolean;
};

export type EvidenceRecord = {
  readonly id: string;
  readonly issue: string;
  readonly rows: readonly number[];
  readonly step: Step;
  readonly capture: Capture;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly checkouts: readonly CheckoutState[];
  readonly attachments: readonly Attachment[];
  /** Issue body revision the record was taken against. */
  readonly issueRev: string;
};

export function storeDir(issue: Ref): string {
  const base = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(base, "ghc", issue.repo.owner, issue.repo.name, String(issue.number));
}

export async function newRecordDir(issue: Ref): Promise<{ id: string; dir: string }> {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const id = `${stamp}-${crypto.randomUUID().slice(0, 6)}`;
  const dir = join(storeDir(issue), id);
  await mkdir(dir, { recursive: true });
  return { id, dir };
}

export async function saveRecord(dir: string, r: EvidenceRecord): Promise<void> {
  await Bun.write(join(dir, "record.json"), `${JSON.stringify(r, null, 2)}\n`);
}

function parseCompletion(o: Obj): Completion {
  const kind = str(field(o, "kind"), "completion.kind");
  switch (kind) {
    case "exited":
      return { kind, code: num(field(o, "code"), "completion.code") };
    case "timeout":
      return { kind, seconds: num(field(o, "seconds"), "completion.seconds") };
    case "signal":
      return { kind, signal: str(field(o, "signal"), "completion.signal") };
    default:
      throw new Error(`record: unknown completion ${kind}`);
  }
}

function parseCapture(o: Obj): Capture {
  const kind = str(field(o, "kind"), "capture.kind");
  if (kind === "attach") return { kind };
  if (kind !== "run") throw new Error(`record: unknown capture ${kind}`);
  return {
    kind,
    command: str(field(o, "command"), "capture.command"),
    shell: str(field(o, "shell"), "capture.shell"),
    cwd: str(field(o, "cwd"), "capture.cwd"),
    completion: parseCompletion(obj(field(o, "completion"), "completion")),
    stdoutLines: num(field(o, "stdoutLines"), "capture.stdoutLines"),
    stderrLines: num(field(o, "stderrLines"), "capture.stderrLines"),
  };
}

export function parseRecord(v: unknown): EvidenceRecord {
  const o = obj(v, "record");
  const step = str(field(o, "step"), "record.step");
  if (!isStep(step)) throw new Error(`record: unknown step ${step}`);
  return {
    id: str(field(o, "id"), "record.id"),
    issue: str(field(o, "issue"), "record.issue"),
    rows: arr(field(o, "rows"), "record.rows").map((x) => num(x, "row")),
    step,
    capture: parseCapture(obj(field(o, "capture"), "capture")),
    startedAt: str(field(o, "startedAt"), "record.startedAt"),
    endedAt: str(field(o, "endedAt"), "record.endedAt"),
    checkouts: arr(field(o, "checkouts"), "record.checkouts").map((c) => {
      const co = obj(c, "checkout");
      return {
        repo: str(field(co, "repo"), "checkout.repo"),
        path: str(field(co, "path"), "checkout.path"),
        head: str(field(co, "head"), "checkout.head"),
        cleanBefore: bool(field(co, "cleanBefore"), "checkout.cleanBefore"),
        cleanAfter: bool(field(co, "cleanAfter"), "checkout.cleanAfter"),
      };
    }),
    attachments: arr(field(o, "attachments"), "record.attachments").map((a) => {
      const ao = obj(a, "attachment");
      return {
        source: str(field(ao, "source"), "attachment.source"),
        url: str(field(ao, "url"), "attachment.url"),
        contentType: str(field(ao, "contentType"), "attachment.contentType"),
        bytes: num(field(ao, "bytes"), "attachment.bytes"),
      };
    }),
    issueRev: str(field(o, "issueRev"), "record.issueRev"),
  };
}

export async function loadRecords(issue: Ref): Promise<{ record: EvidenceRecord; dir: string }[]> {
  const root = storeDir(issue);
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return []; // no evidence recorded for this issue yet
  }
  const out: { record: EvidenceRecord; dir: string }[] = [];
  for (const name of names.sort()) {
    const file = Bun.file(join(root, name, "record.json"));
    if (!(await file.exists())) continue; // a run still in progress or aborted before saving
    const record = parseRecord(await file.json());
    if (record.issue === refKey(issue)) out.push({ record, dir: join(root, name) });
  }
  return out;
}

export async function tail(dir: string, stream: "stdout" | "stderr", lines: number): Promise<{ text: string; total: number }> {
  const f = Bun.file(join(dir, `${stream}.txt`));
  if (!(await f.exists())) return { text: "", total: 0 };
  const all = (await f.text()).replace(/\n$/, "").split("\n");
  const total = all.length === 1 && all[0] === "" ? 0 : all.length;
  return { text: all.slice(-lines).join("\n"), total };
}
