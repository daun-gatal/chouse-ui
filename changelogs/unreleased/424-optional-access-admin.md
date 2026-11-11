type: patch

### Changed
- **Connections save without ClickHouse access management** — a connection whose ClickHouse user lacks `CREATE USER`, `ALTER USER`, `DROP USER`, `CREATE ROLE`, `ALTER ROLE`, `DROP ROLE`, `ROLE ADMIN` (or reading `system.users`, `system.roles`, `system.grants`, `system.role_grants`) is now saved with a warning instead of being refused. Those grants only power Admin › ClickHouse users and roles, which say the connection's user isn't allowed (`403 CLICKHOUSE_ACCESS_DENIED`) until they are granted. In the privilege report, `ok` now means every *required* feature passes; the new `complete` means every feature does (ADR 0031).
