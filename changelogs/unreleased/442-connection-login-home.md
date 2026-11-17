type: patch

### Changed
- **One place for a connection's ClickHouse login** — a connection opens in one panel with **General**, **ClickHouse login** and **Who can query** tabs, and the separate *ClickHouse login* and *Linked ClickHouse users* buttons are gone. The login tab is one form (kind, host, port, TLS, user, password, default database, roles, access contact) with **Test**, which checks without saving, and **Save**. Changing the kind shows one hint that says what the kind needs, and the script for the ClickHouse administrator never contains the password.
- **Create a role-ceiling or personal connection directly** — choose the kind when creating; one ClickHouse user with no grants of its own is enough, and the same checks as a switch run first. **Who can query** opens next to map roles or link people.
- **Who can query** column in Admin › Connections and in the connection switcher: whether everyone a connection is meant for can use it, and for a person whose role isn't mapped, why and whom to ask.

### Fixed
- The default database can be changed on role-ceiling and personal connections, and cleared on any connection.
- A shared-login save that ran while a super admin switched the connection's kind could store a full-privilege login on the switched connection; login saves now apply only if the connection did not change meanwhile.
- The stored password and TLS rule, port and password limits, and the "one ClickHouse user per kind" check are the same everywhere the login is saved.
- A role-ceiling or personal connection nobody can query yet can no longer be made the default, and one turned back on is checked at once instead of being refused for up to five minutes.
- Refused attempts to create or switch a role-ceiling or personal connection are recorded in the audit log.
- **Security:** server dependencies `hono` (4.13.13 → 4.13.19) and `@hono/node-server` (2.1.3 → 2.1.8) are updated, clearing the 6 medium and 1 low findings Artifact Hub's Trivy scan reports for image 3.18.0 (CVE-2026-126210, CVE-2026-126343, CVE-2026-126355 to CVE-2026-126359).
