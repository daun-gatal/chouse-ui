# 0021 — Custom Dashboards and AI-Drafted Dashboards

- **Status:** Proposed
- **Date:** 2026-10-17
- **Builds on:** [0002](0002-scheduled-queries.md) (read-only SELECT validation, `{{…}}` macros as native parameters, leases), [0010](0010-pod-local-state-and-multi-replica-correctness.md) (what may live in a pod), [0013](0013-chouse-mcp.md)/[0014](0014-mcp-destructive-client-approval.md) (MCP tools), [0016](0016-data-observability-platform.md) §7 (notebook query cells run under the caller's data access), [0019](0019-deepagents-managed-in-the-ui.md) (AI features run as registry agents), [0020](0020-ai-usage-and-data-egress-tracking.md) (AI usage is recorded)
- **Scope:** a new **Dashboards** area (`/dashboards`, `/api/dashboards`), a chart view for results in the SQL workspace, panel threshold alerts, curated templates, an AI drafting feature, and dashboard access for MCP, the chat and the CLI.

## Context

Every chart in CHouse is built in: Performance, Capacity, Fleet trends,
Metrics. A team that needs to watch *its* tables cannot. That covers the insert
rate of one materialized view, Kafka consumer lag for one topic, or the parts
count that will hit `parts_to_throw_insert`. They have to run the same query in
the SQL workspace again and again, or stand up Grafana next to CHouse and
re-create users, connections and access rules there. The SQL workspace has no
chart view of a result, and the chat can render a chart (`render_chart`) but not
keep one.

CHouse already has the pieces a dashboard needs, and they are what a separate
tool cannot reuse:

- RBAC users and roles, per-connection access and per-table data-access rules
  (`middleware/dataAccess.ts`);
- a read-only SELECT validator and a `{{…}}` macro grammar that compiles to
  native ClickHouse parameters (`services/scheduledQueries/validation.ts`);
- notebook query cells that run read-only under the caller's own data access
  (`routes/notebooks.ts`);
- alerting channels, delivery and event history (`services/alerting/`);
- row leases that work across pods on PostgreSQL (`services/observe/lease.ts`);
- a chart renderer with 16 chart types (`AiChartRenderer`);
- registry agents for AI features, with usage recorded per request.

### What makes this hard

1. **Load on the cluster being watched.** Ten viewers of a twelve-panel
   dashboard refreshing every 10 s is twelve queries a second against
   `system.*` tables. A monitoring feature must not be the cause of the incident.
2. **Whose access a shared dashboard runs with.** If a panel ran with its
   owner's access, sharing a dashboard would show viewers data they cannot query
   themselves.
3. **Charts that look right and are wrong.** A cumulative counter plotted as a
   gauge, an average of quantiles, bytes shown as rows. AI drafting makes this
   more likely, not less.
4. **Alerts without a viewer.** A threshold alert must evaluate when nobody has
   the dashboard open, on exactly one pod, and must not keep firing on behalf of
   an owner who has since lost access.

## Decision

### 1. Model

A **dashboard** has a title, a description, an owner, a default connection, a
default time range and refresh, variables, panels, shares and pins. A **panel**
has a title, one read-only SELECT, a **viz spec**, a position, a width (3, 4, 6,
8 or 12 of a 12-column grid), a height (`s`, `m`, `l`) and a `fleet` flag.

Stored in the RBAC database by migration 1.61.0 (`IF NOT EXISTS`, idempotent on
fresh, stepwise and skip-version installs):

| Table | Holds |
| --- | --- |
| `dashboards` | the dashboard; `version` (integer) for optimistic concurrency |
| `dashboard_panels` | panels, ordered by `position` |
| `dashboard_shares` | `(dashboard_id, role_id, can_edit)` |
| `dashboard_pins` | `(user_id, dashboard_id)`: pinned to the user's Home |
| `dashboard_alerts` | panel threshold alerts (§7) |
| `dashboard_alert_channels` | `(alert_id, channel_id)`: where an alert delivers |
| `dashboard_alert_state` | per alert: state, since, last value, last error |

A save replaces the dashboard with its panels as a whole and must carry the
`version` it was loaded at. A stale version answers **409** and nothing is
written.

### 2. The viz spec

Versioned JSON, validated `.strict()` on the server (Zod 3) and in the browser
(Zod 4), both tested against one shared fixture of valid and invalid specs:

```json
{ "version": 1, "type": "line", "x": "t", "y": ["p95_ms"], "series": "user",
  "unit": "ms", "decimals": 0, "thresholds": [{ "value": 800, "severity": "warning" }],
  "colorScheme": "default", "reduce": null }
```

- `type`: the 16 `render_chart` types plus `stat` and `table`.
- `unit`: `none`, `ms`, `s`, `us`, `bytes`, `rows`, `count`, `percent`, `per_s`.
- `series`: an optional split-by column; long rows are pivoted to one series
  per value.
- `reduce` (`last`, `max`, `min`, `avg`, `sum`): how a `stat` panel turns rows
  into one number.

Unknown fields, types or units are rejected. They are never mapped to a default.

### 3. Variables compile to native parameters

The panel SQL uses a `{{…}}` grammar in the style of Scheduled Queries,
compiled to **native ClickHouse query parameters** and never concatenated:

| Macro | Becomes | Value |
| --- | --- | --- |
| `{{from}}`, `{{to}}` | `{chouse_from:DateTime}`, `{chouse_to:DateTime}` | the dashboard time range |
| `{{interval_s}}` | `{chouse_interval_s:UInt32}` | bucket size for about 120 points over the range |
| `{{var.NAME}}` (kind `string`) | `{v_NAME:String}` | the selected value |
| `{{var.NAME}}` (kind `identifier`) | `{v_NAME:Identifier}` | the selected value, matching `^[A-Za-z_][A-Za-z0-9_]*$` |

- The connection panels run on is not a variable: the dashboard has a default
  connection and the view bar picks another the viewer may use. It is never
  substituted into SQL.
- Variable options are a static list, or come from a one-column read-only query
  validated like a panel.
- Variables are single-value.
- A macro inside a quoted string or a comment is an error, not a literal.
- Data-access validation runs on a rendering with the real identifier values
  inlined, so `FROM {{var.db}}.{{var.table}}` is checked against the table the
  viewer picked.

### 4. Execution: the viewer's access, shared results

Every panel run, for every viewer, goes through the same steps. This follows
notebook query cells (ADR 0016 §7).

1. `dashboards:view` and access to the dashboard (owner, share, or
   `dashboards:manage`).
2. `query:execute` and access to the connection.
3. A single read-only SELECT (`validateReadOnlySelect`).
4. The **viewer's** data-access rules (`validateQueryAccess`).
5. A token caller (CLI, MCP) passes agent governance (ADR 0016 §10: pause
   switch, budget, session record), like any `/api/query` call.
6. The query runs on the connection's client with:
   - `readonly=1`;
   - `max_execution_time=30`;
   - `max_result_rows=10000` with `result_overflow_mode='throw'`;
   - `max_bytes_to_read` of 20 GiB with `read_overflow_mode='throw'`;
   - a per-query `log_comment` of `{"source":"dashboards", dashboardId, panelId}`.

A panel never truncates silently. Too many rows is an error that says to
aggregate further. A panel the viewer may not run shows **why**, for example
"Access denied to orders.events", and is never hidden or emptied.

Data-access rules are table-level and never rewrite a query per user. So once
step 4 passes, the result is the same for every viewer of the same rendered
query. That makes a **shared result cache** safe:

- in memory per pod, keyed by `sha256(connectionId, rendered SQL, parameters)`;
- 30 s TTL;
- **single-flight**: concurrent identical runs share one execution;
- bounded to 500 entries and 64 MB, least recently used first out;
- at most 4 concurrent panel queries per connection per pod.

Steps 1–5 run **before** the cache is consulted, for every request. This is a
cache, not state, so pod-local is correct under ADR 0010. N pods mean at most N
executions per TTL.

Auto-refresh is off, 30 s, 1 m, 5 m or 15 m. Polling stops while the browser
tab is hidden. Dashboard queries are excluded from Performance
(`NOT_OBSERVE`), the same way CHouse's own collection is.

### 5. Sharing

The owner can share with RBAC roles, view-only or with edit rights. Shares
reveal the *dashboard*. They never widen data access: a viewer sees the
panels, and each panel still runs under step 4 for that viewer.

| Permission | Allows | Default roles |
| --- | --- | --- |
| `dashboards:view` | open dashboards you own or that are shared with you | all but Guest |
| `dashboards:edit` | create, and edit your own or those shared with edit | Developer, Analyst, Admin |
| `dashboards:delete` | delete your own | Developer, Analyst, Admin |
| `dashboards:share` | share your own with roles | Developer, Admin |
| `dashboards:manage` | see, edit, share and delete every dashboard | Admin |

Super Admin holds all permissions, as always.

### 6. Fleet fan-out

A panel with `fleet: true` runs on every connection the viewer may access, up to
20, each through §4. Each connection is one series. A connection that fails
shows its error in the legend, and the others still render.

### 7. Panel alerts

A panel can carry threshold alerts, with:

- `column`, `reduce`, `op` (`>`, `>=`, `<`, `<=`) and `value`;
- `forEvaluations` (consecutive breaches before firing) and `everyMinutes`;
- the connection and the rule's owner.

Creating one needs `alerting:edit` and edit access to the dashboard. Delivery
uses the existing notification channels, `sendChannelMessage` and
`alert_events`, and a channel in use by a panel alert cannot be deleted.

Panel alerts live in their own tables (`dashboard_alerts`,
`dashboard_alert_channels`), **not** as a new `alert_rules` source type. Every
server reads `alert_rules` through the fleet alerter, which maps a source type
it does not know to a fleet rule. During a rolling upgrade, a server from before
this change would evaluate a panel rule as a fleet threshold.

The **evaluator** works like this:

- It ticks every 60 s.
- It takes a per-rule lease in `obs_leases`, so on PostgreSQL exactly one pod
  evaluates a rule.
- It starts with the Scheduled Queries scheduler (`SCHEDULED_QUERIES_ENABLED`),
  so the Helm chart's `dedicatedScheduler` split already places it.
- Each evaluation re-checks the **owner** (still active, still allowed to view
  the dashboard and run the query) and runs §4 as the owner.
- If the owner lost access, the rule moves to state `error` with the reason. It
  does not fire and does not pass silently.
- It fires once on the transition to firing and once on recovery.

Deleting a panel deletes its rules in the same operation, after the UI lists
them.

### 8. Templates

Curated templates ship in code, not data:

- ClickHouse overview
- Merges and parts
- Replication
- Query latency
- Disk and tables
- Kafka and S3Queue ingestion

**Use template** creates a copy the user owns. Performance and Capacity get
**Open as dashboard**, which does the same for their template. A test validates
every template query (spec, lint, read-only). An end-to-end test runs every one
against ClickHouse.

### 9. Lint

The same lint runs in the editor, on save, and on AI drafts:

| Finding | Why |
| --- | --- |
| a cumulative counter (`system.events`, `ProfileEvents*`) plotted without a delta | the line only ever goes up |
| a numeric y without a `unit` | the axis is unreadable |
| an average of quantiles (`avg(quantile…)`) | statistically meaningless |
| a `system.*_log` read without `{{from}}` | scans the whole log on every refresh |
| a pie or donut without `LIMIT` | unreadable slices |
| a `stat` panel with more than one row and no `reduce` | ambiguous number |

A finding carries a suggested fix the user applies. Nothing is rewritten for
them.

### 10. Draft with AI

A new structured AI feature, `draft-dashboard`, is served by a built-in
*Dashboard Drafter* agent with the session schema tools. Its input is a goal,
the connection, and optionally the dashboard to add panels to. Its output is a
draft: title, variables and panels, each with SQL, a viz spec and a one-line
rationale.

Like Draft with AI for agents, **it never writes anything**. `finalize` runs
the full pipeline on every panel: spec, lint, read-only check, the requester's
data access, and a dry run with `LIMIT 1`. Each panel comes back `ok`,
`attention` (lint findings with fixes) or `blocked` (the reason). The user
reviews, applies fixes, and saves through the normal `POST /api/dashboards`.

Running it needs `ai:optimize` and `dashboards:edit`. Usage, cost and the
tables sent to the provider are recorded by ADR 0020.

### 11. MCP, chat and CLI

| Surface | Read | Write |
| --- | --- | --- |
| MCP | `list_dashboards`, `get_dashboard`, `export_dashboard`, `run_dashboard_panel` (on by default) | `apply_dashboard` (write), `delete_dashboard` (destructive, ADR 0014 approval); both off by default |
| CHouse Admin chat | `list_dashboards`, `get_dashboard` | none |
| CLI | `chouse dashboard list`, `get`, `export`, `run-panel` | `apply -f`, `delete` |

All of them call `/api/dashboards` with the caller's token, so every check in §4
and §5 applies unchanged. Export is the JSON that `apply` and `POST /import`
take, which makes dashboards reviewable in git.

### 12. UI

- A **Dashboards** dock entry and page: `/dashboards` lists yours, shared with
  you, pinned and templates; `/dashboards/:id` shows one, with `?edit` for edit
  mode. Variables and the time range are in the URL, so links from alerts open
  the exact view.
- Edit mode: drag panels to reorder, pick widths and heights, and a panel
  editor with SQL, the viz spec and a live preview.
- The SQL workspace gets a **Chart** tab next to Results, with chart type and
  axes detected from the result's column types and **Pin to dashboard**.
- Home shows pinned dashboards.
- The chart renderer is shared with the chat's `AiChartRenderer`, so there is
  one renderer.

## Consequences

- **Easier.** Teams watch their own tables in CHouse with the access rules they
  already have. Shared dashboards cost the cluster one query per panel per TTL
  per pod, not one per viewer. Agents and scripts can manage dashboards as code.
- **Harder.** Panel queries must stay cheap. The caps make an expensive panel
  fail loudly rather than slowly, so users will see "aggregate further" errors
  they have to act on.
- **Accepted.**
  - The cache is per pod, so N pods may run a panel N times per TTL.
  - Panel queries run on the connection's stored credentials, as Scheduled
    Queries and notebook cells do; the boundary is CHouse's data-access rules.
  - Alerts run with their owner's access, re-checked on every evaluation.
  - Templates are code, so changing one needs a release.
- **Migration.** 1.61.0 adds seven tables, five permissions and their role
  grants. Nothing existing changes.

## Alternatives considered

- **Embed or ship Grafana.** It needs a second user store, a second set of
  connection credentials and its own access model. CHouse's data-access rules
  would not apply, and AI, alerts and fleet would not reach it.
- **Run panels with the owner's access** (simpler cache, works for viewers
  without query rights). Rejected: sharing would leak data.
- **A cache shared across pods** (in the RBAC database). Rejected: result rows
  in the RBAC database, write load per refresh, and a correctness surface for
  what is only an optimization.
- **Truncate large results** (`result_overflow_mode='break'`). Rejected: a chart
  of the first 10,000 rows looks complete and is wrong.
- **Free-form layout with a grid library.** Rejected for v1: a new dependency
  and resize logic for little gain over a 12-column grid with widths and drag to
  reorder (`@dnd-kit`, already a dependency).
- **AI writes dashboards directly.** Rejected: the same review-before-save rule
  as Draft with AI for agents. A draft that has not been reviewed is not
  trusted.
