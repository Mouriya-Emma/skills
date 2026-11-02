// Local git facts for a checkout.

import { isAncestorRemote } from "./github.ts";
import { EnvError, run, runOk, UsageError } from "./proc.ts";
import { type Repo, repoFromRemote } from "./ref.ts";

export type Checkout = { readonly path: string; readonly repo: Repo };

export async function checkoutAt(path: string): Promise<Checkout> {
  const top = await run(["git", "-C", path, "rev-parse", "--show-toplevel"]);
  if (top.code !== 0) throw new UsageError(`${path} is not inside a git checkout`);
  const root = top.stdout.trim();
  const remote = await run(["git", "-C", root, "remote", "get-url", "origin"]);
  const repo = remote.code === 0 ? repoFromRemote(remote.stdout) : null;
  if (repo === null) throw new UsageError(`${root}: origin is not a github.com remote`);
  return { path: root, repo };
}

export async function headOf(path: string): Promise<string> {
  return (await runOk(["git", "-C", path, "rev-parse", "HEAD"])).trim();
}

/** Tracked changes (staged or unstaged); untracked files do not change what HEAD builds. */
export async function isClean(path: string): Promise<boolean> {
  return (await runOk(["git", "-C", path, "status", "--porcelain", "--untracked-files=no"])).trim() === "";
}

export async function hasCommit(path: string, sha: string): Promise<boolean> {
  return (await run(["git", "-C", path, "cat-file", "-e", `${sha}^{commit}`])).code === 0;
}

/** Ancestry from the local object store when both commits are present, else from GitHub. */
export async function isAncestor(co: Checkout | null, repo: Repo, ancestor: string, descendant: string): Promise<boolean> {
  if (co !== null && (await hasCommit(co.path, ancestor)) && (await hasCommit(co.path, descendant))) {
    const r = await run(["git", "-C", co.path, "merge-base", "--is-ancestor", ancestor, descendant]);
    if (r.code === 0) return true;
    if (r.code === 1) return false;
    throw new EnvError(`git merge-base: ${r.stderr.trim()}`);
  }
  return isAncestorRemote(repo, ancestor, descendant);
}

export async function mergeBase(path: string, a: string, b: string): Promise<string> {
  return (await runOk(["git", "-C", path, "merge-base", a, b])).trim();
}

export async function changedFiles(path: string, from: string, to: string): Promise<string[]> {
  const r = await run(["git", "-C", path, "diff", "--name-only", `${from}..${to}`]);
  return r.code === 0 ? r.stdout.split("\n").filter((l) => l !== "") : [];
}

export async function defaultBranchRef(path: string): Promise<string> {
  const r = await run(["git", "-C", path, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (r.code === 0) return r.stdout.trim();
  for (const b of ["origin/main", "origin/master"]) {
    if ((await run(["git", "-C", path, "rev-parse", "--verify", "--quiet", b])).code === 0) return b;
  }
  throw new EnvError(`${path}: cannot determine origin default branch`);
}
