# 0031 — ClickHouse Access Admin Is Optional When Saving a Connection

- **Status:** Accepted
- **Date:** 2026-11-11
- **Amends:** [0027](0027-connection-privilege-check.md) §4 ("create and update refuse to save until every feature passes … There is no override")
- **Scope:** `services/connectionPrivileges.ts`, the connection routes (`/api/rbac/connections` create and update), Admin › Connections, the docs. One PR.

## Context

ADR 0027 refuses to save a connection until its ClickHouse user holds every
privilege on the catalog. One group of that catalog, *ClickHouse access admin*,
asks for `CREATE USER, ALTER USER, DROP USER, CREATE ROLE, ALTER ROLE, DROP ROLE,
ROLE ADMIN ON *.*` and `SELECT` on `system.users`, `system.roles`,
`system.grants` and `system.role_grants`.

Only Admin › ClickHouse users and Admin › ClickHouse roles use them, along
with the AI and MCP tools that call the same routes (`list_clickhouse_users`,
`list_clickhouse_roles`, `create_clickhouse_role`, `update_clickhouse_role`).
They are also the most sensitive grants on the list: a user that holds them
can create another user with any privilege it has. Many teams will not give a UI's
service account that power, so they could not add a connection at all, even
though every other feature would work.

## Decision

1. **A catalog feature is either required or optional.** `PRIVILEGE_FEATURES`
   gains `required: boolean`. *ClickHouse access admin* is optional; every
   other feature stays required.
2. **Only required features block a save.** The report's `ok` now means
   "every required feature is granted", so the save gate in
   `verifyBeforeSave` is unchanged. A failure in an optional feature, whether
   a missing grant or a single table check that errored, never blocks. A
   failure of the check as a whole (`SHOW GRANTS` itself fails) still refuses
   the save, as in 0027: nothing has been checked.
3. **The report tells the two apart.** Each feature carries `required`. The
   report adds `complete` (every feature granted), keeps `missingCount` and
   `grantScript` for required features only (what must be run before saving),
   and adds `optionalMissingCount` and `optionalGrantScript`. A
   `422 PRIVILEGES_MISSING` message lists only the required grants.
4. **A save with optional features missing succeeds and warns.** Create and
   update return the check's report as `data.privileges` whenever the check
   ran (an update that doesn't touch the login runs no check and returns
   none, which means "not checked", not "fine"). Admin › Connections shows a
   warning toast naming what won't work. Test connection, and Test on a row
   of the connection list, warn the same way; the report marks the feature
   *Optional*, in amber, with its own grants to copy. The report's
   "Copy all grants" copies only the required grants.
5. **The ClickHouse users and roles routes answer a ClickHouse access denial
   with `403 CLICKHOUSE_ACCESS_DENIED`** and a message pointing at Test
   connection, instead of a `500` with the raw server text, since a saved
   connection may now lack those grants.
6. Everything else in 0027 stands: the check itself, when an update is
   checked, and the saved-password rule.

## Consequences

- A connection whose user has no access-management privileges can be saved.
  Its ClickHouse users and roles pages, and the AI tools above, answer
  `403 CLICKHOUSE_ACCESS_DENIED` until the grants are added.
- A user granted only part of the group (it can read `system.users` but not
  `system.grants`, say) is a supported saved state now. The users and roles
  lists read grant and role counts best-effort, so they show those counts as
  zero instead of failing; the save-time warning already named the missing
  table. Revoking a grant after saving could reach the same state before.
- `ok` changes meaning for API clients from "every feature" to "every required
  feature"; `complete` carries the old meaning. Readers in this repository:
  the connection dialog and list, and `chouse connection test` in the CLI,
  which prints the response as it is. Scripts on a personal access token that
  read `ok` see the new meaning; the release note says so.
- Nothing else reads these grants: the session's ClickHouse admin probe that
  read `system.grants` was removed in #423 (issue #422), so CHouse UI
  authorises only from its own RBAC.

## Alternatives considered

- **"Save anyway" for any missing feature** — rejected again for the reasons
  in 0027: a saved connection should support every feature that matters for
  the people using it. Access admin is the one group whose absence leaves the
  rest of the product working.
- **Drop access admin from the check entirely** — the administrator would then
  learn about the missing grants only from an error on the users page; the
  warning keeps the grants visible at the moment they set the connection up.
- **Make the optional set configurable** — no request for it; a per-install
  switch adds a setting to document and test for one feature group.
