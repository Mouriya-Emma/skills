// Local git facts for a checkout.

import { type Changes, changedFilesRemote, isAncestorRemote } from "./github.ts";
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

/** Paths changed from `from` to `to` (`from` an ancestor of `to`): local diff when both commits are present, else the compare API. A rename lists both paths. */
export async function changedFiles(co: Checkout | null, repo: Repo, from: string, to: string): Promise<Changes> {
  if (co !== null && (await hasCommit(co.path, from)) && (await hasCommit(co.path, to))) {
    const r = await run(["git", "-C", co.path, "diff", "--name-only", "--no-renames", `${from}..${to}`]);
    if (r.code !== 0) throw new EnvError(`git diff: ${r.stderr.trim()}`);
    return { kind: "all", files: r.stdout.split("\n").filter((l) => l !== "") };
  }
  return changedFilesRemote(repo, from, to);
}

export async function defaultBranchRef(path: string): Promise<string> {
  const r = await run(["git", "-C", path, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (r.code === 0) return r.stdout.trim();
  for (const b of ["origin/main", "origin/master"]) {
    if ((await run(["git", "-C", path, "rev-parse", "--verify", "--quiet", b])).code === 0) return b;
  }
  throw new EnvError(`${path}: cannot determine origin default branch`);
}

export async function fetchRefs(path: string, remote: string, refs: readonly string[]): Promise<void> {
  await runOk(["git", "-C", path, "fetch", "--no-tags", remote, ...refs]);
}

export async function currentBranch(path: string): Promise<string | null> {
  const r = await run(["git", "-C", path, "symbolic-ref", "--quiet", "--short", "HEAD"]);
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function checkoutDetached(path: string, rev: string): Promise<void> {
  await runOk(["git", "-C", path, "checkout", "--detach", rev]);
}

export async function checkoutBranch(path: string, branch: string): Promise<void> {
  await runOk(["git", "-C", path, "checkout", branch]);
}

export async function localAncestor(path: string, ancestor: string, descendant: string): Promise<boolean> {
  const r = await run(["git", "-C", path, "merge-base", "--is-ancestor", ancestor, descendant]);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  throw new EnvError(`git merge-base: ${r.stderr.trim()}`);
}

export async function unmergedFiles(path: string): Promise<readonly string[]> {
  const out = await runOk(["git", "-C", path, "diff", "--name-only", "--diff-filter=U"]);
  return out.split("\n").filter((l) => l !== "");
}

export async function pushWithLease(path: string, headRef: string, expected: string): Promise<void> {
  await runOk(["git", "-C", path, "push", `--force-with-lease=refs/heads/${headRef}:${expected}`, "origin", `HEAD:refs/heads/${headRef}`]);
}

export async function cloneRepo(repo: Repo, dir: string): Promise<void> {
  await runOk(["gh", "repo", "clone", `${repo.owner}/${repo.name}`, dir, "--", "--no-tags"]);
}
