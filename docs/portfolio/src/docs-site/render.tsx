import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentType } from "react";
import { DocsPage } from "./components/DocsPage";
import { DocsHome, DocsSectionHub } from "./components/DocsHub";
import { ArchitectureDiagram } from "./components/ArchitectureDiagram";
import { DOCS_HOME_PATH, docPath, sectionPath } from "./manifest";
import { SITE_URL, withBase } from "./lib";
import type { PermissionIndex } from "./components/DocsPage";
import type { ContentBlock, PageFacts } from "./content";
import type { DocHeading } from "./lib";
import type { DocEntry, DocSection } from "./manifest";

export interface RenderContext {
  cssHref: string;
  clientSrc: string;
}

/** Diagram registry for {{diagram:<name>}} markers in markdown content. */
const DIAGRAMS: Record<string, ComponentType> = {
  architecture: ArchitectureDiagram,
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function techArticleLd(title: string, description: string, path: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: title,
    description,
    url: `${SITE_URL}${path}`,
    inLanguage: "en",
    isPartOf: { "@type": "WebSite", name: "CHouse UI", url: `${SITE_URL}/` },
    publisher: { "@type": "Organization", name: "CHouse UI", url: `${SITE_URL}/` },
    license: "https://www.apache.org/licenses/LICENSE-2.0",
  };
}

interface LdCrumb {
  name: string;
  path?: string;
}

function breadcrumbLd(crumbs: LdCrumb[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ name: "Home", path: "/" }, { name: "Docs", path: DOCS_HOME_PATH }, ...crumbs].map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      ...(crumb.path ? { item: `${SITE_URL}${withBase(crumb.path)}` } : {}),
    })),
  };
}

interface PageMeta {
  title: string;
  description: string;
  /** Deploy-relative path, already base-prefixed. */
  path: string;
  crumbs: LdCrumb[];
  /** Article pages get TechArticle structured data; hubs do not. */
  article: boolean;
}

function head(meta: PageMeta, cssHref: string): string {
  const { title, description, path } = meta;
  const canonical = `${SITE_URL}${path}`;
  const ld = [
    ...(meta.article ? [techArticleLd(title, description, path)] : []),
    ...(meta.crumbs.length ? [breadcrumbLd(meta.crumbs)] : []),
  ];
  return `
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)} — CHouse UI Docs</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${canonical}" />
    <meta name="theme-color" content="#0a0a0a" />
    <meta name="color-scheme" content="dark" />
    <link rel="icon" type="image/png" sizes="32x32" href="${withBase("/favicon-32x32.png")}" />
    <link rel="icon" type="image/png" sizes="16x16" href="${withBase("/favicon-16x16.png")}" />
    <link rel="icon" type="image/x-icon" href="${withBase("/favicon.ico")}" />
    <link rel="icon" type="image/svg+xml" href="${withBase("/logo.svg")}" />
    <link rel="apple-touch-icon" sizes="180x180" href="${withBase("/logo.png")}" />
    <meta property="og:type" content="${meta.article ? "article" : "website"}" />
    <meta property="og:title" content="${escapeHtml(title)} — CHouse UI Docs" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:site_name" content="CHouse UI" />
    <meta property="og:image" content="${SITE_URL}/logo.png" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(title)} — CHouse UI Docs" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
${ld.map((item) => `    <script type="application/ld+json">${JSON.stringify(item)}</script>`).join("\n")}
    <link rel="stylesheet" href="${cssHref}" />`;
}

function shell(meta: PageMeta, ctx: RenderContext, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en" class="dark">
<head>${head(meta, ctx.cssHref)}
</head>
<body class="bg-ink-50 font-sans text-paper antialiased">
<div id="root">${bodyHtml}</div>
<script src="${ctx.clientSrc}" defer></script>
</body>
</html>
`;
}

/** Render one doc page. */
export function renderDocPageHtml(
  args: { entry: DocEntry; facts: PageFacts; blocks: ContentBlock[]; headings: DocHeading[] },
  permissions: PermissionIndex,
  ctx: RenderContext
): string {
  const { section, group, page } = args.entry;
  for (const block of args.blocks) {
    if (block.kind === "diagram" && !DIAGRAMS[block.name]) {
      throw new Error(`Unknown diagram marker: {{diagram:${block.name}}}`);
    }
  }
  const bodyHtml = renderToStaticMarkup(
    <DocsPage
      entry={args.entry}
      facts={args.facts}
      blocks={args.blocks}
      headings={args.headings}
      diagrams={DIAGRAMS}
      permissions={permissions}
    />
  );
  const crumbs: LdCrumb[] = [
    { name: section.label, path: sectionPath(section.id) },
    ...(group.label ? [{ name: group.label }] : []),
    { name: page.title, path: docPath(page.slug) },
  ];
  return shell(
    { title: page.title, description: page.description, path: withBase(docPath(page.slug)), crumbs, article: true },
    ctx,
    bodyHtml
  );
}

/** Render the docs home at /docs/. */
export function renderHomeHtml(ctx: RenderContext): string {
  return shell(
    {
      title: "Documentation",
      description:
        "CHouse UI documentation: install, configure, secure and operate CHouse UI — every screen, setting, permission, MCP tool and CLI command.",
      path: withBase(DOCS_HOME_PATH),
      crumbs: [],
      article: false,
    },
    ctx,
    renderToStaticMarkup(<DocsHome />)
  );
}

/** Render a section hub at /docs/<section>/. */
export function renderSectionHtml(section: DocSection, ctx: RenderContext): string {
  return shell(
    {
      title: section.label,
      description: section.description,
      path: withBase(sectionPath(section.id)),
      crumbs: [{ name: section.label, path: sectionPath(section.id) }],
      article: false,
    },
    ctx,
    renderToStaticMarkup(<DocsSectionHub section={section} />)
  );
}

/**
 * Redirect stub for a renamed page. Static hosting has no server redirects,
 * so this is a meta refresh plus a canonical pointing at the new URL, which
 * search engines treat as a permanent move.
 */
export function renderRedirectHtml(targetSlug: string): string {
  const target = withBase(docPath(targetSlug));
  const absolute = `${SITE_URL}${target}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Moved — CHouse UI Docs</title>
<meta name="robots" content="noindex" />
<link rel="canonical" href="${absolute}" />
<meta http-equiv="refresh" content="0; url=${target}" />
<script>location.replace(${JSON.stringify(target)} + location.hash);</script>
</head>
<body>
<p>This page moved to <a href="${target}">${absolute}</a>.</p>
</body>
</html>
`;
}
