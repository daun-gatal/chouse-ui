# Users & roles

CHouse UI has its own permission system — separate from ClickHouse's user system — that controls who can use the web interface and what they can do there. Manage it under **Admin → Users** (requires `users:view`).

## Two separate things

1. **CHouse UI RBAC** (the web interface): controls who can use CHouse UI and what they can do. Stored in CHouse UI's own database (SQLite or PostgreSQL). Every query is checked against these permissions before it reaches ClickHouse.
2. **ClickHouse user management** (optional feature): CHouse UI can create real ClickHouse users with native grants. These are actual ClickHouse users — see [ClickHouse users & roles](#clickhouse-user-management).

## Built-in roles

| Role | Description | Key permissions |
| --- | --- | --- |
| **Super Admin** | Full system access | All permissions |
| **Admin** | Server management | Users, roles, connections |
| **Developer** | Write access | Insert, update, DDL |
| **Analyst** | Read access | Select, export |
| **Viewer** | Read-only | Select only |
| **Guest** | Read-only access | View all tabs, read-only queries, system tables access |

Roles are seeded on first run by migrations (see [Migrations & upgrades](/docs/migrations-upgrades/)). The initial admin account gets Super Admin.

## Creating and editing users

1. **Admin → Users → Create user** (requires `users:create`).
2. Set email, username, password (hashed with Argon2id), role and active state.
3. Optionally attach [data access rules](/docs/data-access-rules/) at the user level.
4. Edit existing users at `/admin/users/edit/:userId` (requires `users:update`).

> **Tip:** Prefer assigning broad access at the role level and narrow exceptions at the user level — rules compose, with deny always winning (see [Data access rules](/docs/data-access-rules/)).

## ClickHouse user management

A separate admin tab — **Admin → ClickHouse users** (`clickhouse:users:view`) — manages actual ClickHouse accounts:

- **ClickHouse users**: create real ClickHouse users with native grants (Developer/Analyst/Viewer templates)
- **ClickHouse roles**: manage native ClickHouse roles and grant assignment (`clickhouse:roles:*`)

Use this when you want ClickHouse-side identity to mirror your team — CHouse UI proxies queries with the connection's credentials either way.
