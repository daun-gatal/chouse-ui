---
app: Admin
route: /admin
---
# Admin overview

**Admin** is where administrators manage who can do what, which ClickHouse servers CHouse UI talks to, and the integrations it uses. Each tab appears only for users with its permission; the Admin entry in the dock appears when you have any of them.

| Group | Tab | Route | Opens with | Docs |
| --- | --- | --- | --- | --- |
| Access control | **Users** | `/admin/users` | `users:view` or `users:create` | [Users & roles](/docs/rbac-roles/) |
| | **Roles** | `/admin/roles` | `roles:view` | [Users & roles](/docs/rbac-roles/#roles) |
| | **Data access** | `/admin/data-access` | `data_access:view` | [Data access rules](/docs/data-access-rules/) |
| CH Management | **Connections** | `/admin/connections` | `connections:view` | [Connections](/docs/connections/) |
| | **ClickHouse users** | `/admin/clickhouse-users` | `clickhouse:users:view` | [ClickHouse users & roles](/docs/clickhouse-users-roles/) |
| | **ClickHouse roles** | `/admin/clickhouse-roles` | `clickhouse:roles:view` | [ClickHouse users & roles](/docs/clickhouse-users-roles/#clickhouse-roles) |
| Intelligence | **AI models** | `/admin/ai-models` | `ai_models:view` | [AI models](/docs/ai-models/) |
| Security | **SSO** | `/admin/sso` | `sso:view` | [Single sign-on](/docs/sso/) |
| | **Audit logs** | `/admin/audit` | `audit:view` | [Audit logging](/docs/audit-log/) |
| Settings | **Alerting** | `/admin/alerting` | `alerting:view` | [Alerting](/docs/alerting/) |

Viewing a tab and changing things in it are separate permissions — for example `connections:view` to see connections, `connections:edit` to add or change one. The [permission catalog](/docs/permissions/) lists them all.

## Settings that live elsewhere

Not everything an administrator configures is under Admin:

| Setting | Where |
| --- | --- |
| MCP endpoint, allowed origins, tool switches | [Agents › MCP](/docs/mcp/) (`agents:manage`) |
| Agent budgets and the pause switch | [Agents › Policies](/docs/agents/) (`agents:manage`) |
| Remediation credential and privilege check | **Admin › Connections › Edit** ([fixes](/docs/data-incidents/#set-up-fixes-for-a-connection)) |
| Cost rates | [Monitoring › Capacity](/docs/monitoring-capacity/#cost-rates) (`settings:update`) |
| Server settings (database, secrets, SSO from config) | [Environment variables](/docs/configuration-env/) or [YAML](/docs/configuration-yaml/) |

Everything changed under Admin is recorded in the [audit log](/docs/audit-log/).
