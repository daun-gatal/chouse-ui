# portfolio scripts

## Overview

Bun/Node build steps for the website. `bun run build` in `docs/portfolio` runs `vite build`, then `copy-404`, `build-docs` and `generate-sitemap` in that order (`package.json` `build`). `gen-reference.ts` is run separately (and in CI with `--check`) to regenerate the reference pages from the repository's code.

## Interface

- `[build-docs.ts:main]` - static-site generator for `/docs`: validates the manifest, content, frontmatter permissions, screenshots and links, then writes every page, hub, redirect stub, the search index, `docs-client.js` and `.docs-pages.json` into `dist/`.
- `[gen-reference.ts:main]` - writes the generated pages (`permissions.md`, `configuration-env.md`, `mcp-tools.md`, `cli-reference.md`, `helm-values.md`, `audit-events.md`, `ai-features.md`, `ai-tools.md`, `connection-privileges.md`) and `src/content/reference/permissions.json`; `--check` reports stale pages and coverage gaps instead.
- `[copy-404.js]` - copies `dist/index.html` to `dist/404.html` for GitHub Pages SPA routing.
- `[generate-sitemap.js]` - writes `dist/sitemap.xml` for `https://chouse-ui.com`, including the docs pages listed in `dist/.docs-pages.json`.

## Invariants

- `build-docs` must run after `vite build`: it fails without `dist/` or `dist/assets/main-*.css` `[build-docs.ts:findCssHref]`, `[build-docs.ts:main]`.
- The docs build fails on a manifest page without content, a content file without a page, an invalid manifest or redirect, bad frontmatter or unknown permission, a missing screenshot, or an internal link/anchor that does not resolve in the docs or in landing components `[build-docs.ts:validateManifest]`, `[build-docs.ts:loadPage]`, `[build-docs.ts:checkPermissions]`, `[build-docs.ts:checkScreenshots]`, `[build-docs.ts:checkLinks]`.
- `build-docs` needs `src/content/reference/permissions.json` (from `gen-reference.ts`) `[build-docs.ts:loadPermissions]`.
- `gen-reference.ts --check` exits 1 on stale generated pages or coverage gaps: undocumented/unused env vars, app screens without a docs page, or a release announcement behind the unreleased fragments `[gen-reference.ts:checkEnvCoverage]`, `[gen-reference.ts:checkScreenCoverage]`, `[gen-reference.ts:checkReleaseNotes]`, `[gen-reference.ts:main]`.
- `gen-reference.ts` imports server and frontend modules from the repository (`packages/server/src/...`, `src/features/agents/...`), so it needs the full checkout and `bun install` in `packages/server`; the site build itself does not.
- `copy-404.js`, `build-docs.ts` and `generate-sitemap.js` exit 1 on failure `[copy-404.js]`, `[build-docs.ts:main]`, `[generate-sitemap.js]`.

## Side Effects

- `build-docs.ts` writes `dist/docs/**/index.html`, `dist/docs/search-index.json`, `dist/docs-client.js`, `dist/.docs-pages.json` `[build-docs.ts:writePage]`, `[build-docs.ts:main]`.
- `gen-reference.ts` writes generated markdown under `src/content/docs/` and `src/content/reference/permissions.json` (not in `--check` mode) `[gen-reference.ts:main]`; it reads `charts/chouse-ui/README.md` and `Chart.yaml`, `changelogs/unreleased/`, `src/content/reference/cli.json` (for `cli-reference.md`, `[gen-reference.ts:cliPage]`) and server source to scan env usage.
- `copy-404.js` writes `dist/404.html`; `generate-sitemap.js` writes `dist/sitemap.xml`.

## Verification

- Run: `cd docs/portfolio && bun run build`
- Run: `cd docs/portfolio && bun scripts/gen-reference.ts --check`
