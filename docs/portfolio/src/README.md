# portfolio src

## Overview

Source of the CHouse UI website: a React 19 single-page landing page (bootstrapped by `main.tsx`) plus the build-time `/docs` generator library and the content both read.

## Interface

- `[main.tsx]` - mounts `<App />` under `React.StrictMode` into `#root` and loads `index.css`.
- `[App.tsx:App]` - default export composing the landing sections in order: Navbar, Hero, WhatsNew, ClosedLoop, Features, QuickStart, Automate, DockerDeploy, Sso, FAQ, Changelog, Footer.
- components: [./components/README.md](./components/README.md) - landing page sections and layout primitives.
- content: [./content/README.md](./content/README.md) - release announcement, markdown docs pages, reference data.
- docs-site: [./docs-site/README.md](./docs-site/README.md) - static `/docs` generator library and authoring guide.
- lib: [./lib/README.md](./lib/README.md) - `cn` class-name helper.

## Invariants

- The `@` import alias resolves to this directory (`vite.config.ts` `resolve.alias`).
- `docs-site/` modules are imported both by the browser bundle (`withBase` in `ReleaseBanner`) and by Bun scripts at build time, so they must not depend on browser-only APIs `[docs-site/lib.ts:getBase]`.

## Side Effects

- Mounts the React tree into the DOM `[main.tsx]`.

## Verification

- Run: `cd docs/portfolio && bun run build`
