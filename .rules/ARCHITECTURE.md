# Architecture Documentation Rules

This document defines how architecture documentation should be maintained as the codebase evolves.

## Architecture File

The project's architecture is documented in [`ARCHITECTURE.md`](../ARCHITECTURE.md) at the repository root.

## When to Update ARCHITECTURE.md

Update the architecture documentation when any of these changes occur:

### Must Update (Breaking/Structural Changes)

- **New pages added** to `src/pages/` — Update the Routing section and Pages count
- **New feature modules** added to `src/features/` — Update the Features section
- **New Zustand stores** added to `src/stores/` — Update the State Management section
- **New API modules** added to `src/api/` — Update the API Layer section
- **New server routes** added to `packages/server/src/routes/` — Update the API Routes table
- **New server services** added to `packages/server/src/services/` — Update the Services table
- **New middleware** added to `packages/server/src/middleware/` — Update the Middleware table
- **New RBAC routes/services** added to `packages/server/src/rbac/` — Update the RBAC section
- **New RBAC permissions** added to `src/stores/rbac.ts` → `RBAC_PERMISSIONS` — Update the Permissions table
- **Routing changes** in `src/App.tsx` — Update the Routing diagram
- **New providers** added to `src/providers/` — Update the Providers section
- **New dependencies** that change the tech stack — Update the Tech Stack table
- **Database schema changes** (new tables, migrations) — Update the RBAC Database section

### Should Update (Significant Additions)

- **New shadcn/ui components** added to `src/components/ui/` — Update the component count
- **New common components** added to `src/components/common/` — Update the component count
- **New hooks** added to `src/hooks/` — Update the Hooks count/description
- **New helper/utility files** — Update the Project Structure section
- **Major refactoring** that changes how layers interact — Update the relevant diagrams

### No Update Needed

- Bug fixes within existing files
- Styling changes
- Content changes within existing components
- Test file additions
- Documentation improvements (other than ARCHITECTURE.md itself)

## How to Update

1. **Edit `ARCHITECTURE.md`** directly — it is the single source of truth
2. **Keep diagrams in sync** — Mermaid diagrams should reflect actual code structure
3. **Verify facts** — All claims must be verifiable from the actual source code:
   - File counts should match actual directory contents
   - File sizes should be approximate (e.g., "(82KB)") but in the right ballpark
   - Technology versions should match `package.json`
   - Permission lists should match `RBAC_PERMISSIONS` in `src/stores/rbac.ts`
4. **Keep the README Architecture section in sync** — The concise overview in `README.md` → `## Architecture` should stay consistent with `ARCHITECTURE.md`

## Sections to Keep Current

| Section | What to Verify |
|---|---|
| High-Level System Architecture | Major components and data flow |
| Frontend Architecture | Pages, features, components, hooks, stores, API modules |
| Routing | All routes in `src/App.tsx` |
| State Management | All Zustand stores in `src/stores/` |
| Backend Architecture | Middleware pipeline, routes, services |
| RBAC Subsystem | Routes, services, permissions, roles |
| Data Flow | Query execution sequence |
| Project File Structure | Actual directory tree with file counts/sizes |
| Tech Stack | Versions from `package.json` |

## Factual Accuracy Checklist

When updating, verify these commonly confused items:

- Password hashing is **Argon2id** via `Bun.password.hash` (NOT bcrypt)
- JWT is handled by **jose** library (NOT jsonwebtoken)
- Server ClickHouse client is `@clickhouse/client` (native), frontend is `@clickhouse/client-web`
- Database ORM is **Drizzle ORM** with SQLite and PostgreSQL adapters
- AI uses **Vercel AI SDK v6** with multiple provider packages
- SQL parsing middleware uses **node-sql-parser**
- Frontend validation uses **Zod v4**, server uses **Zod v3**
- Connection password encryption uses **AES-256-GCM**
