type: patch

### Changed
- **Connections save without ClickHouse access management** — a connection whose ClickHouse user lacks `CREATE USER`, `ALTER USER`, `DROP USER`, `CREATE ROLE`, `ALTER ROLE`, `DROP ROLE`, `ROLE ADMIN` (or reading `system.users`, `system.roles`, `system.grants`, `system.role_grants`) is now saved with a warning instead of being refused. Those grants only power Admin › ClickHouse users and roles, which say the connection's user isn't allowed (`403 CLICKHOUSE_ACCESS_DENIED`) until they are granted. In the privilege report, `ok` now means every *required* feature passes; the new `complete` means every feature does (ADR 0031).

### Added
- **Other databases in Test connection** — data editing is only checked on the connection's default database, so the privilege report now also lists, for information, what the user can do in each other database (query all or some tables, change tables or not) with the `GRANT` statements for full access. It never blocks a save.
