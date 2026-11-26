import { EnvError, run, runOk } from "./proc.ts";
import { type Ref, repoKey } from "./ref.ts";

export type PatchId = string;

export const EMPTY_PATCH: PatchId = "0".repeat(40);

const PATCH_ID = /^[0-9a-f]{40}$/;

export const isPatchId = (s: string): s is PatchId => PATCH_ID.test(s);

export async function patchIdOfDiff(diff: string): Promise<PatchId> {
  if (diff.trim() === "") return EMPTY_PATCH;
  const r = await run(["git", "patch-id", "--stable"], { stdin: diff });
  if (r.code !== 0) throw new EnvError(`git patch-id: ${r.stderr.trim()}`);
  const id = r.stdout.trim().split(/\s+/)[0] ?? "";
  if (!isPatchId(id)) throw new EnvError(`git patch-id: unexpected output ${JSON.stringify(r.stdout.trim())}`);
  return id;
}

export async function localPatchId(path: string, baseRef: string, head = "HEAD"): Promise<PatchId> {
  const base = (await runOk(["git", "-C", path, "merge-base", baseRef, head])).trim();
  return patchIdOfDiff(await runOk(["git", "-C", path, "diff", "--no-ext-diff", "--no-color", `${base}..${head}`]));
}

export async function prPatchId(pr: Ref): Promise<PatchId> {
  return patchIdOfDiff(await runOk(["gh", "pr", "diff", String(pr.number), "--repo", repoKey(pr.repo), "--color", "never"]));
}
