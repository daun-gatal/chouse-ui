# docs

## Overview

Project documentation outside the app. It holds the website source (`portfolio/`, the landing page and the generated `/docs` site), the Architecture Decision Records in `adr/` (markdown only; see [`adr/README.md`](./adr/README.md)), and standalone guides: [`cli.md`](./cli.md), [`mcp.md`](./mcp.md), [`sso.md`](./sso.md).

## Subdirectories & Boundaries

- portfolio: [./portfolio/README.md](./portfolio/README.md) - separate Vite/React website app: landing page, static `/docs` generator with build-time manifest/link/frontmatter validation, generated reference pages, and a Bun static file server for deployment.
