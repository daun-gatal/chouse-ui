type: minor

### Added
- **Role ceiling for connections** — a connection can now limit each person to a ClickHouse role. The connection's ClickHouse user holds no grant of its own; a super admin maps each CHouse role to one ClickHouse role, and every statement is sent with the role of the person it is for, so ClickHouse itself refuses anything outside it, for administrators too. CHouse UI's own background work uses a separate system role. Needs ClickHouse 24.4 or newer. Existing connections stay shared logins and behave as before.
- **Identity checks** — before a connection is switched, and every five minutes after, CHouse UI checks that its ClickHouse user is empty, that its roles cannot manage or become other users, that a request naming no role reads nothing, and that no other connection of a different kind uses the same user. A connection that fails, or was last checked more than 15 minutes ago, refuses every request and says why.
- **Access contact** — an optional line per connection, shown when ClickHouse refuses someone, saying whom to ask for access.
- **Identity panel in Admin › Connections** (super admin) — shows a connection's kind, health and role map, the statements for the ClickHouse administrator, and checks a new login before saving it.

### Changed
- **Only a super admin assigns a mapped role** — a CHouse role that is mapped to a ClickHouse role on any connection can be assigned only by a super admin. The same holds for changing an account that holds such a role or resetting its password, and for changing which role SSO assigns once any role is mapped.
- **Login changes on a role-ceiling connection go through the Identity panel** — host, port, TLS, user and password of such a connection can no longer be changed in the edit dialog.
- **ClickHouse users and roles are unavailable on a role-ceiling connection** — its login may not manage users.
- **The privilege report is per kind** — on a role-ceiling connection it checks the system role, and marks data editing as coming from each person's role.
