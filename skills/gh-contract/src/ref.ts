// GitHub object references: `owner/repo#N`, `#N` (needs a default repo), and github.com URLs.

import { UsageError } from "./proc.ts";

export type Repo = { readonly owner: string; readonly name: string };
export type Ref = { readonly repo: Repo; readonly number: number };

export const repoKey = (r: Repo): string => `${r.owner}/${r.name}`;
export const refKey = (r: Ref): string => `${repoKey(r.repo)}#${r.number}`;
/** The buffer branch a tree's child PRs merge into, in every repo the tree touches; only the tree PR merges it into the default branch. */
export const treeBranch = (root: Ref): string => `tree/${root.repo.owner}-${root.repo.name}-${root.number}`;
export const sameRef = (a: Ref, b: Ref): boolean =>
  a.number === b.number &&
  a.repo.owner.toLowerCase() === b.repo.owner.toLowerCase() &&
  a.repo.name.toLowerCase() === b.repo.name.toLowerCase();
export const sameRepo = (a: Repo, b: Repo): boolean =>
  a.owner.toLowerCase() === b.owner.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase();

const NAME = "[A-Za-z0-9_.-]+";
const FULL = new RegExp(`^(${NAME})/(${NAME})#(\\d+)$`);
const SHORT = /^#(\d+)$/;
const URL_RE = new RegExp(`^https://github\\.com/(${NAME})/(${NAME})/(?:issues|pull)/(\\d+)(?:[/?#].*)?$`);

/** Parse one reference token; `#N` resolves against `context` when given. */
export function parseRef(text: string, context?: Repo): Ref | null {
  const t = text.trim();
  const full = FULL.exec(t) ?? URL_RE.exec(t);
  if (full !== null) {
    return { repo: { owner: full[1] as string, name: full[2] as string }, number: Number(full[3]) };
  }
  const short = SHORT.exec(t);
  if (short !== null && context !== undefined) return { repo: context, number: Number(short[1]) };
  return null;
}

export function parseRefArg(text: string | undefined, what: string): Ref {
  if (text === undefined) throw new UsageError(`missing ${what}: expected owner/repo#N or a github.com URL`);
  const r = parseRef(text);
  if (r === null) throw new UsageError(`invalid ${what} "${text}": expected owner/repo#N or a github.com URL`);
  return r;
}

const REF_SCAN = new RegExp(
  `(?:https://github\\.com/(${NAME})/(${NAME})/(?:issues|pull)/(\\d+))|(?:(${NAME})/(${NAME})#(\\d+))|(?:(?<![\\w/])#(\\d+))`,
  "g",
);

/** All references appearing in free text, in order, deduplicated. */
export function scanRefs(text: string, context: Repo): Ref[] {
  const out: Ref[] = [];
  for (const m of text.matchAll(REF_SCAN)) {
    let r: Ref;
    if (m[1] !== undefined) r = { repo: { owner: m[1], name: m[2] as string }, number: Number(m[3]) };
    else if (m[4] !== undefined) r = { repo: { owner: m[4], name: m[5] as string }, number: Number(m[6]) };
    else r = { repo: context, number: Number(m[7]) };
    if (!out.some((x) => sameRef(x, r))) out.push(r);
  }
  return out;
}

export function parseRepo(text: string): Repo | null {
  const m = new RegExp(`^(${NAME})/(${NAME})$`).exec(text.trim());
  return m === null ? null : { owner: m[1] as string, name: m[2] as string };
}

/** owner/repo from a git remote URL (https or ssh form). */
export function repoFromRemote(url: string): Repo | null {
  const m = new RegExp(`github\\.com[:/](${NAME})/(${NAME}?)(?:\\.git)?/?$`).exec(url.trim());
  return m === null ? null : { owner: m[1] as string, name: (m[2] as string).replace(/\.git$/, "") };
}
