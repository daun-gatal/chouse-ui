/**
 * build-docs.ts — static-site generator for /docs.
 *
 * Runs after `vite build` (needs dist/assets/main-*.css). Reads the docs
 * manifest + markdown content, validates it, and writes:
 *
 *   dist/docs/index.html               the docs home
 *   dist/docs/<section>/index.html     one hub per manifest section
 *   dist/docs/<slug>/index.html        one directory-URL page per manifest entry
 *   dist/docs/<old-slug>/index.html    redirect stubs for renamed pages
 *   dist/docs/search-index.json        client-side search index
 *   dist/docs-client.js                vanilla progressive enhancement
 *   dist/.docs-pages.json              page list consumed by generate-sitemap.js
 *
 * The build fails on anything that would ship a broken docs site: a manifest
 * page without content (or content without a page), duplicate or colliding
 * slugs, a redirect to nowhere, bad frontmatter, or an internal link/anchor
 * that does not resolve — in the docs or on the landing page.
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { DOC_REDIRECTS, DOC_SECTIONS, DOCS_HOME_PATH, allPages, docPath, sectionPath } from "../src/docs-site/manifest";
import { parseHeadings, resetHeadings, withBase, SITE_URL } from "../src/docs-site/lib";
import { parseBlocks, parseFrontmatter, plainMarkdown, searchChunks, stripLeadingH1 } from "../src/docs-site/content";
import { renderDocPageHtml, renderHomeHtml, renderRedirectHtml, renderSectionHtml } from "../src/docs-site/render";
import type { RenderContext } from "../src/docs-site/render";
import type { PermissionIndex } from "../src/docs-site/components/DocsPage";
import type { ContentBlock, PageFacts } from "../src/docs-site/content";
import type { DocHeading } from "../src/docs-site/lib";
import type { DocEntry } from "../src/docs-site/manifest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "dist");
const CONTENT_DIR = join(ROOT, "src", "content", "docs");
const LANDING_DIR = join(ROOT, "src", "components");
/** Generated from the server by scripts/gen-reference.ts. */
const PERMISSIONS_PATH = join(ROOT, "src", "content", "reference", "permissions.json");

interface LoadedPage {
  entry: DocEntry;
  facts: PageFacts;
  blocks: ContentBlock[];
  markdown: string;
  headings: DocHeading[];
}

function findCssHref(): string {
  const assetsDir = join(DIST, "assets");
  if (!existsSync(assetsDir)) {
    throw new Error("dist/assets not found — run `vite build` before build-docs");
  }
  const css = readdirSync(assetsDir).find((file) => file.startsWith("main-") && file.endsWith(".css"));
  if (!css) {
    throw new Error("main-*.css not found in dist/assets — run `vite build` first");
  }
  return withBase(`/assets/${css}`);
}

/** Slugs, section ids and redirects share one URL namespace under /docs/. */
function validateManifest(): void {
  const errors: string[] = [];
  const taken = new Map<string, string>();
  const claim = (key: string, owner: string): void => {
    const existing = taken.get(key);
    if (existing) errors.push(`/docs/${key}/ is claimed by both ${existing} and ${owner}`);
    else taken.set(key, owner);
  };
  for (const section of DOC_SECTIONS) {
    claim(section.id, `section "${section.label}"`);
    for (const group of section.groups) {
      for (const page of group.pages) claim(page.slug, `page "${page.title}"`);
    }
  }
  for (const [from, to] of Object.entries(DOC_REDIRECTS)) {
    claim(from, `redirect → ${to}`);
    if (!allPages().some((entry) => entry.page.slug === to)) errors.push(`Redirect ${from} → ${to}: target page does not exist`);
  }
  for (const reserved of ["search-index.json"]) {
    if (taken.has(reserved)) errors.push(`/docs/${reserved} is reserved`);
  }

  const manifestSlugs = new Set(allPages().map((entry) => entry.page.slug));
  for (const file of readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md"))) {
    const slug = file.replace(/\.md$/, "");
    if (!manifestSlugs.has(slug)) errors.push(`Orphan content file src/content/docs/${file} — add it to the manifest or delete it`);
  }
  if (errors.length) throw new Error(`Manifest is invalid:\n  - ${errors.join("\n  - ")}`);
}

function loadPage(entry: DocEntry): LoadedPage {
  const mdPath = join(CONTENT_DIR, `${entry.page.slug}.md`);
  if (!existsSync(mdPath)) {
    throw new Error(`Missing content file: ${mdPath} (manifest expects src/content/docs/${entry.page.slug}.md)`);
  }
  try {
    const { facts, body } = parseFrontmatter(readFileSync(mdPath, "utf8"));
    const blocks = parseBlocks(stripLeadingH1(body));
    const markdown = plainMarkdown(blocks);
    resetHeadings();
    const headings = parseHeadings(markdown);
    return { entry, facts, blocks, markdown, headings };
  } catch (error) {
    throw new Error(`${entry.page.slug}.md: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function loadPermissions(): PermissionIndex {
  if (!existsSync(PERMISSIONS_PATH)) {
    throw new Error("src/content/reference/permissions.json is missing — run `bun scripts/gen-reference.ts`");
  }
  return JSON.parse(readFileSync(PERMISSIONS_PATH, "utf8")) as PermissionIndex;
}

/** A page may only claim permissions that exist. */
function checkPermissions(pages: LoadedPage[], permissions: PermissionIndex): void {
  const errors = pages.flatMap((page) =>
    (page.facts.permissions ?? [])
      .filter((p) => !permissions[p])
      .map((p) => `${page.entry.page.slug}.md: unknown permission "${p}" in frontmatter`)
  );
  if (errors.length) throw new Error(`Bad frontmatter:\n  - ${errors.join("\n  - ")}`);
}

/** Every anchor a /docs/ URL can carry, keyed by the slug or section id. */
function anchorTable(pages: LoadedPage[]): Map<string, Set<string>> {
  const table = new Map<string, Set<string>>();
  table.set("", new Set());
  for (const page of pages) table.set(page.entry.page.slug, new Set(page.headings.map((h) => h.id)));
  for (const section of DOC_SECTIONS) table.set(section.id, new Set(section.groups.map((g) => g.id)));
  return table;
}

/** Check internal /docs/ links (with anchors) in docs content and the landing page. */
function checkLinks(pages: LoadedPage[]): void {
  const anchors = anchorTable(pages);
  const errors: string[] = [];

  const check = (source: string, href: string): void => {
    const match = /^\/docs\/(?:([a-z0-9-]+)\/)?(?:#([a-z0-9_-]+))?$/.exec(href);
    if (!match) {
      errors.push(`${source}: malformed docs link "${href}" (expected /docs/<slug>/ or /docs/<slug>/#anchor)`);
      return;
    }
    const [, key = "", anchor] = match;
    if (DOC_REDIRECTS[key]) {
      errors.push(`${source}: "${href}" points at a renamed page — use /docs/${DOC_REDIRECTS[key]}/`);
      return;
    }
    const known = anchors.get(key);
    if (!known) errors.push(`${source}: "${href}" — no such docs page`);
    else if (anchor && !known.has(anchor)) errors.push(`${source}: "${href}" — no heading #${anchor} on that page`);
  };

  for (const page of pages) {
    const source = `${page.entry.page.slug}.md`;
    for (const match of page.markdown.matchAll(/\]\((\/docs\/[^)\s]*)\)/g)) check(source, match[1]);
    for (const match of page.markdown.matchAll(/\]\((#[^)\s]*)\)/g)) check(source, `/docs/${page.entry.page.slug}/${match[1]}`);
  }
  for (const file of readdirSync(LANDING_DIR).filter((f) => f.endsWith(".tsx"))) {
    const source = `src/components/${file}`;
    for (const match of readFileSync(join(LANDING_DIR, file), "utf8").matchAll(/["'`](\/docs\/[^"'`\s]*)["'`]/g)) {
      check(source, match[1]);
    }
  }
  if (errors.length) throw new Error(`Broken docs links:\n  - ${errors.join("\n  - ")}`);
}

/**
 * Search index: one entry per page plus one chunk per heading so results
 * deep-link to the matching section. Short keys keep the payload small.
 */
function buildSearchIndex(pages: LoadedPage[]): object {
  return {
    pages: pages.map(({ entry, facts }) => ({
      s: entry.page.slug,
      t: entry.page.title,
      d: entry.page.description,
      g: [entry.section.label, entry.group.label].filter(Boolean).join(" › "),
      ...(facts.app ? { a: facts.app } : {}),
      ...(facts.permissions ? { p: facts.permissions } : {}),
    })),
    chunks: pages.flatMap((page, i) =>
      searchChunks(page.markdown, page.headings).map((chunk) => ({ p: i, a: chunk.anchor, h: chunk.heading, x: chunk.text }))
    ),
  };
}

function writePage(urlPath: string, html: string): void {
  const dir = join(DIST, ...urlPath.split("/").filter(Boolean));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html, "utf8");
}

function main(): void {
  if (!existsSync(DIST)) {
    throw new Error("dist/ not found — run `vite build` before build-docs");
  }
  const ctx: RenderContext = {
    cssHref: findCssHref(),
    clientSrc: withBase("/docs-client.js"),
  };

  validateManifest();
  const pages = allPages().map(loadPage);
  const permissions = loadPermissions();
  checkPermissions(pages, permissions);
  checkLinks(pages);

  const generated: Array<{ url: string; title: string }> = [];

  writePage(DOCS_HOME_PATH, renderHomeHtml(ctx));
  generated.push({ url: `${SITE_URL}${withBase(DOCS_HOME_PATH)}`, title: "Documentation" });

  for (const section of DOC_SECTIONS) {
    writePage(sectionPath(section.id), renderSectionHtml(section, ctx));
    generated.push({ url: `${SITE_URL}${withBase(sectionPath(section.id))}`, title: section.label });
  }

  for (const page of pages) {
    // The Markdown component re-allocates heading ids in document order, so
    // reset before rendering to match the ids parsed for the TOC.
    resetHeadings();
    const html = renderDocPageHtml(page, permissions, ctx);
    writePage(docPath(page.entry.page.slug), html);
    generated.push({ url: `${SITE_URL}${withBase(docPath(page.entry.page.slug))}`, title: page.entry.page.title });
    console.log(`✓ ${docPath(page.entry.page.slug)} (${page.headings.length} headings)`);
  }

  for (const [from, to] of Object.entries(DOC_REDIRECTS)) {
    writePage(docPath(from), renderRedirectHtml(to));
    console.log(`↪ ${docPath(from)} → ${docPath(to)}`);
  }

  writeFileSync(join(DIST, "docs", "search-index.json"), JSON.stringify(buildSearchIndex(pages)), "utf8");

  // Client enhancement script + sitemap page list.
  const clientSrc = join(ROOT, "src", "docs-site", "docs-client.js");
  writeFileSync(join(DIST, "docs-client.js"), readFileSync(clientSrc, "utf8"), "utf8");
  writeFileSync(join(DIST, ".docs-pages.json"), JSON.stringify(generated, null, 2), "utf8");

  console.log(
    `\n✓ build-docs complete — ${pages.length} pages, ${DOC_SECTIONS.length} hubs, ${Object.keys(DOC_REDIRECTS).length} redirects, css: ${ctx.cssHref}`
  );
}

try {
  main();
} catch (error) {
  console.error(`✗ build-docs failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
