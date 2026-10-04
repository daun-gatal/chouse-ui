/**
 * Docs content parsing — shared by the SSG build, the search index and the
 * link checker so all three read a page the same way.
 *
 * A content file is optional frontmatter, then markdown with two block
 * directives that plain markdown cannot express:
 *
 *   {{diagram:architecture}}        a registered diagram component
 *
 *   :::tabs                         tabbed alternatives (Docker / Helm / YAML …)
 *   @tab Docker
 *   ```bash … ```
 *   @tab Helm
 *   ```bash … ```
 *   :::
 */

import type { DocHeading } from "./lib";

/** Facts shown under a page's lead: where it lives in the app and who can open it. */
export interface PageFacts {
  /** Menu path in the app, e.g. "Data › Lineage". */
  app?: string;
  /** App route, e.g. "/data/lineage". */
  route?: string;
  /** Permissions that open the screen; holding any one is enough. */
  permissions?: string[];
  /** Minimum ClickHouse version, e.g. "23.8". */
  clickhouse?: string;
  /** Set by scripts/gen-reference.ts on generated pages: what the page is generated from. */
  generated?: string;
  /** A capture from scripts/docs-screenshots.sh: public/docs/img/app/<name>.jpg. */
  screenshot?: string;
}

export type ContentBlock =
  | { kind: "markdown"; text: string }
  | { kind: "diagram"; name: string }
  | { kind: "tabs"; tabs: Array<{ label: string; markdown: string }> };

export interface SearchChunk {
  /** Heading id within the page; empty for the text before the first heading. */
  anchor: string;
  heading: string;
  text: string;
}

const FACT_KEYS = new Set(["app", "route", "permissions", "clickhouse", "generated", "screenshot"]);
const PERMISSION_RE = /^[a-z_]+(:[a-z_]+)+$/;
const FENCE_RE = /^\s*(```|~~~)/;

class ContentError extends Error {}

/** Split `---` frontmatter off the top of a file. Only flat `key: value` lines are allowed. */
export function parseFrontmatter(raw: string): { facts: PageFacts; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { facts: {}, body: raw };
  const facts: PageFacts = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const kv = /^([a-z]+):\s*(.+)$/.exec(line.trim());
    if (!kv) throw new ContentError(`Bad frontmatter line: "${line}"`);
    const [, key, value] = kv;
    if (!FACT_KEYS.has(key)) throw new ContentError(`Unknown frontmatter key "${key}" (allowed: ${[...FACT_KEYS].join(", ")})`);
    if (key === "permissions") {
      const permissions = value.split(",").map((p) => p.trim()).filter(Boolean);
      const bad = permissions.find((p) => !PERMISSION_RE.test(p));
      if (bad) throw new ContentError(`Bad permission "${bad}" in frontmatter`);
      facts.permissions = permissions;
    } else if (key === "route") {
      if (!value.startsWith("/")) throw new ContentError(`route must start with "/": ${value}`);
      facts.route = value;
    } else if (key === "app") {
      facts.app = value;
    } else if (key === "generated") {
      facts.generated = value;
    } else if (key === "screenshot") {
      if (!/^[a-z0-9-]+$/.test(value)) throw new ContentError(`screenshot must be a file name without extension: ${value}`);
      facts.screenshot = value;
    } else {
      facts.clickhouse = value;
    }
  }
  return { facts, body: raw.slice(match[0].length) };
}

/** Remove a leading `# Title` line so the H1 comes from the manifest only. */
export function stripLeadingH1(markdown: string): string {
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i < lines.length && /^#\s+/.test(lines[i])) {
    lines.splice(0, i + 1);
    return lines.join("\n").replace(/^\s*\n+/, "");
  }
  return markdown.trim();
}

/** Split markdown into plain segments and directive blocks (fence-aware). */
export function parseBlocks(markdown: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let buffer: string[] = [];
  let inFence = false;
  let tabs: Array<{ label: string; lines: string[] }> | null = null;

  const flush = (): void => {
    const text = buffer.join("\n");
    if (text.trim() !== "") blocks.push({ kind: "markdown", text });
    buffer = [];
  };

  for (const line of markdown.split("\n")) {
    if (FENCE_RE.test(line)) inFence = !inFence;
    const target = tabs ? tabs[tabs.length - 1]?.lines : buffer;

    if (!inFence && !FENCE_RE.test(line)) {
      const trimmed = line.trim();
      const diagram = /^\{\{diagram:([a-z-]+)\}\}$/.exec(trimmed);
      if (diagram && !tabs) {
        flush();
        blocks.push({ kind: "diagram", name: diagram[1] });
        continue;
      }
      if (trimmed === ":::tabs") {
        if (tabs) throw new ContentError("Nested :::tabs is not supported");
        flush();
        tabs = [];
        continue;
      }
      if (tabs && /^@tab\s+/.test(trimmed)) {
        tabs.push({ label: trimmed.replace(/^@tab\s+/, ""), lines: [] });
        continue;
      }
      if (tabs && trimmed === ":::") {
        if (tabs.length < 2) throw new ContentError(":::tabs needs at least two @tab sections");
        blocks.push({ kind: "tabs", tabs: tabs.map((t) => ({ label: t.label, markdown: t.lines.join("\n") })) });
        tabs = null;
        continue;
      }
    }

    if (!target) {
      if (line.trim() === "") continue;
      throw new ContentError(`Content inside :::tabs before the first @tab: "${line}"`);
    }
    target.push(line);
  }
  if (tabs) throw new ContentError("Unclosed :::tabs block");
  if (inFence) throw new ContentError("Unclosed code fence");
  flush();
  return blocks;
}

/** Markdown with directives removed — what headings, links and search read. */
export function plainMarkdown(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === "markdown") return block.text;
      if (block.kind === "tabs") return block.tabs.map((t) => t.markdown).join("\n\n");
      return "";
    })
    .join("\n\n");
}

/** Strip markdown syntax down to searchable text. */
function toText(markdown: string): string {
  return markdown
    .replace(/^\s*(```|~~~).*$/gm, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, " ")
    .replace(/[|*_`>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cut a page into one search chunk per heading so results deep-link to the
 * section that matched. `headings` must come from parseHeadings over the same
 * markdown, which keeps the anchors identical to the rendered ids.
 */
export function searchChunks(markdown: string, headings: DocHeading[]): SearchChunk[] {
  const chunks: SearchChunk[] = [];
  let current: SearchChunk = { anchor: "", heading: "", text: "" };
  const lines: string[] = [];
  let headingIndex = 0;
  let inFence = false;

  const close = (): void => {
    current.text = toText(lines.join("\n"));
    if (current.text !== "" || current.anchor !== "") chunks.push(current);
    lines.length = 0;
  };

  for (const line of markdown.split("\n")) {
    if (FENCE_RE.test(line)) inFence = !inFence;
    if (!inFence && /^#{2,3}\s+/.test(line) && headingIndex < headings.length) {
      close();
      const heading = headings[headingIndex++];
      current = { anchor: heading.id, heading: heading.text, text: "" };
      continue;
    }
    lines.push(line);
  }
  close();
  return chunks;
}
