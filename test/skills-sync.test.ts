import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const SCRIPT = join(REPO, "bin", "skills-sync");
const AGY_RULE_LIMIT = 24000;
const AGY_SKILL_LIMIT = 24000;
const AGY_SECTIONS = ["common", "app", "cli", "acp"] as const;
type AgySection = (typeof AGY_SECTIONS)[number];
type Run = { readonly code: number; readonly out: string };
type RepoSkill = { readonly layer: string; readonly name: string };

const removeTree = (dir: string): void => {
  if (process.platform === "darwin") Bun.spawnSync(["chflags", "-R", "nouchg", dir]);
  rmSync(dir, { recursive: true, force: true });
};

const writeTree = (root: string, path: string, text: string): void => {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

const sync = (repo: string, home: string): Run => {
  const result = Bun.spawnSync([process.execPath, SCRIPT, "--home", home, "--repo", repo, "--no-pull"]);
  return { code: result.exitCode, out: `${result.stdout.toString()}${result.stderr.toString()}` };
};

const expectOk = (run: Run): void => {
  if (run.code !== 0) throw new Error(`skills-sync exited ${run.code}\n${run.out}`);
};

const linkedNames = (dir: string): readonly string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => lstatSync(join(dir, name)).isSymbolicLink())
        .sort()
    : [];

const manifestLines = (file: string): readonly string[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

const agyManifest = (file: string): ReadonlyMap<AgySection, readonly string[]> => {
  const sections = new Map<AgySection, string[]>(AGY_SECTIONS.map((section) => [section, []]));
  let current: string[] | undefined;
  for (const line of manifestLines(file)) {
    const header = /^\[(.+)\]$/.exec(line);
    if (header === null) {
      current?.push(line);
      continue;
    }
    const section = AGY_SECTIONS.find((name) => name === header[1]);
    if (section === undefined) throw new Error(`${file}: unexpected section ${line}`);
    current = sections.get(section);
  }
  return sections;
};

const frontmatterName = (file: string): unknown => {
  const text = readFileSync(file, "utf8");
  const end = text.indexOf("\n---\n", 3);
  if (!text.startsWith("---\n") || end < 0) return undefined;
  const fm: unknown = Bun.YAML.parse(text.slice(4, end));
  return typeof fm === "object" && fm !== null && "name" in fm ? fm.name : undefined;
};

describe("repository", () => {
  const omp = manifestLines(join(REPO, "harness", "omp", "manifest"));
  const claude = manifestLines(join(REPO, "harness", "claude", "manifest"));
  const agy = agyManifest(join(REPO, "harness", "agy", "manifest"));
  const everyManifest = [...omp, ...claude, ...[...agy.values()].flat()];
  const repoSkills: readonly RepoSkill[] = readdirSync(join(REPO, "skills"), { withFileTypes: true })
    .filter((layer) => layer.isDirectory())
    .flatMap((layer) =>
      readdirSync(join(REPO, "skills", layer.name))
        .filter((name) => existsSync(join(REPO, "skills", layer.name, name, "SKILL.md")))
        .map((name) => ({ layer: layer.name, name })),
    );
  const repoNames = new Set(repoSkills.map((skill) => skill.name));
  const thirdParty = [...new Set(everyManifest)].filter((name) => !repoNames.has(name));
  const skillDirs: Readonly<Record<"omp" | "claude" | AgySection, string>> = {
    omp: join(".local", "state", "agent-skills", "omp", "skills"),
    claude: join(".claude", "skills"),
    common: join(".gemini", "config", "plugins", "agent-skills", "skills"),
    app: join(".gemini", "antigravity", "skills"),
    cli: join(".gemini", "antigravity-cli", "skills"),
    acp: join(".gemini", "antigravity-acp", "skills"),
  };
  const exposure = (layer: string): readonly string[] | undefined => {
    if (layer === "shared") return everyManifest;
    if (layer === "omp") return omp;
    if (layer === "claude") return claude;
    if (layer === "agy") return [...agy.values()].flat();
    const section = AGY_SECTIONS.find((name) => `agy-${name}` === layer);
    return section === undefined ? undefined : agy.get(section);
  };

  let home = "";
  let run: Run = { code: -1, out: "" };

  beforeAll(() => {
    home = mkdtempSync("/tmp/skills-sync-home-");
    for (const name of thirdParty) {
      writeTree(home, join(".agents", "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: stub\n---\n`);
    }
    run = sync(REPO, home);
  });

  afterAll(() => removeTree(home));

  test("rules and manifests validate and sync succeeds", () => expectOk(run));

  test("each harness exposes exactly the skills its manifest lists", () => {
    expectOk(run);
    const expected: Readonly<Record<keyof typeof skillDirs, readonly string[]>> = {
      omp,
      claude,
      common: agy.get("common") ?? [],
      app: agy.get("app") ?? [],
      cli: agy.get("cli") ?? [],
      acp: agy.get("acp") ?? [],
    };
    for (const [key, dir] of Object.entries(skillDirs) as [keyof typeof skillDirs, string][]) {
      expect({ harness: key, skills: linkedNames(join(home, dir)) }).toEqual({
        harness: key,
        skills: [...expected[key]].sort(),
      });
    }
  });

  test("repository skills link into the repository", () => {
    expectOk(run);
    for (const dir of Object.values(skillDirs)) {
      for (const name of linkedNames(join(home, dir)).filter((n) => repoNames.has(n))) {
        expect(resolve(join(home, dir), readlinkSync(join(home, dir, name)))).toStartWith(join(REPO, "skills") + "/");
      }
    }
  });

  test("every repository skill is listed in a manifest of its layer", () => {
    for (const skill of repoSkills) {
      const listed = exposure(skill.layer);
      expect({ ...skill, known: listed !== undefined }).toEqual({ ...skill, known: true });
      expect({ ...skill, listed: listed?.includes(skill.name) }).toEqual({ ...skill, listed: true });
    }
  });

  test("every repository skill declares its directory name", () => {
    for (const skill of repoSkills) {
      const file = join(REPO, "skills", skill.layer, skill.name, "SKILL.md");
      expect({ file, name: frontmatterName(file) }).toEqual({ file, name: skill.name });
    }
  });

  test("generated AGY rules stay within the 24 KB limit", () => {
    expectOk(run);
    const dir = join(home, ".gemini", "config", "plugins", "agent-skills", "rules");
    const sizes = readdirSync(dir).map((name) => ({ name, bytes: Buffer.byteLength(readFileSync(join(dir, name))) }));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size.bytes).toBeLessThanOrEqual(AGY_RULE_LIMIT);
  });
});

describe("skills-sync", () => {
  const scratch: string[] = [];
  const scratchDir = (label: string): string => {
    const dir = mkdtempSync(`/tmp/skills-sync-${label}-`);
    scratch.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of scratch.splice(0)) removeTree(dir);
  });

  const fixtureRepo = (files: Readonly<Record<string, string>> = {}): string => {
    const repo = scratchDir("repo");
    writeTree(repo, "harness/omp/manifest", "alpha\n");
    writeTree(repo, "harness/claude/manifest", "alpha\n");
    writeTree(repo, "harness/agy/manifest", "[common]\nalpha\n");
    writeTree(repo, "harness/agy/plugin.json", JSON.stringify({ name: "agent-skills" }));
    writeTree(repo, "skills/shared/alpha/SKILL.md", "---\nname: alpha\ndescription: fixture\n---\n");
    for (const [path, text] of Object.entries(files)) writeTree(repo, path, text);
    return repo;
  };

  const AGY_HEADER = "---\ntrigger: always_on\n---\n";

  test.each([
    { bytes: AGY_RULE_LIMIT, code: 0 },
    { bytes: AGY_RULE_LIMIT + 1, code: 1 },
  ])("an always-on rule rendering to $bytes AGY bytes exits $code", ({ bytes, code }) => {
    const body = "x".repeat(bytes - Buffer.byteLength(AGY_HEADER));
    const repo = fixtureRepo({ "rules/shared/big.md": `---\nalwaysApply: true\n---\n${body}` });
    const home = scratchDir("home");
    const run = sync(repo, home);
    expect(run.code).toBe(code);
    if (code === 0) {
      const rendered = join(home, ".gemini", "config", "plugins", "agent-skills", "rules", "big.md");
      expect(Buffer.byteLength(readFileSync(rendered))).toBe(bytes);
    } else {
      expect(run.out).toContain(`over the ${AGY_RULE_LIMIT}-byte limit`);
      expect(readdirSync(home)).toEqual([]);
    }
  });

  const SKILL_HEADER = "---\nname: alpha\ndescription: fixture\n---\n";

  test.each([
    { bytes: AGY_SKILL_LIMIT, code: 0 },
    { bytes: AGY_SKILL_LIMIT + 1, code: 1 },
  ])("a repository skill exposed to AGY with a $bytes-byte body exits $code", ({ bytes, code }) => {
    const repo = fixtureRepo({ "skills/shared/alpha/SKILL.md": `${SKILL_HEADER}\n${"x".repeat(bytes)}\n` });
    const home = scratchDir("home");
    const run = sync(repo, home);
    expect(run.code).toBe(code);
    if (code === 1) {
      expect(run.out).toContain(`body is ${bytes} bytes; AGY truncates skill bodies past ${AGY_SKILL_LIMIT} bytes`);
      expect(readdirSync(home)).toEqual([]);
    }
  });

  test("an oversized third-party skill is still linked for AGY and reported as a warning", () => {
    const repo = fixtureRepo({ "harness/agy/manifest": "[common]\nalpha\nbig\n" });
    const home = scratchDir("home");
    writeTree(home, ".agents/skills/big/SKILL.md", `---\nname: big\ndescription: vendor\n---\n${"x".repeat(AGY_SKILL_LIMIT + 1)}`);
    const run = sync(repo, home);
    expectOk(run);
    expect(run.out).toContain(`skills-sync: warning: ${join(home, ".agents", "skills", "big")}/SKILL.md: body is ${AGY_SKILL_LIMIT + 1} bytes`);
    expect(readlinkSync(join(home, ".gemini", "config", "plugins", "agent-skills", "skills", "big"))).toBe(
      join(home, ".agents", "skills", "big"),
    );
  });

  test("home-anchored and relative paths of one place render to a single AGY glob", () => {
    const repo = fixtureRepo({
      "rules/shared/scoped.md": '---\npaths:\n  - "~/.foo/**"\n  - ".foo/**"\n  - "/**/bar/**"\n---\nbody\n',
    });
    const home = scratchDir("home");
    expectOk(sync(repo, home));
    const rendered = readFileSync(join(home, ".gemini", "config", "plugins", "agent-skills", "rules", "scoped.md"), "utf8");
    expect(rendered).toContain('globs: "**/.foo/**,**/bar/**"');
  });

  test("a manifest skill that resolves nowhere fails without writing anything", () => {
    const repo = fixtureRepo({ "harness/claude/manifest": "alpha\nmissing\n" });
    const home = scratchDir("home");
    const run = sync(repo, home);
    expect(run.code).toBe(1);
    expect(run.out).toContain("skill missing not found");
    expect(readdirSync(home)).toEqual([]);
  });

  test("foreign entries survive while stale managed links are removed", () => {
    const repo = fixtureRepo();
    const home = scratchDir("home");
    const vendor = scratchDir("vendor");
    const skills = join(home, ".claude", "skills");
    mkdirSync(join(skills, "real-dir"), { recursive: true });
    symlinkSync(vendor, join(skills, "vendor"));
    symlinkSync(join(repo, "skills", "shared", "retired"), join(skills, "retired"));
    expectOk(sync(repo, home));
    expect(lstatSync(join(skills, "real-dir")).isDirectory()).toBe(true);
    expect(readlinkSync(join(skills, "vendor"))).toBe(vendor);
    expect(lstatSync(join(skills, "retired"), { throwIfNoEntry: false })).toBeUndefined();
    expect(readlinkSync(join(skills, "alpha"))).toBe(join(repo, "skills", "shared", "alpha"));
  });

  test.skipIf(process.platform !== "darwin")("a uchg-locked skill directory is refused and nothing is written", () => {
    const repo = fixtureRepo();
    const home = scratchDir("home");
    const skills = join(home, ".claude", "skills");
    mkdirSync(skills, { recursive: true });
    expect(Bun.spawnSync(["chflags", "uchg", skills]).exitCode).toBe(0);
    const run = sync(repo, home);
    expect(run.code).toBe(1);
    expect(run.out).toContain("uchg-locked");
    expect(readdirSync(home)).toEqual([".claude"]);
    expect(readdirSync(skills)).toEqual([]);
  });
});
