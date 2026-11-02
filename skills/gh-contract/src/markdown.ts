// Markdown structure needed by the contracts: `##` sections, top-level bullets, pipe tables, links, heading slugs.
// Lines inside fenced code blocks never count as structure.

export type Line = { readonly n: number; readonly text: string };
export type Section = { readonly title: string; readonly line: number; readonly lines: readonly Line[] };
export type Doc = { readonly preamble: readonly Line[]; readonly sections: readonly Section[] };

const FENCE = /^\s*(```|~~~)/;

/** Lines with fenced-code membership resolved. */
export function structuralLines(text: string): { line: Line; inFence: boolean }[] {
  const out: { line: Line; inFence: boolean }[] = [];
  let fence: string | null = null;
  text.split(/\r?\n/).forEach((t, i) => {
    const m = FENCE.exec(t);
    if (m !== null) {
      const marker = m[1] as string;
      if (fence === null) fence = marker;
      else if (fence === marker) {
        out.push({ line: { n: i + 1, text: t }, inFence: true });
        fence = null;
        return;
      }
      out.push({ line: { n: i + 1, text: t }, inFence: true });
      return;
    }
    out.push({ line: { n: i + 1, text: t }, inFence: fence !== null });
  });
  return out;
}

export function parseDoc(text: string): Doc {
  const preamble: Line[] = [];
  const sections: { title: string; line: number; lines: Line[] }[] = [];
  for (const { line, inFence } of structuralLines(text)) {
    const h = inFence ? null : /^##\s+(.+?)\s*#*\s*$/.exec(line.text);
    if (h !== null && !line.text.startsWith("###")) {
      sections.push({ title: (h[1] as string).trim(), line: line.n, lines: [] });
      continue;
    }
    const cur = sections.at(-1);
    if (cur === undefined) preamble.push(line);
    else cur.lines.push(line);
  }
  return { preamble, sections };
}

export const findSection = (doc: Doc, title: string): Section | undefined =>
  doc.sections.find((s) => s.title === title);

export function nonEmpty(lines: readonly Line[]): Line[] {
  return lines.filter((l) => l.text.trim() !== "");
}

/** Top-level `- ` / `* ` bullets with their text (continuation lines are not merged). */
export function bullets(lines: readonly Line[]): Line[] {
  const out: Line[] = [];
  for (const l of lines) {
    const m = /^[-*]\s+(.*)$/.exec(l.text);
    if (m !== null) out.push({ n: l.n, text: (m[1] as string).trim() });
  }
  return out;
}

/** Split a pipe-table row into cells, honouring `\|` and backtick spans. */
export function splitRow(row: string): string[] {
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "`") {
      inCode = !inCode;
      cur += c;
    } else if (c === "|" && !inCode) {
      cells.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

export type Table = { readonly header: readonly string[]; readonly headerLine: number; readonly rows: readonly { n: number; cells: string[] }[] };

/** First pipe table in the lines, or null. */
export function firstTable(lines: readonly Line[]): Table | null {
  for (let i = 0; i + 1 < lines.length; i++) {
    const head = lines[i] as Line;
    const sep = lines[i + 1] as Line;
    if (!head.text.trim().startsWith("|") || !/^\s*\|?\s*:?-{2,}/.test(sep.text)) continue;
    const rows: { n: number; cells: string[] }[] = [];
    for (let j = i + 2; j < lines.length; j++) {
      const l = lines[j] as Line;
      if (!l.text.trim().startsWith("|")) break;
      rows.push({ n: l.n, cells: splitRow(l.text) });
    }
    return { header: splitRow(head.text), headerLine: head.n, rows };
  }
  return null;
}

/** GitHub heading anchor slugs for a document, with duplicate suffixes. */
export function headingSlugs(text: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  for (const { line, inFence } of structuralLines(text)) {
    if (inFence) continue;
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line.text);
    if (m === null) continue;
    const base = slug(m[1] as string);
    const k = seen.get(base) ?? 0;
    out.add(k === 0 ? base : `${base}-${k}`);
    seen.set(base, k + 1);
  }
  return out;
}

export function slug(heading: string): string {
  return heading
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, (c) => (c === "_" ? "_" : ""))
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

export type Link = { readonly n: number; readonly target: string };

/** Inline link and image targets outside code. */
export function links(text: string): Link[] {
  const out: Link[] = [];
  for (const { line, inFence } of structuralLines(text)) {
    if (inFence) continue;
    const noCode = line.text.replace(/`[^`]*`/g, "");
    for (const m of noCode.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      out.push({ n: line.n, target: m[1] as string });
    }
  }
  return out;
}
