type: minor

### Added
- **Native ClickHouse role management** — a new "ClickHouse roles" admin tab to create and edit native ClickHouse roles (`CREATE ROLE` + `GRANT`) with a full privilege editor covering database/table/global scope, column-level grants and `WITH GRANT OPTION`. Edits are reconciled diff-based, issuing only the `GRANT`/`REVOKE` statements that changed.
- **Role assignment for ClickHouse users** — users are now created/edited by assigning native roles and default roles (plus optional direct grants), reading state directly from ClickHouse `system.*` tables.
- **Extract to role** — turn a legacy user's direct grants into a reusable role and re-point the user at it in one action.

### Changed
- **ClickHouse user management reworked** — the previous fixed `developer`/`analyst`/`viewer` model (which wrote grants directly to users and cached them locally) is replaced; ClickHouse is now the source of truth. New `clickhouse:roles:*` permissions gate the role UI and are granted automatically to roles that already manage ClickHouse users.

### Removed
- **Legacy ClickHouse user metadata cache** — the `rbac_clickhouse_users_metadata` table is dropped; user/role/grant state is read live from ClickHouse.
