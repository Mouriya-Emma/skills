// GitHub reads and writes through `gh`. Every response is parsed here into the shapes the checks use.

import { arr, bool, field, num, type Obj, obj, objOrNull, str, strOrNull } from "./json.ts";
import { EnvError, ghJson, graphql, run, runOk } from "./proc.ts";
import { type Ref, type Repo, repoKey } from "./ref.ts";

export type Comment = {
  readonly id: number;
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
  readonly url: string;
};

export type IssueData = {
  readonly ref: Ref;
  /** GraphQL node ID, for sub-issue mutations. */
  readonly nodeId: string;
  readonly title: string;
  readonly state: "OPEN" | "CLOSED";
  readonly stateReason: string | null;
  readonly body: string;
  readonly createdAt: string;
  /** Body revision: last body edit, else creation. */
  readonly bodyRev: string;
  readonly url: string;
  readonly parent: Ref | null;
  readonly subIssues: readonly { ref: Ref; state: "OPEN" | "CLOSED"; title: string }[];
  readonly comments: readonly Comment[];
};

export type PrData = {
  readonly ref: Ref;
  readonly title: string;
  readonly state: "OPEN" | "CLOSED" | "MERGED";
  readonly isDraft: boolean;
  readonly body: string;
  readonly url: string;
  readonly headRefOid: string;
  readonly headRefName: string;
  readonly headRepo: Repo | null;
  readonly baseRefName: string;
  readonly baseRefOid: string;
  readonly mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  readonly defaultBranch: string;
  /** Every check run and commit status on the head commit. */
  readonly checks: readonly Check[];
  readonly closingIssues: readonly Ref[];
  readonly files: readonly string[];
  readonly commits: readonly string[];
  readonly comments: readonly Comment[];
};

export type CheckState = "success" | "pending" | "failure";
export type Check = { readonly name: string; readonly state: CheckState };

function checkRunState(status: string, conclusion: string | null): CheckState {
  if (status !== "COMPLETED") return "pending";
  return conclusion === "SUCCESS" || conclusion === "NEUTRAL" || conclusion === "SKIPPED" ? "success" : "failure";
}

function statusState(state: string): CheckState {
  if (state === "SUCCESS") return "success";
  return state === "PENDING" || state === "EXPECTED" ? "pending" : "failure";
}

function parseCheck(o: Obj): Check {
  const t = str(field(o, "__typename"), "check.__typename");
  if (t === "CheckRun") return { name: str(field(o, "name"), "check.name"), state: checkRunState(str(field(o, "status"), "check.status"), strOrNull(field(o, "conclusion"), "check.conclusion")) };
  if (t === "StatusContext") return { name: str(field(o, "context"), "status.context"), state: statusState(str(field(o, "state"), "status.state")) };
  throw new EnvError(`unexpected check type ${t}`);
}

const PAGE = "pageInfo { hasNextPage endCursor }";

function repoOf(o: Obj, what: string): Repo {
  const r = obj(field(o, "repository"), what);
  return { owner: str(field(obj(field(r, "owner"), what), "login"), what), name: str(field(r, "name"), what) };
}

function refOf(o: Obj, what: string): Ref {
  return { repo: repoOf(o, what), number: num(field(o, "number"), what) };
}

function state2(v: unknown, what: string): "OPEN" | "CLOSED" {
  const s = str(v, what);
  if (s !== "OPEN" && s !== "CLOSED") throw new EnvError(`${what}: unexpected state ${s}`);
  return s;
}

function parseComment(n: unknown): Comment {
  const o = obj(n, "comment");
  const author = objOrNull(field(o, "author"), "comment.author");
  return {
    id: num(field(o, "databaseId"), "comment.databaseId"),
    author: author === null ? "ghost" : str(field(author, "login"), "comment.author.login"),
    body: str(field(o, "body"), "comment.body"),
    createdAt: str(field(o, "createdAt"), "comment.createdAt"),
    url: str(field(o, "url"), "comment.url"),
  };
}

/** Follow one connection to the end. `pick` extracts the connection object from a response. */
async function paginate(query: string, vars: Record<string, string | number | null>, pick: (data: unknown) => Obj): Promise<unknown[]> {
  const out: unknown[] = [];
  let after: string | null = null;
  for (;;) {
    const conn = pick(await graphql(query, { ...vars, after }));
    out.push(...arr(field(conn, "nodes"), "nodes"));
    const page = obj(field(conn, "pageInfo"), "pageInfo");
    if (!bool(field(page, "hasNextPage"), "hasNextPage")) return out;
    after = str(field(page, "endCursor"), "endCursor");
  }
}

const node = (data: unknown, kind: "issue" | "pullRequest"): Obj =>
  obj(field(obj(field(obj(data, "data"), "repository"), "repository"), kind), kind);

export async function objectKind(ref: Ref): Promise<"Issue" | "PullRequest"> {
  const data = await graphql(
    "query($o:String!,$n:String!,$num:Int!){repository(owner:$o,name:$n){issueOrPullRequest(number:$num){__typename}}}",
    { o: ref.repo.owner, n: ref.repo.name, num: ref.number },
  );
  const io = objOrNull(field(obj(field(obj(data, "data"), "repository"), "repository"), "issueOrPullRequest"), "issueOrPullRequest");
  if (io === null) throw new EnvError(`${repoKey(ref.repo)}#${ref.number} not found`);
  const t = str(field(io, "__typename"), "__typename");
  if (t !== "Issue" && t !== "PullRequest") throw new EnvError(`unexpected type ${t}`);
  return t;
}

const COMMENT_FIELDS = "nodes { databaseId author { login } body createdAt url }";

export async function getIssue(ref: Ref): Promise<IssueData> {
  const v = { o: ref.repo.owner, n: ref.repo.name, num: ref.number };
  const core = node(
    await graphql(
      `query($o:String!,$n:String!,$num:Int!){repository(owner:$o,name:$n){issue(number:$num){
        id title state stateReason body createdAt lastEditedAt url
        parent { number repository { name owner { login } } }
      }}}`,
      v,
    ),
    "issue",
  );
  const comments = await paginate(
    `query($o:String!,$n:String!,$num:Int!,$after:String){repository(owner:$o,name:$n){issue(number:$num){
      comments(first:100, after:$after){ ${PAGE} ${COMMENT_FIELDS} } }}}`,
    v,
    (d) => obj(field(node(d, "issue"), "comments"), "comments"),
  );
  const subs = await paginate(
    `query($o:String!,$n:String!,$num:Int!,$after:String){repository(owner:$o,name:$n){issue(number:$num){
      subIssues(first:100, after:$after){ ${PAGE} nodes { number state title repository { name owner { login } } } } }}}`,
    v,
    (d) => obj(field(node(d, "issue"), "subIssues"), "subIssues"),
  );
  const parent = objOrNull(field(core, "parent"), "parent");
  const createdAt = str(field(core, "createdAt"), "createdAt");
  return {
    ref,
    nodeId: str(field(core, "id"), "id"),
    title: str(field(core, "title"), "title"),
    state: state2(field(core, "state"), "state"),
    stateReason: strOrNull(field(core, "stateReason"), "stateReason"),
    body: str(field(core, "body"), "body"),
    createdAt,
    bodyRev: strOrNull(field(core, "lastEditedAt"), "lastEditedAt") ?? createdAt,
    url: str(field(core, "url"), "url"),
    parent: parent === null ? null : refOf(parent, "parent"),
    subIssues: subs.map((s) => {
      const o = obj(s, "subIssue");
      return { ref: refOf(o, "subIssue"), state: state2(field(o, "state"), "subIssue.state"), title: str(field(o, "title"), "subIssue.title") };
    }),
    comments: comments.map(parseComment),
  };
}

export async function getPr(ref: Ref): Promise<PrData> {
  const v = { o: ref.repo.owner, n: ref.repo.name, num: ref.number };
  const core = node(
    await graphql(
      `query($o:String!,$n:String!,$num:Int!){repository(owner:$o,name:$n){pullRequest(number:$num){
        title state isDraft body url headRefOid headRefName baseRefName baseRefOid mergeable
        headRepository { name owner { login } }
        repository { defaultBranchRef { name } }
        commits(last:1){ nodes { commit { statusCheckRollup { contexts(first:100){ nodes { __typename
          ... on CheckRun { name status conclusion } ... on StatusContext { context state } } } } } } }
      }}}`,
      v,
    ),
    "pullRequest",
  );
  const pick = (k: string) => (d: unknown) => obj(field(node(d, "pullRequest"), k), k);
  const closing = await paginate(
    `query($o:String!,$n:String!,$num:Int!,$after:String){repository(owner:$o,name:$n){pullRequest(number:$num){
      closingIssuesReferences(first:50, after:$after){ ${PAGE} nodes { number repository { name owner { login } } } } }}}`,
    v,
    pick("closingIssuesReferences"),
  );
  const files = await paginate(
    `query($o:String!,$n:String!,$num:Int!,$after:String){repository(owner:$o,name:$n){pullRequest(number:$num){
      files(first:100, after:$after){ ${PAGE} nodes { path } } }}}`,
    v,
    pick("files"),
  );
  const commits = await paginate(
    `query($o:String!,$n:String!,$num:Int!,$after:String){repository(owner:$o,name:$n){pullRequest(number:$num){
      commits(first:100, after:$after){ ${PAGE} nodes { commit { oid } } } }}}`,
    v,
    pick("commits"),
  );
  const comments = await paginate(
    `query($o:String!,$n:String!,$num:Int!,$after:String){repository(owner:$o,name:$n){pullRequest(number:$num){
      comments(first:100, after:$after){ ${PAGE} ${COMMENT_FIELDS} } }}}`,
    v,
    pick("comments"),
  );
  const state = str(field(core, "state"), "state");
  if (state !== "OPEN" && state !== "CLOSED" && state !== "MERGED") throw new EnvError(`unexpected PR state ${state}`);
  const mergeable = str(field(core, "mergeable"), "mergeable");
  if (mergeable !== "MERGEABLE" && mergeable !== "CONFLICTING" && mergeable !== "UNKNOWN") throw new EnvError(`unexpected mergeable ${mergeable}`);
  const headRepo = objOrNull(field(core, "headRepository"), "headRepository");
  const lastCommit = arr(field(obj(field(core, "commits"), "commits"), "nodes"), "commits").at(-1);
  const rollup = lastCommit === undefined ? null : objOrNull(field(obj(field(obj(lastCommit, "c"), "commit"), "commit"), "statusCheckRollup"), "rollup");
  const checkNodes = rollup === null ? [] : arr(field(obj(field(rollup, "contexts"), "contexts"), "nodes"), "contexts");
  const defaultRef = objOrNull(field(obj(field(core, "repository"), "repository"), "defaultBranchRef"), "defaultBranchRef");
  return {
    ref,
    title: str(field(core, "title"), "title"),
    state,
    isDraft: bool(field(core, "isDraft"), "isDraft"),
    body: str(field(core, "body"), "body"),
    url: str(field(core, "url"), "url"),
    headRefOid: str(field(core, "headRefOid"), "headRefOid"),
    headRefName: str(field(core, "headRefName"), "headRefName"),
    headRepo:
      headRepo === null
        ? null
        : { owner: str(field(obj(field(headRepo, "owner"), "owner"), "login"), "owner"), name: str(field(headRepo, "name"), "name") },
    baseRefName: str(field(core, "baseRefName"), "baseRefName"),
    baseRefOid: str(field(core, "baseRefOid"), "baseRefOid"),
    mergeable,
    defaultBranch: defaultRef === null ? "" : str(field(defaultRef, "name"), "defaultBranchRef.name"),
    checks: checkNodes.map((c) => parseCheck(obj(c, "check"))),
    closingIssues: closing.map((c) => refOf(obj(c, "closing"), "closing")),
    files: files.map((f) => str(field(obj(f, "file"), "path"), "file.path")),
    commits: commits.map((c) => str(field(obj(field(obj(c, "c"), "commit"), "commit"), "oid"), "oid")),
    comments: comments.map(parseComment),
  };
}

export type MergedPr = { readonly ref: Ref; readonly body: string; readonly headRefOid: string; readonly mergeCommit: string; readonly mergedAt: string };

/** PRs merged into `base` (GitHub also marks a PR merged when another PR merges its head commit). */
export async function mergedPrsInto(repo: Repo, base: string): Promise<MergedPr[]> {
  const rows = arr(
    await ghJson(["pr", "list", "--repo", repoKey(repo), "--base", base, "--state", "merged", "--limit", "500", "--json", "number,body,headRefOid,mergeCommit,mergedAt"]),
    "prs",
  );
  return rows.map((r) => {
    const o = obj(r, "pr");
    return {
      ref: { repo, number: num(field(o, "number"), "pr.number") },
      body: str(field(o, "body"), "pr.body"),
      headRefOid: str(field(o, "headRefOid"), "pr.headRefOid"),
      mergeCommit: str(field(obj(field(o, "mergeCommit"), "pr.mergeCommit"), "oid"), "pr.mergeCommit.oid"),
      mergedAt: str(field(o, "mergedAt"), "pr.mergedAt"),
    };
  });
}

/** PRs whose head branch is `head`, in the given state. */
export async function prsFrom(repo: Repo, head: string, state: "open" | "merged"): Promise<Ref[]> {
  const rows = arr(await ghJson(["pr", "list", "--repo", repoKey(repo), "--head", head, "--state", state, "--json", "number"]), "prs");
  return rows.map((r) => ({ repo, number: num(field(obj(r, "pr"), "number"), "pr.number") }));
}

/** Tip of a remote branch, or null when it does not exist. */
export async function branchHead(repo: Repo, branch: string): Promise<string | null> {
  const r = await run(["gh", "api", `repos/${repoKey(repo)}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, "--jq", ".object.sha"]);
  if (r.code === 0) return r.stdout.trim();
  if (/HTTP 404/.test(r.stderr)) return null;
  throw new EnvError(`branch ${branch}: ${r.stderr.trim()}`);
}

export async function commitStatus(repo: Repo, sha: string, context: string): Promise<{ state: string; description: string; targetUrl: string | null } | null> {
  const pages = arr(await ghJson(["api", `repos/${repoKey(repo)}/commits/${sha}/statuses?per_page=100`, "--paginate", "--slurp"]), "pages");
  // Statuses come newest first; the first entry for a context is its current state.
  for (const page of pages) {
    for (const s of arr(page, "statuses")) {
      const o = obj(s, "status");
      if (field(o, "context") === context) {
        return {
          state: str(field(o, "state"), "status.state"),
          description: strOrNull(field(o, "description"), "status.description") ?? "",
          targetUrl: strOrNull(field(o, "target_url"), "status.target_url"),
        };
      }
    }
  }
  return null;
}

export async function setStatus(repo: Repo, sha: string, s: { state: "success" | "failure"; context: string; description: string; targetUrl: string }): Promise<void> {
  await runOk([
    "gh",
    "api",
    "-X",
    "POST",
    `repos/${repoKey(repo)}/statuses/${sha}`,
    "-f",
    `state=${s.state}`,
    "-f",
    `context=${s.context}`,
    "-f",
    `description=${s.description.slice(0, 140)}`,
    "-f",
    `target_url=${s.targetUrl}`,
  ]);
}

/** Post a new comment on an issue or PR; returns its URL. */
export async function postComment(ref: Ref, body: string): Promise<string> {
  const res = obj(
    await ghJson(["api", "-X", "POST", `repos/${repoKey(ref.repo)}/issues/${ref.number}/comments`, "--input", "-"], JSON.stringify({ body })),
    "comment",
  );
  return str(field(res, "html_url"), "comment.html_url");
}

/** Merge base of two commits, from the compare API. */
export async function mergeBaseRemote(repo: Repo, base: string, head: string): Promise<string> {
  const res = obj(await ghJson(["api", `repos/${repoKey(repo)}/compare/${base}...${head}`, "--jq", "{sha: .merge_base_commit.sha}"]), "compare");
  return str(field(res, "sha"), "compare.merge_base_commit.sha");
}

/** True when `ancestor` is reachable from `descendant` (or equal), using the compare API. */
export async function isAncestorRemote(repo: Repo, ancestor: string, descendant: string): Promise<boolean> {
  const res = obj(await ghJson(["api", `repos/${repoKey(repo)}/compare/${ancestor}...${descendant}`, "--jq", "{status: .status}"]), "compare");
  const status = str(field(res, "status"), "compare.status");
  return status === "ahead" || status === "identical";
}

/** File content at a commit, or null when the path does not exist there. */
export async function fileAt(repo: Repo, sha: string, path: string): Promise<string | null> {
  const r = await run(["gh", "api", `repos/${repoKey(repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`, "-H", "Accept: application/vnd.github.raw"]);
  if (r.code === 0) return r.stdout;
  if (/HTTP 404/.test(r.stderr)) return null;
  throw new EnvError(`contents ${path}@${sha}: ${r.stderr.trim()}`);
}

export async function repoDatabaseId(repo: Repo): Promise<number> {
  const res = obj(await ghJson(["api", `repos/${repoKey(repo)}`, "--jq", "{id: .id}"]), "repo");
  return num(field(res, "id"), "repo.id");
}
