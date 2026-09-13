# Permission catalog

Every permission string in CHouse UI, grouped by area. Permissions are checked on each request; tabs and actions are shown only when the current user holds the required grant.

## User management

| Permission | Grants |
| --- | --- |
| `users:view` | List users |
| `users:create` | Create users |
| `users:update` | Edit users |
| `users:delete` | Delete users |

## Role management

| Permission | Grants |
| --- | --- |
| `roles:view` / `roles:create` / `roles:update` / `roles:delete` | Manage roles |
| `roles:assign` | Assign roles to users |

## Data access

| Permission | Grants |
| --- | --- |
| `data_access:view` | View data access rules |
| `data_access:create` / `update` / `delete` | Manage rules |
| `data_access:assign` | Assign rules to subjects |

## ClickHouse user management

| Permission | Grants |
| --- | --- |
| `clickhouse:users:view` / `create` / `update` / `delete` | Manage native ClickHouse users |
| `clickhouse:roles:view` / `create` / `update` / `delete` / `assign` | Manage native ClickHouse roles |

## Connections

| Permission | Grants |
| --- | --- |
| `connections:view` | List connections |
| `connections:edit` | Add/edit connections |
| `connections:delete` | Remove connections |

## Explorer / database & tables

| Permission | Grants |
| --- | --- |
| `database:view` / `create` / `drop` | Inspect / create / drop databases |
| `table:view` / `create` / `alter` / `drop` | Table lifecycle |
| `table:select` / `insert` / `update` / `delete` | Row-level DML |

## Queries

| Permission | Grants |
| --- | --- |
| `query:execute` | Run queries |
| `query:execute:ddl` | Run DDL |
| `query:execute:dml` | Run DML |
| `query:history:view` | View own query history |
| `query:history:view:all` | View all users' history |

## Saved queries

| Permission | Grants |
| --- | --- |
| `saved_queries:view` / `create` / `update` / `delete` | Manage saved queries |
| `saved_queries:share` | Share saved queries |

## Monitoring (per-tab view grants)

| Permission | Tab |
| --- | --- |
| `metrics:view` / `metrics:view:advanced` | Metrics (advanced for the deeper tabs) |
| `logs:view` | Query logs |
| `parts:view` | Parts |
| `schema_advisor:view` | Schema advisor |
| `cluster:view` | Cluster activity |
| `errors:view` | Errors |
| `live_queries:view` | Live queries |
| `live_queries:kill` | Kill a query |
| `live_queries:kill_all` | Kill all queries |

## Fleet & Chouse AI

| Permission | Grants |
| --- | --- |
| `fleet:view` | Fleet view |
| `doctor:view` | View Fleet Doctor reports |
| `doctor:run` | Trigger scans / manage schedules |
| `ai:optimize` | In-tab Optimize / Fix / Diagnose |
| `ai:chat` | AI chat assistant |
| `ai_models:view` / `create` / `update` / `delete` | Manage AI providers/models |

## System & settings

| Permission | Grants |
| --- | --- |
| `settings:view` / `settings:update` | App settings |
| `audit:view` / `audit:export` / `audit:delete` | Audit log |
| `sso:view` / `sso:edit` / `sso:delete` | SSO admin |
| `alerting:view` / `alerting:edit` / `alerting:delete` | Alerting config |
| `scheduled_queries:view` / `edit` / `delete` | Scheduled queries |

## How roles map to permissions

Roles bundle permissions; Super Admin holds all. To see effective grants for a role, open **Admin → Roles**. Custom roles can mix any of the above — see [Users & roles](/docs/rbac-roles/).
