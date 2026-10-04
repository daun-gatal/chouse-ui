---
app: Admin › ClickHouse users and Admin › ClickHouse roles
route: /admin/clickhouse-users
permissions: clickhouse:users:view, clickhouse:roles:view
---
# ClickHouse users & roles

These two Admin tabs manage **real ClickHouse accounts and roles** on the active connection — the ones ClickHouse itself authenticates — with native `GRANT`s. They are separate from CHouse UI's own [users and roles](/docs/rbac-roles/), which control the web interface.

Use them when people or services connect to ClickHouse directly (BI tools, applications, `clickhouse-client`) and you want to manage those accounts from one place.

> **Note:** Changes run as the active connection's ClickHouse user, so that user needs access-management rights in ClickHouse (`access_management` or the matching `GRANT`s). Users and roles defined in ClickHouse's XML/YAML config show as **Managed in ClickHouse config (read-only)** and can't be edited here.

## ClickHouse users

**Admin › ClickHouse users** (`/admin/clickhouse-users`) lists each user with its roles, authentication type and allowed hosts.

### Create a user

1. **Create user** (needs `clickhouse:users:create`).
2. **Username** — starts with a letter or underscore; letters, numbers and underscores.
3. **Authentication** — *SHA-256 password*, *double SHA-1 password*, *bcrypt password*, *plaintext password* or *no password*. **Generate** creates a strong password.
4. **Cluster** — pick a cluster to create the user on every node (`ON CLUSTER`), or *No cluster* for a single node.
5. Optionally restrict where it may connect from: **Host IP** (e.g. `10.0.0.0/8`) or **Host name**.
6. **Assign roles** — at least one ClickHouse role, and which of them are **default roles** (active at login).
7. Review the summary and create.

Edit a user to change its password, hosts or roles; delete drops it in ClickHouse and can't be undone. **Sync grants to role** copies a user's direct grants into a new role (named `<user>_role` by default) and switches the user to role-based grants, so access is managed in one place.

## ClickHouse roles

**Admin › ClickHouse roles** (`/admin/clickhouse-roles`) lists each role with where it is stored, its grants and who it is assigned to.

### Create a role

1. **Create role** (needs `clickhouse:roles:create`).
2. **Role name**, and optionally a **Cluster** to apply the DDL across.
3. **Privileges** — pick from the privilege tree (search it, or choose *ALL*), and tick **Grant option** to let holders grant them on.
4. **Databases & tables** — where those privileges apply: *All databases (`*.*`)*, specific databases or tables, or other scopes by name or prefix.
5. Review and create.

**Disable** a role to revoke its grants without losing them: CHouse UI stashes the grants and revokes them; **enable** restores them. Deleting a role drops it, and users who had it lose its privileges.
