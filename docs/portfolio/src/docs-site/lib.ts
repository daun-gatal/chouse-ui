import type { ReactNode } from "react";

/** Resolve the deploy base path. Vite replaces import.meta.env at client build; bun SSG falls back to process.env. */
export function getBase(): string {
  const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
  const fromVite = meta?.env?.VITE_BASE_PATH;
  const fromProcess = typeof process !== "undefined" ? process.env?.VITE_BASE_PATH : undefined;
  const base = fromVite || fromProcess || "/";
  return base.endsWith("/") && base !== "/" ? base.replace(/\/$/, "") : base || "/";
}

/** Prefix a root-absolute path with the deploy base ("/" by default). */
export function withBase(path: string): string {
  const base = getBase().replace(/\/$/, "");
  if (!path.startsWith("/")) return `${base}/${path}`;
  return base === "/" ? path : `${base}${path}`;
}

/** Site URL used for canonical/OG/sitemap. */
export const SITE_URL = "https://chouse-ui.com";

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]()#]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Heading id allocator. The build script parses headings for the TOC and then
 * renders the page — both passes call headingId() in document order with a
 * reset between, so ids stay consistent.
 */
let usedIds = new Map<string, number>();

export function resetHeadings(): void {
  usedIds = new Map();
}

export function headingId(text: string): string {
  const base = slugify(text) || "section";
  const n = (usedIds.get(base) ?? 0) + 1;
  usedIds.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

/** Flatten arbitrary React children into plain text (for slug/label extraction). */
export function nodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (typeof node === "object" && "props" in node) {
    const element = node as { props: { children?: ReactNode } };
    return nodeText(element.props.children);
  }
  return "";
}

export interface DocHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

/** Parse ##/### headings outside fenced code blocks (TOC source of truth). */
export function parseHeadings(markdown: string): DocHeading[] {
  const headings: DocHeading[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      const level = match[1].length as 2 | 3;
      const text = match[2].trim();
      headings.push({ id: headingId(text), text, level });
    }
  }
  return headings;
}
