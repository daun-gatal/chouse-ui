type: minor

### Added
- **ClickHouse privilege check for connections** — Test connection checks the connection's ClickHouse user against what every feature needs (Core, Monitoring and fleet, Data health and observability, Query control, Data editing, ClickHouse access admin) and lists anything missing as copyable `GRANT` statements, with **Copy all grants** and **Check again**. Works on ClickHouse versions with and without `SHOW GRANTS FINAL`, and counts grants that come through roles.
- **ClickHouse privileges docs page** — generated from the same catalog, with a ready-made script for a user that has everything.

### Changed
- **Saving a connection requires every privilege** — Create, and an update that changes the host, port, user, password, SSL or default database, run the check on the server first and refuse to save (`422 PRIVILEGES_MISSING` with the report, `400 CONNECTION_TEST_FAILED` when the login fails). Existing connections keep working, and renames or switching a connection on or off are never checked.
- **Test on the connections list** warns when the connection's user is missing privileges.
- **Observability grants panel removed** from the connection edit dialog; Test connection covers it.
- **Moving a connection needs its password** — changing the host or port, or switching SSL off, asks for the password again (`400 PASSWORD_REQUIRED`), so the saved password is never sent to another server.

### Fixed
- **Test connection while editing** uses the saved password when the password field is empty, instead of failing.
- **Connection tests close their ClickHouse client** when the login fails.
