# portfolio

## Overview

The CHouse UI website (`chouse-ui.com`): a separate Vite 7 + React 19 + Tailwind app with its own `package.json` (`chouseui-portfolio`, version kept in sync with the root and server by the release workflow). It ships a single-page landing site and a statically generated `/docs` site, served in production by a small Bun file server.

## Interface

- `package.json` scripts: `dev` (Vite, port 5173), `build` (`vite build` then `copy-404`, `build-docs`, `generate-sitemap`), `preview`.
- `[server.js]` - Bun static server for the built site on `PORT` (default 3000), serving from `public/`.
- `[vite.config.ts]` - base path from `VITE_BASE_PATH` (default `/`), output `dist/`, `@` alias to `src/`.
- `Dockerfile` - builds with `bun run build`, copies `dist/` to `/app/public` with `server.js`, exposes 3000; `k8s/deployment.yaml` deploys it.
- scripts: [./scripts/README.md](./scripts/README.md) - docs SSG, reference generation, 404 copy, sitemap.
- src: [./src/README.md](./src/README.md) - landing page, docs-site generator library, content.

## Invariants

- `server.js` tries the exact file, then `<path>/index.html` (directory-URL docs pages), and otherwise falls back to `index.html` for SPA routing; directories are never served as files `[server.js]`.
- Unknown file extensions are served as `application/octet-stream` `[server.js:getContentType]`.
- The site deploys under a sub-path only via `VITE_BASE_PATH`; both Vite and the docs SSG read it `[vite.config.ts]`, `[src/docs-site/lib.ts:getBase]`. Some landing-page links are hard-coded to `/` and do not follow it (see `src/components/README.md`).

## Side Effects

- `server.js` binds an HTTP port and reads files from `public/` `[server.js]`.
- `bun run build` writes `dist/` (see [scripts](./scripts/README.md)).

## Verification

- Run: `cd docs/portfolio && bun run build`
- Run: `cd docs/portfolio && bun scripts/gen-reference.ts --check`
