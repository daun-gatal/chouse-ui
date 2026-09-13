import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentType } from "react";
import { DocsPage } from "./components/DocsPage";
import { ArchitectureDiagram } from "./components/ArchitectureDiagram";
import { SITE_URL, withBase } from "./lib";
import type { DocHeading } from "./lib";

export interface RenderContext {
  cssHref: string;
  clientSrc: string;
}

export interface RenderedPage {
  path: string;
  url: string;
  title: string;
  html: string;
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

function breadcrumbLd(path: string, title: string, groupLabel: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Docs", item: `${SITE_URL}${withBase("/docs/overview/")}` },
      { "@type": "ListItem", position: 3, name: groupLabel },
      { "@type": "ListItem", position: 4, name: title, item: `${SITE_URL}${path}` },
    ],
  };
}

function head({ title, description, path, groupLabel, cssHref }: {
  title: string;
  description: string;
  path: string;
  groupLabel: string;
  cssHref: string;
}): string {
  const canonical = `${SITE_URL}${path}`;
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
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(title)} — CHouse UI Docs" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:site_name" content="CHouse UI" />
    <meta property="og:image" content="${SITE_URL}/logo.png" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(title)} — CHouse UI Docs" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <script type="application/ld+json">${JSON.stringify(techArticleLd(title, description, path))}</script>
    <script type="application/ld+json">${JSON.stringify(breadcrumbLd(path, title, groupLabel))}</script>
    <link rel="stylesheet" href="${cssHref}" />`;
}

function shell({ title, description, path, groupLabel, cssHref, clientSrc, bodyHtml }: {
  title: string;
  description: string;
  path: string;
  groupLabel: string;
  cssHref: string;
  clientSrc: string;
  bodyHtml: string;
}): string {
  return `<!doctype html>
<html lang="en" class="dark">
<head>${head({ title, description, path, groupLabel, cssHref })}
</head>
<body class="bg-ink-50 font-sans text-paper antialiased">
<div id="root">${bodyHtml}</div>
<script src="${clientSrc}" defer></script>
</body>
</html>
`;
}

/** Render one doc page. */
export function renderDocPageHtml(
  args: {
    title: string;
    description: string;
    groupLabel: string;
    index: number;
    slug: string;
    markdown: string;
    headings: DocHeading[];
  },
  path: string,
  ctx: RenderContext
): string {
  const diagramMatch = /\{\{diagram:([a-z-]+)\}\}/.exec(args.markdown);
  if (diagramMatch && !DIAGRAMS[diagramMatch[1]]) {
    throw new Error(`Unknown diagram marker: {{diagram:${diagramMatch[1]}}}`);
  }
  const Diagram = diagramMatch ? DIAGRAMS[diagramMatch[1]] : undefined;
  const bodyHtml = renderToStaticMarkup(
    <DocsPage
      index={args.index}
      groupLabel={args.groupLabel}
      title={args.title}
      description={args.description}
      headings={args.headings}
      markdown={args.markdown}
      diagram={Diagram ? <Diagram /> : undefined}
      activeSlug={args.slug}
    />
  );
  return shell({
    title: args.title,
    description: args.description,
    path,
    groupLabel: args.groupLabel,
    cssHref: ctx.cssHref,
    clientSrc: ctx.clientSrc,
    bodyHtml,
  });
}
