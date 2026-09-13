/**
 * build-docs.ts — static-site generator for /docs.
 *
 * Runs after `vite build` (needs dist/assets/main-*.css). Reads the docs
 * manifest + markdown content, renders every page to static HTML with full
 * per-page SEO head (title/description/canonical/OG/JSON-LD), and writes:
 *
 *   dist/docs/<slug>/index.html   one directory-URL page per manifest entry
 *   dist/docs-client.js           vanilla progressive enhancement
 *   dist/.docs-pages.json         page list consumed by generate-sitemap.js
 *
 * The legacy public/docs/index.html (served at /docs/) is NOT touched.
 */

import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { allPages } from "../src/docs-site/manifest";
import { parseHeadings, resetHeadings, withBase, SITE_URL } from "../src/docs-site/lib";
import { renderDocPageHtml } from "../src/docs-site/render";
import type { RenderContext } from "../src/docs-site/render";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const DIST = join(ROOT, "dist");
const CONTENT_DIR = join(ROOT, "src", "content", "docs");

/** Remove a leading `# Title` line so the H1 comes from the manifest only. */
function stripLeadingH1(markdown: string): string {
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i < lines.length && /^#\s+/.test(lines[i])) {
    lines.splice(0, i + 1);
    return lines.join("\n").replace(/^\s*\n+/, "");
  }
  return markdown.trim();
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

function main(): void {
  if (!existsSync(DIST)) {
    throw new Error("dist/ not found — run `vite build` before build-docs");
  }
  const ctx: RenderContext = {
    cssHref: findCssHref(),
    clientSrc: withBase("/docs-client.js"),
  };

  const generated: Array<{ url: string; title: string }> = [];

  for (const { group, page, index } of allPages()) {
    const path = withBase(`/docs/${page.slug}/`);
    const mdPath = join(CONTENT_DIR, `${page.slug}.md`);
    if (!existsSync(mdPath)) {
      throw new Error(`Missing content file: ${mdPath} (manifest expects src/content/docs/${page.slug}.md)`);
    }
    const raw = readFileSync(mdPath, "utf8");
    const markdown = stripLeadingH1(raw);

    // Pass 1 — allocate heading ids for the TOC (fence-aware, collision-safe).
    resetHeadings();
    const headings = parseHeadings(markdown);

    // Pass 2 — render; the Markdown component re-allocates the same ids in the
    // same order, so anchors match the TOC exactly.
    resetHeadings();
    const html = renderDocPageHtml(
      {
        title: page.title,
        description: page.description,
        groupLabel: group.label,
        index,
        slug: page.slug,
        markdown,
        headings,
      },
      path,
      ctx
    );

    mkdirSync(join(DIST, "docs", page.slug), { recursive: true });
    writeFileSync(join(DIST, "docs", page.slug, "index.html"), html, "utf8");
    generated.push({ url: `${SITE_URL}${path}`, title: page.title });
    console.log(`✓ ${path} (${headings.length} headings)`);
  }

  // Client enhancement script + sitemap page list.
  const clientSrc = join(ROOT, "src", "docs-site", "docs-client.js");
  writeFileSync(join(DIST, "docs-client.js"), readFileSync(clientSrc, "utf8"), "utf8");
  writeFileSync(join(DIST, ".docs-pages.json"), JSON.stringify(generated, null, 2), "utf8");

  console.log(`\n✓ build-docs complete — ${generated.length} pages, css: ${ctx.cssHref}`);
}

try {
  main();
} catch (error) {
  console.error(`✗ build-docs failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
