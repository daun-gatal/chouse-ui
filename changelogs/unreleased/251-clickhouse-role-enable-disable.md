type: minor

### Added
- **Enable/disable ClickHouse roles** — a reversible alternative to deleting. Disabling a role stashes its grants and revokes them in ClickHouse (the role stays defined and assigned, but grants nothing); enabling restores them exactly. Backed by a new `rbac_clickhouse_role_state` table, scoped per connection. Disabled roles are flagged in the list, and editing is locked until re-enabled.
