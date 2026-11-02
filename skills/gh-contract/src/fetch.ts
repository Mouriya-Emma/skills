// `ghc fetch`: the complete issue/PR to local files, attachments downloaded, contract references expanded.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type Comment, getIssue, getPr, type IssueData, objectKind, type PrData } from "./github.ts";
import { parseIssue } from "./issue.ts";
import { arr, bool, field, obj, str } from "./json.ts";
import { graphql, run } from "./proc.ts";
import { type Ref, refKey, repoKey } from "./ref.ts";

const PAGE = "pageInfo { hasNextPage endCursor }";

async function pages(query: string, vars: Record<string, string | number | null>, path: readonly string[]): Promise<unknown[]> {
  const out: unknown[] = [];
  let after: string | null = null;
  for (;;) {
    let cur: unknown = await graphql(query, { ...vars, after });
    for (const k of path) cur = field(obj(cur, k), k);
    const conn = obj(cur, "connection");
    out.push(...arr(field(conn, "nodes"), "nodes"));
    const page = obj(field(conn, "pageInfo"), "pageInfo");
    if (!bool(field(page, "hasNextPage"), "hasNextPage")) return out;
    after = str(field(page, "endCursor"), "endCursor");
  }
}

const TIMELINE_ITEM = `__typename
  ... on CrossReferencedEvent { createdAt actor { login } source { __typename ... on Issue { number url } ... on PullRequest { number url } } }
  ... on ConnectedEvent { createdAt actor { login } subject { __typename ... on Issue { number url } ... on PullRequest { number url } } }
  ... on DisconnectedEvent { createdAt actor { login } subject { __typename ... on Issue { number url } ... on PullRequest { number url } } }
  ... on ClosedEvent { createdAt actor { login } stateReason closer { __typename ... on PullRequest { number url } ... on Commit { oid } } }
  ... on ReopenedEvent { createdAt actor { login } }
  ... on LabeledEvent { createdAt actor { login } label { name } }
  ... on UnlabeledEvent { createdAt actor { login } label { name } }
  ... on AssignedEvent { createdAt actor { login } }
  ... on RenamedTitleEvent { createdAt actor { login } previousTitle currentTitle }
  ... on ReferencedEvent { createdAt actor { login } commit { oid } }`;

const PR_TIMELINE_ITEM = `${TIMELINE_ITEM}
  ... on HeadRefForcePushedEvent { createdAt actor { login } beforeCommit { oid } afterCommit { oid } }
  ... on MergedEvent { createdAt actor { login } commit { oid } }
  ... on ReviewRequestedEvent { createdAt actor { login } }`;

async function issueExtras(ref: Ref): Promise<Record<string, unknown>> {
  const v = { o: ref.repo.owner, n: ref.repo.name, num: ref.number };
  const meta = await graphql(
    `query($o:String!,$n:String!,$num:Int!){repository(owner:$o,name:$n){issue(number:$num){
      labels(first:100){ nodes { name } } assignees(first:100){ nodes { login } } author { login } }}}`,
    v,
  );
  const timeline = await pages(
    `query($o:String!,$n:String!,$num:Int!,$after:String){repository(owner:$o,name:$n){issue(number:$num){
      timelineItems(first:100, after:$after){ ${PAGE} nodes { ${TIMELINE_ITEM} } } }}}`,
    v,
    ["repository", "issue", "timelineItems"],
  );
  return { meta: field(obj(field(obj(meta, "data"), "repository"), "repository"), "issue"), timeline };
}

async function prExtras(ref: Ref): Promise<Record<string, unknown>> {
  const v = { o: ref.repo.owner, n: ref.repo.name, num: ref.number };
  const pr = ["repository", "pullRequest"];
  const meta = await graphql(
    `query($o:String!,$n:String!,$num:Int!){repository(owner:$o,name:$n){pullRequest(number:$num){
      labels(first:100){ nodes { name } } assignees(first:100){ nodes { login } } author { login }
      reviewRequests(first:100){ nodes { requestedReviewer { __typename ... on User { login } ... on Team { name } } } }
      commits(last:1){ nodes { commit { oid statusCheckRollup { state contexts(first:100){ nodes {
        __typename ... on CheckRun { name status conclusion detailsUrl } ... on StatusContext { context state description targetUrl } } } } } } }
    }}}`,
    v,
  );
  const reviews = await pages(
    `query($o:String!,$n:String!,$num:Int!,$after:String){repository(owner:$o,name:$n){pullRequest(number:$num){
      reviews(first:100, after:$after){ ${PAGE} nodes { databaseId author { login } state body submittedAt url commit { oid } } } }}}`,
    v,
    [...pr, "reviews"],
  );
  const threads = await pages(
    `query($o:String!,$n:String!,$num:Int!,$after:String){repository(owner:$o,name:$n){pullRequest(number:$num){
      reviewThreads(first:50, after:$after){ ${PAGE} nodes { isResolved isOutdated path line
        comments(first:100){ nodes { databaseId author { login } body createdAt url diffHunk } } } } }}}`,
    v,
    [...pr, "reviewThreads"],
  );
  const timeline = await pages(
    `query($o:String!,$n:String!,$num:Int!,$after:String){repository(owner:$o,name:$n){pullRequest(number:$num){
      timelineItems(first:100, after:$after){ ${PAGE} nodes { ${PR_TIMELINE_ITEM} } } }}}`,
    v,
    [...pr, "timelineItems"],
  );
  return { meta: field(obj(field(obj(meta, "data"), "repository"), "repository"), "pullRequest"), reviews, reviewThreads: threads, timeline };
}

const ATTACHMENT = /https:\/\/(?:github\.com\/user-attachments\/(?:assets|files)\/[^\s)"'<>]+|(?:private-)?user-images\.githubusercontent\.com\/[^\s)"'<>]+)/g;

async function downloadAttachments(texts: readonly string[], dir: string): Promise<{ url: string; file: string | null; error: string | null }[]> {
  const urls = [...new Set(texts.flatMap((t) => [...t.matchAll(ATTACHMENT)].map((m) => m[0])))];
  const out: { url: string; file: string | null; error: string | null }[] = [];
  if (urls.length > 0) await mkdir(dir, { recursive: true });
  for (const [i, url] of urls.entries()) {
    const name = `${String(i + 1).padStart(3, "0")}-${url.split("/").at(-1)?.split("?")[0] ?? "file"}`;
    const file = join(dir, name);
    const r = await run(["curl", "-fsSL", "--max-time", "60", "-o", file, url]);
    out.push(r.code === 0 ? { url, file, error: null } : { url, file: null, error: r.stderr.trim() || `curl exit ${r.code}` });
  }
  return out;
}

/** The text of clause §K in a decision comment: from the line that opens with §K to the next §-numbered line. */
export function clauseText(body: string, k: number): string | null {
  const lines = body.split(/\r?\n/);
  const opens = (l: string, n?: number): boolean => new RegExp(`^\\s*(?:#{1,6}\\s*|[-*]\\s*|\\*\\*)?§\\s*${n ?? "\\d+"}(?!\\d)`).test(l);
  const start = lines.findIndex((l) => opens(l, k));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (opens(lines[i] as string)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

async function expandRefs(issue: IssueData, dir: string): Promise<{ ref: string; file: string | null; error: string | null }[]> {
  const parsed = parseIssue(issue.body, { repo: issue.ref.repo, hasParent: issue.parent !== null });
  const refs = parsed.value?.contractRefs ?? [];
  const out: { ref: string; file: string | null; error: string | null }[] = [];
  if (refs.length > 0) await mkdir(dir, { recursive: true });
  for (const c of refs) {
    const label = `${refKey(c.issue)} 决策 ${c.commentId} §${c.clause}`;
    const r = await run(["gh", "api", `repos/${repoKey(c.issue.repo)}/issues/comments/${c.commentId}`, "--jq", ".body"]);
    if (r.code !== 0) {
      out.push({ ref: label, file: null, error: `无法读取 comment ${c.commentId}：${r.stderr.trim()}` });
      continue;
    }
    const text = clauseText(r.stdout, c.clause);
    if (text === null) {
      out.push({ ref: label, file: null, error: `comment ${c.commentId} 里没有 §${c.clause}` });
      continue;
    }
    const file = join(dir, `${c.issue.repo.owner}-${c.issue.repo.name}-${c.issue.number}-${c.commentId}-s${c.clause}.md`);
    await Bun.write(file, `<!-- ${label} -->\n${text}\n`);
    out.push({ ref: label, file, error: null });
  }
  return out;
}

async function writeComments(dir: string, comments: readonly Comment[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const c of comments) {
    await Bun.write(join(dir, `${c.createdAt.replace(/[:]/g, "")}-${c.id}.md`), `<!-- ${c.author} · ${c.createdAt} · ${c.url} -->\n${c.body}\n`);
  }
}

export async function fetchAll(ref: Ref, outDir: string | null): Promise<string> {
  const dir = outDir ?? join("/tmp", "ghc", `${ref.repo.owner}-${ref.repo.name}-${ref.number}`);
  await mkdir(dir, { recursive: true });
  const kind = await objectKind(ref);
  let core: IssueData | PrData;
  let extras: Record<string, unknown>;
  const texts: string[] = [];
  if (kind === "Issue") {
    core = await getIssue(ref);
    extras = await issueExtras(ref);
    extras.contractRefs = await expandRefs(core, join(dir, "refs"));
  } else {
    core = await getPr(ref);
    extras = await prExtras(ref);
    const reviews = arr(extras.reviews, "reviews").map((r) => str(field(obj(r, "review"), "body"), "review.body"));
    const threadBodies = arr(extras.reviewThreads, "threads").flatMap((t) =>
      arr(field(obj(field(obj(t, "thread"), "comments"), "comments"), "nodes"), "thread.comments").map((c) => str(field(obj(c, "c"), "body"), "c.body")),
    );
    texts.push(...reviews, ...threadBodies);
  }
  texts.push(core.body, ...core.comments.map((c) => c.body));
  await Bun.write(join(dir, "body.md"), `${core.body}\n`);
  await writeComments(join(dir, "comments"), core.comments);
  extras.attachments = await downloadAttachments(texts, join(dir, "attachments"));
  await Bun.write(join(dir, "payload.json"), `${JSON.stringify({ kind, fetchedAt: new Date().toISOString(), core, ...extras }, null, 2)}\n`);
  return dir;
}
