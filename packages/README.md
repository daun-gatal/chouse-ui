# packages

## Overview

Workspace packages of the CHouse UI monorepo. It currently holds a single
package, the backend API server.

## Subdirectories & Boundaries

- server: [./server/README.md](./server/README.md) — Bun + Hono v4 API server with RBAC (SQLite/PostgreSQL), the `/api` and `/mcp` surfaces, the OAuth authorization server, the AI engine and the background observability and scheduling workers
