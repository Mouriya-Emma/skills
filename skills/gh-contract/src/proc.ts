// Process boundary: every external program (gh, git, shell commands) runs through here.

export type ProcResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

export class UsageError extends Error {}
export class EnvError extends Error {}

export async function run(
  argv: readonly string[],
  opts: { cwd?: string; stdin?: string; env?: Record<string, string> } = {},
): Promise<ProcResult> {
  const proc = Bun.spawn([...argv], {
    cwd: opts.cwd,
    stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: opts.env === undefined ? process.env : { ...process.env, ...opts.env },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

export async function runOk(argv: readonly string[], opts: { cwd?: string; stdin?: string } = {}): Promise<string> {
  const r = await run(argv, opts);
  if (r.code !== 0) {
    throw new EnvError(`${argv.slice(0, 3).join(" ")} failed (exit ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  }
  return r.stdout;
}

export async function ghJson(args: readonly string[], stdin?: string): Promise<unknown> {
  const out = await runOk(["gh", ...args], { stdin });
  return out.trim() === "" ? null : (JSON.parse(out) as unknown);
}

export async function graphql(query: string, variables: Record<string, string | number | null>): Promise<unknown> {
  const body = JSON.stringify({ query, variables });
  const out = await runOk(["gh", "api", "graphql", "--input", "-"], { stdin: body });
  const parsed = JSON.parse(out) as { data?: unknown; errors?: { message: string }[] };
  if (parsed.errors !== undefined && parsed.errors.length > 0) {
    throw new EnvError(`GraphQL: ${parsed.errors.map((e) => e.message).join("; ")}`);
  }
  return parsed.data;
}
