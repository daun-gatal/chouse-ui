# ADR 0001 — Personal Access Tokens (PAT)

- **Status:** Proposed
- **Date:** 2026-06-16
- **Deciders:** CHouse UI maintainers
- **Tags:** RBAC, auth, credentials, security
- **Related:** [ADR 0002 — ClickHouse Query Gateway](./0002-clickhouse-query-gateway.md) (depends on this), `docs/sso.md`, `docs/datagrip-connection.md`

> **Scope split:** this ADR specifies the **Personal Access Token** subsystem in
> isolation — it is the foundational credential. The feature that consumes PATs
> (letting native tools query ClickHouse through an app-enforced gateway) is
> [ADR 0002](./0002-clickhouse-query-gateway.md), which **depends on** this one.

---

## Context

CHouse UI authenticates browser sessions with short-lived **JWTs** (`jose`,
HS256) minted at interactive login (password or SSO). That works for the SPA but
not for **non-browser clients**: a native tool (DataGrip, a BI tool, a script,
the upcoming Query Gateway) needs a credential it can store in a static
"password"/header field, that is **long-lived but revocable**, **scoped**, and
**audited** — none of which a JWT refresh flow provides.

We need a first-class **Personal Access Token**: a user-minted, server-verified
bearer secret that carries that user's identity and a bounded subset of their
authority, with an enforced lifecycle.

This ADR delivers a **complete vertical slice**: data model + migration, service,
API, **RBAC permissions**, **audit/logging events**, and **UI** — so PATs are a
finished, governable feature, not just a table.

---

## Decision

Introduce **Personal Access Tokens** with these invariants:

1. **Bound to exactly one connection.** Every PAT targets a single ClickHouse
   connection the user may access; the binding is immutable for the token's life
   and is a security boundary (see ADR 0002 for why this also removes all
   connection-routing ambiguity for the gateway).
2. **Mandatory, bounded expiry — never infinite.** Requested TTL must fall within
   `[5 minutes (fixed floor), AUTH_PAT_MAX_TTL (admin max)]`.
3. **Capped per user.** At most `AUTH_PAT_MAX_PER_USER` *active* tokens per user.
4. **Never exceeds the user.** A PAT's effective authority is the **intersection**
   of the user's current permissions/data-access on the bound connection and the
   token's optional narrower scope. It can never grant more than the user has,
   and it follows the user — disable/demote the user and the token weakens or dies.
5. **Shown once, stored hashed, revocable immediately.**

---

## Data model & migration

New table **`rbac_personal_access_tokens`**:

| column | type | notes |
|--------|------|-------|
| `id` | text PK | = the public `tokenId` (indexed lookup, not secret) |
| `user_id` | text FK → `rbac_users.id` | `ON DELETE CASCADE` |
| `name` | text | user label, e.g. `datagrip-prod` |
| `secret_hash` | text | SHA-256 of the secret (see Verification) |
| `connection_id` | text FK → `clickhouse_connections.id` | **NOT NULL**, `ON DELETE CASCADE` |
| `scopes` | text (nullable) | optional narrower permission subset; null = inherit |
| `expires_at` | timestamp | **NOT NULL** — no infinite tokens |
| `last_used_at` | timestamp (nullable) | updated out-of-band (throttled) |
| `created_at` | timestamp | |
| `revoked_at` | timestamp (nullable) | set on revoke; non-null ⇒ inactive |
| `created_ip` | text (nullable) | provenance |

Indexes: PK on `id`; index on `user_id` (list + cap counting); index on
`connection_id` (cascade + admin views).

**Migration discipline (MANDATORY, per `CLAUDE.md`):** add the migration to
`rbac/db/migrations.ts` with a `VERSION_CHECKS` entry, and cover it in
`migrations.test.ts` on **both SQLite and PostgreSQL** (fresh + stepwise +
skip-version), idempotent / `IF NOT EXISTS`. No data migration (new table only).

---

## Token shape, storage & verification

```
chpat_<tokenId>_<secret>
        │          └── ≥32 bytes CSPRNG entropy (base62)
        └── public lookup id (indexed), NOT secret
```

- User pastes the **whole string** as the password/secret in their tool.
- **Store only** `tokenId` + **SHA-256(secret)**. Plaintext shown **once**.
- **Hashing choice:** the secret is high-entropy, so **SHA-256 + constant-time
  compare** is sufficient and fast. We deliberately avoid Argon2id here because a
  consumer (the gateway, ADR 0002) verifies a token on **every request** (hot
  path); slow hashing is only needed for low-entropy human passwords (those keep
  Argon2id).
- **Lookup:** O(1) by `tokenId`; then constant-time compare of the secret hash.
- **Cache:** short-lived (30–60 s) in-memory `tokenId → resolved identity`
  to avoid a DB hit per request; **invalidated on revoke** and on user
  disable/role change.

---

## Lifecycle, limits & configuration

- **Mint / list / revoke** via authenticated API + UI. Mint **requires** a
  connection and a TTL within bounds; **list never returns the secret**.
- **Expiry** rejected if outside `[5m, AUTH_PAT_MAX_TTL]`; defaults to
  `min(AUTH_PAT_DEFAULT_TTL, AUTH_PAT_MAX_TTL)` when omitted. Expired tokens are
  rejected at auth time and swept by a periodic job.
- **Per-user cap** counts *active* (non-expired, non-revoked) tokens; minting
  beyond `AUTH_PAT_MAX_PER_USER` is refused with "revoke one first".
- **Permission scope (optional):** narrow a PAT below the user's permissions on
  the connection (least privilege for read-only BI tools). Never widens.
- **Revocation** is immediate (cache TTL bounds the window). User disable/delete
  cascades to revoke all their PATs. An admin can revoke any user's PAT.

| YAML | Env | Default | Meaning |
|------|-----|---------|---------|
| — | — | `5m` (fixed floor) | Minimum TTL; not configurable. |
| `auth.pat.max_ttl` | `AUTH_PAT_MAX_TTL` | `90d` | Admin-allowed maximum TTL. |
| `auth.pat.default_ttl` | `AUTH_PAT_DEFAULT_TTL` | `30d` | TTL when unspecified (clamped to `[5m, max_ttl]`). |
| `auth.pat.max_per_user` | `AUTH_PAT_MAX_PER_USER` | `10` | Max active tokens per user. |

Durations accept `m`/`h`/`d`. **Validation is server-side** (authoritative); the
UI mirrors bounds but is never the only gate.

---

## RBAC / permission changes

New permission group **`Access Tokens`** (mirrors the `SSO Management` pattern in
`schema/base.ts` `PERMISSIONS`, `seed.ts` `PERMISSION_CATEGORIES` +
`PERMISSION_DISPLAY_NAMES`, and frontend `RBAC_PERMISSIONS`):

| Permission | Meaning |
|------------|---------|
| `pat:view` | See **your own** tokens (metadata only). |
| `pat:create` | Mint a token for **yourself** (only on connections you can access). |
| `pat:revoke` | Revoke **your own** tokens. |
| `pat:admin` | View/revoke **any user's** tokens; see PAT usage across the org. |

- **Self-service vs admin:** `pat:view|create|revoke` operate only on the
  caller's own tokens; `pat:admin` is the cross-user capability.
- **`DEFAULT_ROLE_PERMISSIONS` (`schema/base.ts`):** `super_admin` gets all
  (via `Object.values`). Grant self-service `pat:view|create|revoke` to roles
  that should reach native tools (proposed: `admin`, `developer`, `analyst`);
  withhold from `viewer`/`guest` by default. `pat:admin` → `admin` + `super_admin`.
- Seeding these new permissions is idempotent (`seedPermissions` upserts), but
  adding them to existing roles needs a small **grant migration** (data
  migration → requires the dedicated seed/transform test per `CLAUDE.md`).
- **Frontend:** add to `RBAC_PERMISSIONS` (`src/stores`) and gate the UI with
  `PermissionGuard`.

A PAT is **never** more powerful than the issuing user: at verification, the
effective grant = `user.currentPermissions ∩ pat.scopes` on the bound connection.

---

## Audit & logging events

Add to `AUDIT_ACTIONS` (`schema/base.ts`, `pat.*` namespace) and write via
`createAuditLogWithContext`; server logs use a `module: 'PAT'` tag (Pino), never
logging the secret:

| Action | When | Notes |
|--------|------|-------|
| `pat.create` | Token minted | details: `name`, `connectionId`, `expiresAt`, `scopes`; **never** the secret |
| `pat.revoke` | User revokes own token | resource = token id |
| `pat.admin_revoke` | Admin revokes another user's token | actor = admin, resource = token id + owner |
| `pat.use_failed` | Auth attempt with invalid/expired/revoked token | security signal; feeds rate-limit/alerting |
| `pat.expired_swept` | Sweep job expires tokens | batch summary (count) |

- `last_used_at` is updated on successful use (throttled write), but **routine
  successful use is audited by the consumer** (e.g. the gateway's `gateway.query`
  in ADR 0002) to avoid double-logging every query here.
- Repeated `pat.use_failed` for a token/user → lock + alert (abuse control).

---

## UI changes

**Preferences → Access Tokens** (new tab, gated on `pat:view`):

- **List** of the user's tokens: name, bound connection, created, expires
  (with "expires in N days" / expired badge), last used, status (active/revoked),
  and a **Revoke** action (gated on `pat:revoke`).
- **Create token** modal (gated on `pat:create`):
  - name; **connection picker** limited to connections the user can access;
  - **TTL picker** clamped to `[5m, AUTH_PAT_MAX_TTL]` with the default
    pre-filled; shows the resolved absolute expiry;
  - optional **scope** (e.g. read-only) — defaults to inherit;
  - on submit, **one-time secret reveal** with copy-to-clipboard and a clear
    "you won't see this again" warning; plus a one-click snippet / link to the
    [DataGrip guide](../datagrip-connection.md).
- **Empty / limit states:** explain the per-user cap; when at the cap, prompt to
  revoke before creating.

**Admin (gated on `pat:admin`):** a view (e.g. under Admin → Access Tokens, or a
column in User Management) listing tokens across users with revoke, and the
read-only effective limits (since they're config-only). Surfacing `pat.*` audit
events in the existing **Audit** screen comes for free via `AUDIT_ACTIONS`.

API client additions in `src/api/rbac.ts` (`patApi`: `list`, `create`, `revoke`;
admin: `listAll`, `adminRevoke`).

---

## API

Under the authenticated RBAC router (e.g. `rbac/routes/pat.ts`):

| Method | Path | Permission | Body / result |
|--------|------|-----------|---------------|
| `GET` | `/rbac/pat` | `pat:view` | list own tokens (no secrets) |
| `POST` | `/rbac/pat` | `pat:create` | `{ name, connectionId, ttl?, scopes? }` → `{ token (once), …meta }` |
| `DELETE` | `/rbac/pat/:id` | `pat:revoke` | revoke own token |
| `GET` | `/rbac/pat/admin` | `pat:admin` | list across users |
| `DELETE` | `/rbac/pat/admin/:id` | `pat:admin` | revoke any token |

Verification is exposed as an internal service function
(`verifyPersonalAccessToken(raw) → { user, connectionId, effectivePermissions } | null`)
consumed by ADR 0002, **not** a public endpoint.

---

## Security considerations

- **No plaintext at rest or in logs.** Only `SHA-256(secret)`; mint response is
  the sole disclosure.
- **Enumeration-safe:** public `tokenId` lookup + constant-time secret compare;
  uniform failure responses; rate-limit verification and alert on `pat.use_failed`.
- **Revocation window** bounded by the identity cache TTL; document it.
- **Blast radius** bounded by connection binding + optional scope + the user's own
  authority. A leaked PAT can do **no more than the user can, on one connection**.
- **Cascades:** user disable/delete and connection delete revoke dependent tokens.

---

## Implementation plan (phased)

1. **Data + service:** migration (+ both-dialect tests), mint/verify/list/revoke,
   SHA-256, identity cache + invalidation, sweep job.
2. **Permissions + audit:** new `pat:*` permissions, category, role grants (grant
   migration + test), `pat.*` audit actions.
3. **API + UI:** routes + `patApi`, Preferences → Access Tokens, admin view,
   PermissionGuards, tests (`src/api/*`, hooks, stores per `CLAUDE.md`).
4. **Docs + changelog:** user docs for tokens; changelog fragment.

---

## Consequences

- **Positive:** a reusable, governed credential unblocking ADR 0002 and any future
  programmatic access; least-privilege, revocable, audited, time-bounded.
- **Negative / accepted:** new secret material to manage; an identity cache that
  bounds revocation latency; small ongoing surface (sweep job, limits config).

---

## Alternatives considered

1. **Reuse JWT refresh tokens.** Rejected: not pasteable into a static password
   field, interactive issuance, coarse lifecycle, no per-connection scope.
2. **Per-connection ClickHouse-native passwords.** Rejected here: that's the
   "replicate users into ClickHouse" model ADR 0002 explicitly avoids.
3. **Infinite tokens with revoke-only.** Rejected: violates the bounded-lifetime
   requirement; long-lived secrets are a standing liability.

---

## Open questions

- Default PAT **permission scope**: inherit-all vs. require an explicit narrower
  subset (least-privilege-by-default)? (Connection binding itself is decided.)
- Should `analyst`/`developer` get `pat:create` by default, or is native access
  opt-in per deployment via role config?
