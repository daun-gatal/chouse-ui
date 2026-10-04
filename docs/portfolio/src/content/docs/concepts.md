# Core concepts

Six ideas explain almost everything else in these docs.

## 1. CHouse UI has its own users, separate from ClickHouse

**CHouse UI users and roles** decide who can sign in and what they can do in CHouse UI. They live in CHouse UI's own RBAC database (SQLite or PostgreSQL):

- **Permissions** (`logs:view`, `remediation:approve`, …) open features. Roles bundle them; six roles are built in. See the [permission catalog](/docs/permissions/).
- **Data access policies** decide which connections, databases and tables a role can touch. See [data access rules](/docs/data-access-rules/).
- **Sign-in** is a password or your identity provider through [SSO](/docs/sso/); scripts and agents use [personal access tokens](/docs/personal-access-tokens/) that carry their owner's live permissions.

**ClickHouse users** are the accounts inside ClickHouse. CHouse UI can manage them too ([ClickHouse users & roles](/docs/clickhouse-users-roles/)), but that doesn't change how CHouse UI authorizes you.

## 2. A connection is a ClickHouse server CHouse UI talks to

A **connection** stores a ClickHouse endpoint and the credentials CHouse UI uses for it, encrypted with AES-256-GCM on the server. You switch between connections in the UI; [Fleet](/docs/fleet/) shows them all at once. A connection can also hold a separate **remediation credential**, the only one approved fixes ever run with. See [Connections](/docs/connections/).

## 3. Everything goes through the server

The browser never talks to ClickHouse. Every request — from the UI, the [CLI](/docs/cli/) or an [MCP](/docs/mcp/) agent — takes the same path:

```
browser / CLI / agent
  → CHouse UI server: authenticate → check permission → parse SQL → check data access
    → ClickHouse, with the connection's credentials
```

That one path is why the same rules hold everywhere, and why every action can be [audited](/docs/audit-log/). See the [security model](/docs/security/).

## 4. CHouse UI watches your data from metadata

A **collector** on the server reads ClickHouse's own system tables on a schedule — parts, part and query logs, replicas, pipeline engines — and stores the evidence in the RBAC database. It never scans your tables. From that evidence it learns, per table, how often data normally arrives and how much, and gives each table a **trust state**: *learning*, *trusted*, *degraded* or *stale*. The same evidence builds [lineage](/docs/data-lineage/), [pipeline status](/docs/data-pipelines/) and [root cause](/docs/data-incidents/). See [How data is watched](/docs/data-observability/).

**Promises** ([Datasets & promises](/docs/data-health/)) are checks you write on top, when you want to state what "right" means for a table.

## 5. Nothing changes your clusters without a person approving it

Reading and diagnosing are automatic; changing things is not.

- [Chouse AI](/docs/doctor/) investigates with read-only queries and explains what it found. It never picks the root cause on its own — that is computed from the evidence — and it can only *draft* fixes.
- A fix is one action from a closed **remediation catalog**. It runs only after approval: high-impact actions need two approvers who didn't propose it, and a fix drafted by AI or proposed by an agent can't be approved by the person who submitted it. See [Incidents, root cause & fixes](/docs/data-incidents/).
- DDL that would break something downstream is stopped by **schema preflight** unless someone with `schema:override` confirms it.

## 6. Agents are governed like people, with budgets

AI agents connect over [MCP](/docs/mcp/) or the API with a personal access token, so they get exactly their owner's permissions and data access. On top of that, [Agents](/docs/agents/) adds budgets checked before each query, health notices in results, a record of every session and a switch that pauses all agent access. MCP tools that write, delete or spend LLM budget are off until an administrator turns them on.

## Where to go next

| You want to… | Read |
| --- | --- |
| Run and save SQL | [SQL editor](/docs/workspace-editor/), [Saved queries](/docs/workspace-saved-queries/) |
| Know whether your data is right | [Data overview](/docs/data-overview/), [Incidents](/docs/data-incidents/) |
| Understand cluster load | [Monitoring](/docs/monitoring-overview/), [Fleet](/docs/fleet/) |
| Give your team access | [Users & roles](/docs/rbac-roles/), [Data access rules](/docs/data-access-rules/) |
| Automate without the browser | [MCP server](/docs/mcp/), [CLI](/docs/cli/) |
