# 0011 — Personal Access Tokens for CLI and MCP Machine Auth

- **Status:** Accepted
- **Date:** 2026-09-11
- **Implementation:** follow-up PR(s) referencing this ADR (backend, then frontend, then E2E). Acceptance is separate from shipping.

## Context

CHouse UI authenticates browsers with short-lived JWT access tokens (4h) plus
rotating refresh tokens (7d) and server-side sessions (`rbac/services/jwt.ts`,
`rbac/services/rbac.ts`). That flow assumes an interactive user agent that can
log in, store two tokens, and refresh on 401 (`src/api/client.ts`).

Two planned consumers cannot do that:

- a **CLI** (shell scripts, CI jobs) that needs one secret from an env var,
- an **MCP server** (agentic tools) that needs a long-lived credential to pass
  as a `Bearer` token on every call.

The server already has two properties that make a machine credential cheap:

1. The data plane (`connectionContextMiddleware`,
   `packages/server/src/middleware/connectionContext.ts`) resolves the
   ClickHouse connection per request from `X-Connection-Id`, falling back to
   the user's default connection — "JWT-only API consumers" already work
   without browser session state.
2. Every permission check re-reads the database (`requirePermission` falls back
   to `userHasPermission`; query routes call `userHasPermission` /
   `validateQueryAccess` per request), so a credential that resolves to "the
   user's current permissions" is automatically consistent with the UI.

Constraints that shape the design:

- The credential must be **individually revocable** (JWTs cannot be revoked
  without a blocklist) and **long-lived** (no refresh dance for machines).
- Its power must **derive from the user, live** — demotion or deactivation
  must shrink it immediately (fail-closed, cf. ADR 0010's "no silent
  substitution" rule).
- A leaked machine token must not be able to **mint new tokens or take over
  the account** (no self-propagation).
- The `rbac_api_keys` table exists in the Drizzle snapshot
  (`rbac/schema/sqlite.ts`, `rbac/schema/postgres.ts`) but **no versioned
  migration creates it**, so long-lived upgraded databases likely lack it —
  the feature must backfill the table idempotently.
- Machine clients do not send `X-Requested-With: XMLHttpRequest`, which
  `apiProtectionMiddleware` (`packages/server/src/routes/index.ts`) currently
  requires of every non-public call.

## Decision

### 1. Token format and storage

- Format `ch_pat_<base64url(randomBytes(32))>`. The prefix is greppable,
  secret-scanner friendly, and lets middleware distinguish PATs from JWTs
  (`eyJ…`) with a zero-cost string check before any hashing or verification.
- Store **SHA-256 of the secret** (`keyHash`, unique) plus a short `keyPrefix`
  for display. SHA-256 — not Argon2id (passwords; needs slowness) and not
  AES-256-GCM (connection secrets; reversible) — is the correct primitive for
  fast indexed lookup of a high-entropy secret.
- Reuse the existing `rbac_api_keys` table as-is
  (`user_id, name, key_hash unique, key_prefix, scopes json, expires_at,
  last_used_at, created_at, revoked_at`). No new table, no new RBAC
  permission: PAT CRUD is self-scoped (owner-only, like `userPreferences.ts`),
  so `PERMISSIONS`, `DEFAULT_ROLE_PERMISSIONS`, and `seed.ts` are untouched.
- The raw secret is returned **once** at creation and never logged, persisted,
  or cached anywhere else.

### 2. Permission model: live intersection

- Effective permissions per request = **live `getUserRoles()` +
  `getUserPermissions()` from the database ∩ token `scopes`**. Empty scopes
  mean full inherit. Scope subsets are validated at creation (⊆ `PERMISSIONS`
  values and ⊆ the creator's live permissions).
- No expiry by default (`expires_at NULL`); optional future-dated expiry
  compared in UTC.
- Inactive users, expired tokens, and revoked tokens fail closed (401).

### 3. Single verification helper, two choke points

- New `rbac/services/patAuth.ts` exposes `verifyBearer()`, used by **both**
  `rbacAuthMiddleware` (`/api/rbac/*`) and `optionalRbacMiddleware` (data
  plane). PAT sets the same context keys as JWT (`rbacUserId`, `rbacRoles`,
  `rbacPermissions`) plus `authMethod: 'pat'` / `patId`, with
  `sessionId: 'pat:<id>'` so `getRbacUser` consumers keep working.
- `apiProtectionMiddleware` exempts `ch_pat_`-prefixed `Authorization`
  headers (prefix check only, no DB I/O). Browser posture is unchanged.
- `lastUsedAt` updates are best-effort async and never fail the request.

### 4. Privilege fence (PAT cannot…)

PAT-authenticated requests are rejected (403) on `POST /api/rbac/pats`,
`change-password`, `login`/`refresh`, and `logout-all`. Everything else
follows the existing effective-permission and data-access-policy checks, so
machines and humans are authorised identically.

### 5. Transport convention (reserved for CLI/MCP PRs, not implemented here)

- `Authorization: Bearer ch_pat_…`, optional `X-Connection-Id` (default
  connection otherwise).
- Reserved env name: `CH_HOUSE_PAT` (with `--token` flag mapping to the same
  header in the future CLI).

### 6. Migration and rollout

- New `1.51.0 ensure-pat-backfill` migration: idempotent
  `CREATE TABLE IF NOT EXISTS rbac_api_keys` (+ indexes) on both dialects —
  a no-op on fresh installs, the backfill on upgraders — with a
  `VERSION_CHECKS["1.51.0"]` entry asserting table + indexes (which also
  retro-covers the previously untested snapshot-only table).
- The PAT service fails closed with a clear error if the table is absent
  (mixed-version rollout skew).

## Consequences

- CLI/MCP auth becomes one env var; no refresh logic, no session handling.
- Revoke/demotion/deactivation take effect on the next request — no TTL lag,
  no silent substitution (consistent with ADR 0010).
- A leaked PAT can do what its owner could do (within scopes) but cannot
  escalate: no new tokens, no password change, no session manipulation.
- `lastUsedAt` gives per-token usage signal for hygiene (unused-token
  cleanup stays a future, separate decision).
- Machines inherit the same rate limiting and audit trail as humans, with
  `patId` distinguishing machine actions.

## Alternatives considered

- **Long-lived JWTs for machines** — rejected: not individually revocable;
  permission snapshot at mint time goes stale (violates the live-derivation
  requirement).
- **New `rbac_personal_access_tokens` table** — rejected: `rbac_api_keys`
  already has exactly the needed shape on both dialects; a second table is
  schema drift with zero benefit.
- **Snapshot permissions at creation** — rejected: stale-risk on demotion;
  the per-request DB check this codebase already pays for makes live
  resolution free.
- **Per-route PAT wiring** — rejected: both middlewares funnel through one
  helper, so all current and future routes gain PAT support with zero
  per-route edits.
- **Argon2id-hashed tokens** — rejected: designed for low-entropy passwords;
  keyed lookup of a 256-bit secret wants SHA-256.
