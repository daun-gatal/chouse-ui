# docs-site components

## Overview

React components that render the static `/docs` pages at build time. They are rendered to HTML by [`../render.tsx`](../render.tsx) with `renderToStaticMarkup`, so they use no hooks or browser APIs; interactive behaviour (copy buttons, scrollspy, tabs, search, mobile drawer) is added afterwards by `../docs-client.js`.

## Interface

- `[DocsPage.tsx:DocsPage]` - one doc page: breadcrumbs, lead, "In the app / Needs" facts strip, content blocks, an "Edit this page on GitHub" link (to the `preview` branch via `EDIT_BASE`, omitted on `generated:` pages), prev/next. `[DocsPage.tsx:PermissionIndex]` maps permission ids to name and catalog anchor.
- `[DocsHub.tsx:DocsHome]`, `[DocsHub.tsx:DocsSectionHub]` - the docs home and one hub per manifest section.
- `[DocsLayout.tsx:DocsLayout]` with `[DocsLayout.tsx:Crumb]` - page shell: header, sidebar, "On this page" rail.
- `[Sidebar.tsx:SidebarNav]` - section/group/page navigation from the manifest.
- `[Toc.tsx:Toc]` - "On this page" heading list.
- `[Markdown.tsx:Markdown]` - themed `react-markdown` + `remark-gfm` renderer with heading ids, callouts and code blocks.
- `[CodeBlock.tsx:CodeBlock]`, `[CodeBlock.tsx:CodeInline]` - fenced and inline code.
- `[Callout.tsx:Callout]` - Note/Tip/Warning blocks.
- `[ArchitectureDiagram.tsx:ArchitectureDiagram]` - the `{{diagram:architecture}}` diagram.

## Invariants

- Components run server-side only during the docs build: no hooks and no browser APIs `[Markdown.tsx:Markdown]`.
- Markdown headings get ids from `headingId` in `../lib.ts`, the same function the build uses to validate anchors, so links and rendered ids agree `[Markdown.tsx:Markdown]`.
- Markdown is rendered without raw-HTML plugins (only `remark-gfm`) `[Markdown.tsx:Markdown]`.

## Side Effects

- None. Components return markup only.

## Verification

- Run: `cd docs/portfolio && bun run build`
