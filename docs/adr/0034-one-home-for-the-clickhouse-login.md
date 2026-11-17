# 0034 — One Home for a Connection's ClickHouse Login, and Any Kind at Creation

- **Status:** Accepted
- **Date:** 2026-11-17
- **Amends:** [0033](0033-every-statement-gets-a-clickhouse-identity.md) §5: who edits the login and where, how a connection of each kind is created, and the TLS rule for the stored password. [0027](0027-connection-privilege-check.md) §4–§5: a role-ceiling or personal connection is created with the checks for its kind, not with the shared-login catalog. Everything else in both stands.
- **Scope:** `rbac/services/connectionIdentity.ts`, `rbac/services/connections.ts`, `rbac/routes/connectionIdentity.ts`, `rbac/routes/connections.ts`; Admin › Connections (the connection panel); the connection switcher; docs. One PR, `patch`.

## Context

ADR 0033 gave a connection one of three kinds: shared login, role ceiling and
personal. On the last two, the stored ClickHouse login must be *empty*: no
grants of its own and no default roles. Three problems showed up once people
used it:

1. **Two places edit the same login.** The connection dialog edits host, port,
   TLS, user and password for a shared login (admins). The *ClickHouse login*
   panel edits them for every kind (super admins). The panel always showed an
   editable user and password, prefilled with the old user, so people read it
   as a second, different user.
2. **A role-ceiling or personal connection cannot be created directly.**
   `POST /connections` takes no kind and runs the full-privilege check, so the
   ClickHouse administrator had to create a user with every grant just to
   register the connection, then an empty user to switch to, then drop the
   first.
3. **Smaller faults found on the way:**
   - The default database could not be changed at all on a role-ceiling or
     personal connection.
   - A shared-login save could race a switch and land a full-privilege login
     on a role-ceiling row: PATCH reads the row, runs the slow check, then
     writes by id only.
   - The two paths had different rules for the stored password and TLS.
   - Nothing said that a new connection served nobody until roles were mapped
     or people linked.

## Decision

1. **The login has one home: the ClickHouse login tab** of a single
   connection panel, used for both create and edit. The panel has three tabs:
   - **General:** name, environment, active, default.
   - **ClickHouse login:** kind, host, port, TLS, user, password, default
     database, system role, impersonation role, access contact.
   - **Who can query:** the role map, the person links, or a summary of the
     data access policies.

   Each tab saves on its own. The panel replaces the edit dialog and the
   separate login and links panels, and their two row buttons go away. Every
   tab is shown to everyone who can open the panel, and what the viewer cannot
   change is read-only with the reason.
2. **The login tab is one plain form with Test and Save** (Create when new).
   - Test runs exactly the checks of Save for the selected kind, including the
     personal self-test, and saves nothing.
   - When the kind changes, one hint says what the kind needs. If the current
     user has grants, the hint names it and offers two paths: a new empty user
     (no downtime), or emptying the current user (queries fail until Save).
   - A script for the ClickHouse administrator is shown on request, built from
     the names in the form. It never contains the password.
3. **Two endpoints, one service, each with its own gate.**
   - Shared-to-shared edits keep `PATCH /connections/:id` (`connections:edit`).
   - Any edit on another kind, and any kind change, use
     `PUT /connections/:id/identity` (super admin, browser session, no scoped
     token).
   - New `POST /connections/identity` creates a role-ceiling or personal
     connection, and new `POST /connections/identity/check` runs its checks
     without saving. Both are super admin only.

   `POST /connections` without a kind is unchanged. All of these call one
   storage-free `verifyLoginForKind`, so create, Test and the switch cannot
   drift apart. No permission depends on a field in the request body.
4. **Create writes the final row in one insert.** All checks run first, then one
   insert stores the kind, role names, access contact and the fresh verdict.
   There is never a shared-login row with an empty login, nor a row with no
   verdict. An active connection with the same host, port, user and kind
   answers `409 CONNECTION_EXISTS`, so a retry after a timeout does not make a
   duplicate. A role-ceiling or personal login needs a password.
5. **Login writes are conditional.** PATCH (when it changes the login) and the
   switch write only if the row still has the kind, user and update time the
   checks started from. Otherwise they answer `409 CONNECTION_CHANGED`. The
   switch clears the stored verdict in the same write, and runs the
   login-reuse query again just before writing.
6. **One rule set for every path.**
   - **Stored password:** kept only for the same user, when host and port are
     unchanged and TLS is not turned off. Turning TLS on keeps it. A different
     user always needs its own password.
   - **Limits:** port 1–65535, password at most 1000 characters.
   - **Reuse:** one ClickHouse user on one server serves one kind, and shared
     logins are checked too (`400 LOGIN_REUSED`).
7. **The default database is part of the login** on every kind. It is edited on
   the login tab, checked with it, and follows the login's gate. Absent keeps
   it and empty clears it. On a personal connection it is the fallback when
   the person's own ClickHouse user has none.
8. **Readiness is computed, never stored.** `GET /connections` returns, per
   connection, who can query it: `ready`, `partial`, `none` or `refusing`. It
   is built from the role map, the links and the data access policies with
   grouped queries.
   - The list and the switcher show it.
   - A role-ceiling or personal connection nobody can query cannot be made the
     default (`409 CONNECTION_NOT_READY`).
   - Turning such a connection back on re-runs its checks at once, instead of
     refusing on a stale verdict for up to five minutes.
9. **Refused attempts are audited.** A refused create or switch writes an audit
   entry with `status: failure`, the kind, the user and the failed check id,
   never the password. A successful create records the kind, user, role names
   and server version.

## Consequences

- One ClickHouse user is enough to start a role-ceiling or personal
  connection. No throwaway full-privilege user is needed.
- Admins keep everything they could do before: create a shared login, and edit
  a shared login. They see the other kinds read-only.
- Scripts that call `POST /connections` or PATCH a shared login are unchanged.
  A scripted save that races a switch now gets a 409 instead of writing over it.
- Within a check's run, a write is refused if the row changed. Two people
  saving the same connection at once: the second is told to reload.
- The TLS rule is relaxed on the switch path: turning TLS on no longer asks for
  the password again. That is the safer direction.
- A refused super-admin attempt now leaves an audit entry, so a burst of
  refusals is visible.
- Personal connections still need a ClickHouse build that passes the self-test.
  The kind is greyed out, with the server's reason, everywhere else.

## Alternatives considered

- **Hide the login fields behind a "Replace login" toggle.** It fixes the
  confusion but keeps the throwaway user and the locked default database.
- **Extend `POST /connections` with an optional `identity` object.** The gate
  would depend on a field in the body (SECURITY.md §2). A separate super-admin
  route over the same service keeps one gate per route.
- **Reuse `PUT /:id/identity` for create.** It needs a saved row, and there is
  no state between "not created" and "shared" without a new column.
- **Create, then switch (or a multi-call wizard).** An abandoned flow leaves a
  shared row with an empty login that an admin can edit.
- **Named actions (Change password, Replace user, Change kind, Move server),
  CHouse-generated users with hashed scripts, and a two-password rotation.**
  Tried in the design. People found them harder to follow than one form.
  "Generate the user for me" can come back as an optional helper.
- **Role mappings in the create request.** Mapping a role makes it
  super-admin-only to assign across the whole install, even while the
  connection serves nobody, and there is no transaction on PostgreSQL here.
  Mapping is the first thing the panel shows after create instead.
- **A partial unique index for login reuse.** The rule (same host, port and
  user on a *different* kind) cannot be written as a unique index. The query
  runs again right before the write.
- **Create a new kind inactive until it is ready.** It mixes two meanings of
  "inactive" and adds a manual step. Readiness is shown instead.

## Verification

- **Server unit and route tests:**
  - TLS on keeps the password, TLS off asks for it;
  - the database is kept, set and cleared;
  - a race during the checks writes nothing and answers 409;
  - create writes one row with its verdict, and creates nothing on failure,
    without a password, or for a duplicate;
  - the id-less check reads no row;
  - readiness states;
  - PATCH: conflict 409, reuse 400, default refused when not ready,
    reactivation re-check, and the refusal message naming the login tab;
  - routes: super admin only, browser session only, a strict create body, and
    refusal audits with no password.
- **Real ClickHouse:** create and switch for each kind on the lab builds, and
  personal on the build that passes the self-test.
- **Real browser:** the panel at desktop and narrow widths, as a super admin
  and as an admin.
