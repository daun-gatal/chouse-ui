---
generated: packages/server/src/rbac/schema/base.ts and rbac/services/seed.ts
---
Every permission in CHouse UI, grouped the way **Admin › Roles** groups them, with the built-in roles that hold it by default. The server checks the permission on every API, MCP and CLI request; the app hides what the signed-in user cannot use.

> **Note:** A permission opens a feature, not data. Which databases and tables a user can touch is decided separately by [data access rules](/docs/data-access-rules/), and ClickHouse still enforces the grants of the connection's own user.

## Built-in roles

| Role | ID | For | Permissions |
| --- | --- | --- | --- |
| Super Administrator | `super_admin` | Full system access with all permissions | 106 |
| Administrator | `admin` | User management and full ClickHouse access | 92 |
| Developer | `developer` | DDL and DML access for development | 38 |
| Analyst | `analyst` | Read/write access for data analysis | 24 |
| Viewer | `viewer` | Read-only access to data | 14 |
| Guest | `guest` | Read-only access to all tabs and data | 20 |

Built-in roles can't be deleted, and only a super admin can change their permissions — the ticks below are the defaults a fresh install starts with. Create your own roles in **Admin › Roles** from any mix of the permissions below — see [Users & roles](/docs/rbac-roles/).

## User Management

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `users:view` | View Users | ✓ | ✓ |   |   |   | ✓ |
| `users:create` | Create Users | ✓ | ✓ |   |   |   |   |
| `users:update` | Update Users | ✓ | ✓ |   |   |   |   |
| `users:delete` | Delete Users | ✓ | ✓ |   |   |   |   |

## Role Management

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `roles:view` | View Roles | ✓ | ✓ |   |   |   | ✓ |
| `roles:create` | Create Roles | ✓ |   |   |   |   |   |
| `roles:update` | Update Roles | ✓ |   |   |   |   |   |
| `roles:delete` | Delete Roles | ✓ |   |   |   |   |   |
| `roles:assign` | Assign Roles | ✓ | ✓ |   |   |   |   |

## Data Access Policies

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `data_access:view` | View Data Access Policies | ✓ | ✓ |   |   |   | ✓ |
| `data_access:create` | Create Data Access Policies | ✓ | ✓ |   |   |   |   |
| `data_access:update` | Update Data Access Policies | ✓ | ✓ |   |   |   |   |
| `data_access:delete` | Delete Data Access Policies | ✓ | ✓ |   |   |   |   |
| `data_access:assign` | Assign Data Access Policies to Roles | ✓ | ✓ |   |   |   |   |

## ClickHouse Users

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `clickhouse:users:view` | View ClickHouse Users | ✓ | ✓ |   |   |   | ✓ |
| `clickhouse:users:create` | Create ClickHouse Users | ✓ | ✓ |   |   |   |   |
| `clickhouse:users:update` | Update ClickHouse Users | ✓ | ✓ |   |   |   |   |
| `clickhouse:users:delete` | Delete ClickHouse Users | ✓ | ✓ |   |   |   |   |

## ClickHouse Roles

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `clickhouse:roles:view` |   | ✓ | ✓ |   |   |   | ✓ |
| `clickhouse:roles:create` |   | ✓ | ✓ |   |   |   |   |
| `clickhouse:roles:update` |   | ✓ | ✓ |   |   |   |   |
| `clickhouse:roles:delete` |   | ✓ | ✓ |   |   |   |   |
| `clickhouse:roles:assign` |   | ✓ | ✓ |   |   |   |   |

## Database Operations

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `database:view` | View Databases | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `database:create` | Create Databases | ✓ | ✓ | ✓ |   |   |   |
| `database:drop` | Drop Databases | ✓ | ✓ | ✓ |   |   |   |

## Table Operations

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `table:view` | View Tables | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `table:create` | Create Tables | ✓ | ✓ | ✓ |   |   |   |
| `table:alter` | Alter Tables | ✓ | ✓ | ✓ |   |   |   |
| `table:drop` | Drop Tables | ✓ | ✓ | ✓ |   |   |   |
| `table:select` | Select from Tables | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `table:insert` | Insert into Tables | ✓ | ✓ | ✓ | ✓ |   |   |
| `table:update` | Update Tables | ✓ | ✓ | ✓ | ✓ |   |   |
| `table:delete` | Delete from Tables | ✓ | ✓ | ✓ | ✓ |   |   |

## Query Operations

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `query:execute` | Execute Queries | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `query:execute:ddl` | Execute DDL Queries | ✓ | ✓ | ✓ |   |   |   |
| `query:execute:dml` | Execute DML Queries | ✓ | ✓ | ✓ | ✓ |   |   |
| `query:execute:misc` | Execute Misc Queries (SHOW, DESCRIBE) | ✓ | ✓ | ✓ | ✓ |   |   |
| `query:history:view` | View Own Query History | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `query:history:view:all` | View All Query History | ✓ | ✓ |   |   |   |   |

## Saved Queries

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `saved_queries:view` | View Saved Queries | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `saved_queries:create` | Create Saved Queries | ✓ | ✓ | ✓ | ✓ |   |   |
| `saved_queries:update` | Update Saved Queries | ✓ | ✓ | ✓ | ✓ |   |   |
| `saved_queries:delete` | Delete Saved Queries | ✓ | ✓ | ✓ | ✓ |   |   |
| `saved_queries:share` | Share Saved Queries | ✓ | ✓ |   |   |   |   |

## Metrics & Monitoring

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `metrics:view` | View Metrics | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `metrics:view:advanced` | View Advanced Metrics | ✓ | ✓ |   |   |   | ✓ |
| `logs:view` | View Query Logs | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `parts:view` | View Parts & Partitions | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `schema_advisor:view` | View Schema Advisor | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `cluster:view` | View Cluster | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `errors:view` | View Errors | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## Fleet Monitoring

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `fleet:view` | View Fleet | ✓ |   |   |   |   |   |
| `doctor:view` | View Chouse AI Doctor | ✓ |   |   |   |   |   |
| `doctor:run` | Run Chouse AI Doctor Scan | ✓ |   |   |   |   |   |

## Settings

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `settings:view` | View Settings | ✓ | ✓ |   |   |   | ✓ |
| `settings:update` | Update Settings | ✓ | ✓ |   |   |   |   |

## Audit

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `audit:view` | View Audit Logs | ✓ | ✓ |   |   |   | ✓ |
| `audit:export` | Export Audit Logs | ✓ |   |   |   |   |   |
| `audit:delete` | Delete Audit Logs | ✓ |   |   |   |   |   |

## Live Query Management

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `live_queries:view` | View Live Queries | ✓ | ✓ |   |   |   |   |
| `live_queries:kill` | Kill Own Live Queries | ✓ | ✓ |   |   |   |   |
| `live_queries:kill_all` | Kill All Live Queries | ✓ | ✓ |   |   |   |   |

## Connection Management

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `connections:view` | View Connections | ✓ |   |   |   |   |   |
| `connections:edit` | Edit Connections | ✓ |   |   |   |   |   |
| `connections:delete` | Delete Connections | ✓ |   |   |   |   |   |

## AI Assistant

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ai:optimize` | AI Query Optimization | ✓ | ✓ | ✓ | ✓ |   |   |
| `ai:chat` | AI Chat Assistant | ✓ | ✓ | ✓ | ✓ |   |   |

## AI Models Management

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ai_models:view` | View AI Models | ✓ | ✓ |   |   |   |   |
| `ai_models:create` | Create AI Models | ✓ | ✓ |   |   |   |   |
| `ai_models:update` | Update AI Models | ✓ | ✓ |   |   |   |   |
| `ai_models:delete` | Delete AI Models | ✓ | ✓ |   |   |   |   |

## AI Agents

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ai_agents:view` | View AI Agents | ✓ | ✓ |   |   |   |   |
| `ai_agents:manage` | Manage AI Agents, Harnesses and Skills | ✓ | ✓ |   |   |   |   |

## SSO Management

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sso:view` | View SSO Configuration | ✓ | ✓ |   |   |   |   |
| `sso:edit` | Edit SSO Configuration | ✓ |   |   |   |   |   |
| `sso:delete` | Delete SSO Providers | ✓ |   |   |   |   |   |

## Alerting

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `alerting:view` | View Alerting Configuration | ✓ | ✓ |   |   |   |   |
| `alerting:edit` | Edit Alerting Configuration | ✓ | ✓ |   |   |   |   |
| `alerting:delete` | Delete Alerting Configuration | ✓ |   |   |   |   |   |

## Scheduled Queries

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `scheduled_queries:view` | View Scheduled Queries | ✓ | ✓ |   |   |   |   |
| `scheduled_queries:edit` | Create and Edit Scheduled Queries | ✓ | ✓ |   |   |   |   |
| `scheduled_queries:delete` | Delete Scheduled Queries | ✓ | ✓ |   |   |   |   |
| `scheduled_queries:run` | Manually Run Scheduled Queries | ✓ | ✓ |   |   |   |   |
| `scheduled_queries:write` | Create Materialize Scheduled Queries | ✓ | ✓ |   |   |   |   |
| `scheduled_queries:view_all` | View and Act on All Scheduled Queries | ✓ | ✓ |   |   |   |   |

## Data Health

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `data_health:view` | View Data Health | ✓ | ✓ |   |   |   |   |
| `data_health:edit` | Create and Edit Data Health Promises | ✓ | ✓ |   |   |   |   |
| `data_health:delete` | Delete Data Health Promises | ✓ | ✓ |   |   |   |   |
| `data_health:run` | Manually Run Data Health Promises | ✓ | ✓ |   |   |   |   |
| `data_health:view_all` | View and Act on All Data Health Promises | ✓ | ✓ |   |   |   |   |

## Data Observability

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `observe:view` | View Data Observability | ✓ | ✓ | ✓ | ✓ | ✓ |   |
| `observe:edit` | Accept Monitoring Suggestions and Pin Criticality | ✓ | ✓ | ✓ |   |   |   |
| `context:edit` | Edit Table Context and Metrics | ✓ | ✓ | ✓ |   |   |   |
| `schema:override` | Run Schema Changes That Break Dependents | ✓ | ✓ |   |   |   |   |
| `notebooks:edit` | Add Cells to Investigation Notebooks | ✓ | ✓ | ✓ |   |   |   |

## Performance & Capacity

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `performance:view` | View Query Performance | ✓ | ✓ | ✓ | ✓ | ✓ |   |
| `capacity:view` | View Capacity | ✓ | ✓ | ✓ |   |   |   |
| `cost:view` | View Cost | ✓ | ✓ | ✓ |   |   |   |
| `upgrades:view` | View Upgrade Readiness | ✓ | ✓ | ✓ |   |   |   |
| `upgrades:run` | Run Upgrade Replays and Codec Trials | ✓ | ✓ |   |   |   |   |

## Remediation

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `remediation:propose` | Propose Remediation Actions | ✓ | ✓ | ✓ |   |   |   |
| `remediation:approve` | Approve Remediation Actions | ✓ | ✓ |   |   |   |   |
| `remediation:approve_high` | Approve High-Risk Remediation Actions | ✓ | ✓ |   |   |   |   |

## Agents

| Permission | Allows | Super Admin | Admin | Developer | Analyst | Viewer | Guest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `agents:view` | View Agent Activity | ✓ | ✓ | ✓ |   |   |   |
| `agents:manage` | Manage Agent Policies | ✓ | ✓ |   |   |   |   |
