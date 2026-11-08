import type { ReactNode } from "react";

/**
 * Resolve the deploy base path. Vite only replaces the literal text
 * `import.meta.env`, so it must be written out here (reading it through an
 * alias left it undefined in the browser, and every link fell back to "/").
 * Vite sets BASE_URL from `base` (VITE_BASE_PATH); bun SSG falls back to process.env.
 */
export function getBase(): string {
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
  const fromVite = env.VITE_BASE_PATH || (env.BASE_URL && env.BASE_URL !== "/" ? env.BASE_URL : undefined);
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

/**
 * Resolve a link for the current deploy: root-absolute paths ("/docs/…", "/")
 * get the base path; anchors, relative paths, full URLs and paths that already
 * carry the base are returned unchanged.
 */
export function resolveHref(href: string): string;
export function resolveHref(href: string | undefined): string | undefined;
export function resolveHref(href: string | undefined): string | undefined {
  if (!href || !href.startsWith("/") || href.startsWith("//")) return href;
  const base = getBase().replace(/\/$/, "");
  if (base && (href === base || href.startsWith(`${base}/`))) return href;
  return withBase(href);
}

/** Site URL used for canonical/OG/sitemap. */
export const SITE_URL = "https://chouse-ui.com";

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*~[\]()#]/g, "")
    .replace(/[^a-z0-9_\s-]/g, "")
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
      // Drop _emphasis_ markers: the rendered heading has none, and its id
      // must match this one now that slugs keep underscores (tool names).
      const text = match[2].trim().replace(/(^|[^\w])_([^_]+)_(?=[^\w]|$)/g, "$1$2");
      headings.push({ id: headingId(text), text, level });
    }
  }
  return headings;
}
