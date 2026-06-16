# CLAUDE.md

Project-level instructions for AI agents working on CHouse UI.

## Project Overview

CHouse UI is a web interface for ClickHouse with built-in RBAC, fleet monitoring, and an AI SRE. Apache 2.0 licensed.

**Monorepo layout:**
- `src/` — Frontend (React 19 + Vite 7 SPA)
- `packages/server/` — Backend (Bun + Hono v4 API server)
- `docs/portfolio/` — Marketing/docs website (separate Vite app)

## Quick Reference

### Commands

```bash
bun install                    # Install dependencies
bun run dev                    # Start frontend (:5173) + backend (:5521)
bun run dev:web                # Frontend only
bun run dev:server             # Backend only
bun run build                  # Build both frontend and server
bun run lint                   # ESLint
bun run typecheck              # TypeScript check (tsc --noEmit)
bunx vitest run                # Frontend tests
./scripts/test-isolated-server.sh  # Server tests
./scripts/test-migrations.sh   # RBAC migration tests (SQLite + PostgreSQL via Docker)
```

### Default Login

- Email: `admin@localhost` / Username: `admin` / Password: `admin123!`

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 19, Vite 7, React Router v7, Zustand 5, TanStack Query v5, shadcn/ui, Tailwind CSS 4, Monaco Editor, AG Grid |
| **Backend** | Bun, Hono v4, Drizzle ORM (SQLite / PostgreSQL), Pino logger |
| **AI** | Vercel AI SDK v6, multi-provider (OpenAI, Anthropic, Google, etc.) |
| **ClickHouse** | `@clickhouse/client` (server), `@clickhouse/client-web` (frontend) |
| **Testing** | Vitest + jsdom + MSW (frontend), Bun Test (server) |

## Architecture

**Key patterns:**
- Frontend uses feature-based organization under `src/features/`
- State: Zustand stores in `src/stores/`, data fetching via TanStack Query
- API client modules in `src/api/`
- Server routes in `packages/server/src/routes/`, services in `packages/server/src/services/`
- RBAC subsystem in `packages/server/src/rbac/`

## Code Standards

### TypeScript
- Strict mode enabled, never use `any` (use `unknown` + type guards)
- Explicit return types on functions
- Avoid `as` type assertions; prefer type narrowing
- Import order: React > third-party > internal (`@/`) > types
- Use `import type` for type-only imports

### React
- Functional components only, props typed via interfaces
- Zustand for global state, `useState` for local state
- `useMemo`/`useCallback` for expensive computations and child callbacks
- Always return cleanup functions from `useEffect` (timers, controllers, subscriptions)
- Use `React.lazy` + `Suspense` for code splitting

### Logging
- **Client** (`src/`): Use `import { log } from '@/lib/log'` — never raw `console.*`
- **Server** (`packages/server/`): Use `logger` from `utils/logger.ts` (Pino) or `requestLogger(c.get('requestId'))` in route handlers — never raw `console.*`
- Never log passwords, tokens, or PII

### Error Handling
- **Client**: try-catch with `toast.error()` for user-facing messages, `log.error()` for logging
- **Server**: Use `AppError` class (`AppError.notFound()`, `AppError.internal()`, etc.) with proper HTTP status codes
- Always clean up resources (connections, timers, AbortControllers)

### Security
- Passwords: Argon2id via `Bun.password.hash` (NOT bcrypt)
- JWT: `jose` library (NOT jsonwebtoken)
- Connection password encryption: AES-256-GCM
- Validation: Zod v4 (frontend), Zod v3 (server)
- Server routes: `rbacAuthMiddleware` + `requirePermission` middleware
- Client: `PermissionGuard` component for UI gating
- SQL injection prevention via `node-sql-parser` middleware
- Never use `dangerouslySetInnerHTML` without DOMPurify

### Testing
- Test files co-located with source: `file.ts` -> `file.test.ts`
- **Required for**: `src/api/*`, `src/hooks/*`, `src/lib/*`, `src/helpers/*`, `src/stores/*`, `src/utils/*`
- **Optional for**: pure UI components without complex logic
- Frontend: Vitest + jsdom, MSW for API mocking, React Testing Library for hooks
- Server: Bun Test + Hono test utilities
- Zustand store tests must use dynamic imports to avoid persist initialization issues
- Coverage goal: 80%+ on utilities and API modules

### Database Migrations — testing is MANDATORY
Any change to `packages/server/src/rbac/db/migrations.ts` (adding a migration, or
editing an existing one) **MUST** be accompanied by tests, and they must pass on
**both SQLite and PostgreSQL**:

- Tests live in `packages/server/src/rbac/db/migrations.test.ts` and run on both
  dialects via the harness in `migrationTestHarness.ts`. PostgreSQL is exercised in
  a throwaway Docker container the harness creates and destroys — **Docker is
  required** (`./scripts/test-migrations.sh`).
- **Every migration version must have an entry in `VERSION_CHECKS`** asserting its
  effect (table/column/index/permission/grant/data). A guard test fails if a
  migration is added without one — so a new migration cannot merge untested.
- **Upgrade paths are covered, not just fresh install.** `migrations.test.ts` runs
  three install/upgrade shapes on both dialects — fresh install (all at once),
  *stepwise* upgrade (one release at a time, the common real-world path), and a
  *skip-version* upgrade (old install jumping straight to HEAD) — and asserts they
  all land in the same final state. A new migration is exercised by all three
  automatically once it has a `VERSION_CHECKS` entry; make sure it applies cleanly
  on top of an existing DB (idempotent, `IF NOT EXISTS`/guarded), not only on a
  freshly-created schema.
- For **data migrations** (anything that moves/transforms rows, not just schema),
  also add a dedicated test that seeds representative pre-migration data with
  `runMigrations({ through: '<prev-version>' })`, runs the new migration, and
  asserts the transformation **and idempotency** (re-running is a no-op). Cover the
  edge cases (empty data, conflicting rows, dedup, fail-closed behaviour).
- Migrations are forward-only and not transaction-wrapped: keep every step
  idempotent, and split destructive steps (e.g. `DROP TABLE`) into their own later
  migration so a failed transform never reaches the drop.

### Code Organization
- Feature-based structure (not file-type-based)
- Named exports for utilities/components; default exports only for page components
- Barrel exports via `index.ts`
- Naming: PascalCase (components/types), camelCase (hooks/utils), UPPER_SNAKE_CASE (constants)

### Style
- 2-space indentation, trailing commas, double quotes, semicolons
- Comments explain *why*, not *what* — no commented-out code
- JSDoc only for complex functions

## Pull Request Creation

When creating a PR via `gh pr create`, always read `.github/pull_request_template.md` and use its structure as the `--body` content, filling in each section based on the actual changes. Never write a free-form body that skips the template sections.

## Versioning & Releases

Releases are **fully automated** — never edit `CHANGELOG.md` directly and never manually bump version numbers.

### For contributors (every user-visible change)

Drop a fragment file in `changelogs/unreleased/`:

```
changelogs/unreleased/<pr-number>-<slug>.md
```

```md
type: minor

### Added
- **Feature name** — description
```

- `type` is required: `major` (breaking), `minor` (new feature), `patch` (bug fix)
- Use `### Added / Changed / Fixed / Removed` sections
- See `changelogs/unreleased/README.md` for full details

Skip the fragment only for non-user-visible changes (refactors, CI, docs-only).

### How releases happen

When a PR containing a fragment merges to `main`, `auto-release.yml` fires automatically:
1. Assembles all fragments into a new version block in `CHANGELOG.md`
2. Bumps `version` in all three `package.json` files (root, server, portfolio) in sync
3. Commits and pushes — triggering the existing `release.yml` which creates the git tag, GitHub Release, and Docker image

Manual override (emergency use only): `bun run release 2.20.0`

## Architecture Decision Records (ADR)

For **big, multi-component** changes, capture the proposal as an ADR in
[`docs/adr/`](docs/adr/) **before** implementation — so approaches and concerns are
discussed up front and the merged ADR becomes the spec. This is a reasonable
process, not a hard gate: use it for significant decisions (security boundaries,
data flow, deployment topology, anything spanning RBAC + ClickHouse + UI), and
**skip it for patches, minor features, and bug fixes**.

- **Flow:** PR the ADR (`Proposed`) → discuss → merge as `Accepted` → implement in
  follow-up PR(s). Acceptance is separate from shipping the feature.
- ADRs do **not** change releases — semver and `changelogs/unreleased/` fragments
  are unaffected, and an ADR itself needs no changelog fragment.
- Full rules and conventions: **[.rules/ADR.md](.rules/ADR.md)** and the
  [`docs/adr/README.md`](docs/adr/README.md) template/index.

## When to Apply Each Rule

| Situation | Rule file to follow |
|-----------|-------------------|
| Planning a **big / multi-component** change before writing code | **[.rules/ADR.md](.rules/ADR.md)** — when an ADR is required, the draft → discuss → accept → implement flow, and conventions. See [Architecture Decision Records](#architecture-decision-records-adr). |
| Writing or modifying any code | **[.rules/CODE_CHANGES.md](.rules/CODE_CHANGES.md)** — standards, patterns, pre-commit checklist |
| Reviewing a PR or diff, or self-checking before marking a task done | **[.rules/CODE_REVIEWER.md](.rules/CODE_REVIEWER.md)** — review checklist, approval criteria, common issues |
| After finishing a task — scan files you touched | **[.rules/DEAD_CODE.md](.rules/DEAD_CODE.md)** — remove unused imports, symbols, exports left behind |
| Proactively scanning the codebase for cleanup | **[.rules/DEAD_CODE.md](.rules/DEAD_CODE.md)** — full scan process including dependency and barrel-export checks |
| A change is user-visible (new feature, bug fix, removal) | Drop a fragment in `changelogs/unreleased/<pr-number>-<slug>.md` — never edit `CHANGELOG.md` directly |
| Touching `rbac/db/migrations.ts` (add or edit a migration) | **MANDATORY** — add/update `migrations.test.ts` (per-version `VERSION_CHECKS` + data-migration cases) and run `./scripts/test-migrations.sh` (SQLite + PostgreSQL/Docker). See [Database Migrations](#database-migrations--testing-is-mandatory). |
