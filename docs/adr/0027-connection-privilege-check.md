# 0027 — Save a Connection Only When Its ClickHouse User Has Every Privilege

- **Status:** Accepted
- **Date:** 2026-10-25
- **Amends:** [0016](0016-data-observability-platform.md) §1 (*Privileges*: "the save always succeeds") and the *Connections* row of §18
- **Scope:** `services/connectionPrivileges.ts`, the connection routes (`/api/rbac/connections` create, update and test), Admin › Connections, the docs. One PR.

## Context

CHouse UI reaches ClickHouse as the connection's user, so that user's grants are
the outer limit of every feature. Nothing told an administrator what the user
needed. A connection saved with a narrow user looked fine, and the gaps showed up
later and far from the cause: an empty explorer, a Monitoring tab with no data,
a Kill button that fails, collectors in `missing_privileges`, an error on the
ClickHouse users page.

ADR 0016 added a check for the collector's system tables, but only as a button
in the edit dialog, and decided that saving never fails on it, so least-privilege
connections that existed before 0016 kept working.

## Decision

1. **One catalog** (`PRIVILEGE_FEATURES`) lists what each feature needs: system
   tables it reads, and privileges on `*.*` or on the connection's default
   database (Core, Monitoring and fleet, Data health and observability, Query
   control, Data editing, ClickHouse access admin). The docs page
   *ClickHouse privileges* is generated from it.
2. **System tables are checked by reading them** (`SELECT * … LIMIT 0`), which is
   exact for grants inherited through roles and for partial revokes. A table the
   server doesn't have (`UNKNOWN_TABLE`, or one that needs config it lacks) is
   *not available* and doesn't count, except `system.query_log`, which every
   server creates lazily and is then checked from the grants.
3. **Other privileges are checked from `SHOW GRANTS`**, never by trying them.
   `SHOW GRANTS FINAL` folds in every role where the server supports it; older
   servers get `SHOW GRANTS FOR` each enabled role. `system.privileges` gives the
   privilege tree, so a parent (`ALL`, `ACCESS MANAGEMENT`, `ALTER`) covers its
   children, and a group ClickHouse prints as all of its children counts as
   held.
4. **Test connection returns the report**; **create and update refuse to save**
   until every feature passes: `400 CONNECTION_TEST_FAILED` when the login fails,
   `422 PRIVILEGES_MISSING` with the report in `error.details.privileges`
   otherwise. `error.message` carries the `GRANT` script too, for clients that
   only print it. There is no override.
5. **An update is checked only when it changes the login** (host, port, user,
   password, SSL, default database). Renames, the environment, active and
   default flags save as before, so existing connections are never blocked.
6. **The saved password only goes to the server it was saved for.** Testing
   while editing may use it (for a caller with `connections:edit`), and an
   update without a new password checks with it, but only against the saved
   host and port and never over HTTP when it was saved for HTTPS; otherwise the
   API answers `400 PASSWORD_REQUIRED`. A password that can't be decrypted any
   more (the encryption key changed) also asks for it again, and doesn't stop a
   rename.

## Consequences

- An administrator learns what is missing, with copyable `GRANT` statements, at
  the moment they add the connection instead of from a broken screen later.
- A deliberately narrow user (read-only analytics, monitoring only) can no
  longer be saved as a connection. This is the trade-off asked for: every
  CHouse UI feature must work on every connection. Such a connection already
  saved keeps working until its login is changed.
- Saving takes one round of read-only queries (~50, eight at a time, usually
  under a second).
- 0016's collector `missing_privileges` state stays: a grant revoked after
  saving still degrades only the collectors that need it.
- The Observability grants panel in the edit dialog is gone; Test connection
  covers it. `POST /api/observe/privileges/check` keeps its response shape and
  now reports from the same check.

## Alternatives considered

- **Warn and allow "Save anyway"** — keeps narrow connections possible, but the
  request was that a saved connection supports every feature.
- **Parse `SHOW GRANTS` for system tables too** — misses tables ClickHouse lets
  everyone read and grants that come through roles on old servers; reading the
  table is exact and costs nothing.
- **Try privileged statements in a dry-run** (`KILL QUERY … TEST`, `CREATE …`)
  — ClickHouse has no dry-run that checks access first for all of them, and a
  real statement could change the server.
