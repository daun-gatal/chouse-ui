---
app: Dashboards
route: /dashboards
permissions: dashboards:view
screenshot: dashboards
---
# Dashboards

**Dashboards** (`/dashboards`) are your own charts of ClickHouse: each chart panel is a read-only query with a chart, laid out on a canvas you arrange freely, with a shared time range, variables and auto-refresh. They are built on what CHouse already knows about you. A panel runs with **each viewer's own** connection and table access, so a shared dashboard never shows anyone more than they could query themselves.

New to dashboards? [Build a dashboard on the canvas](/docs/guide-build-a-dashboard/) goes from a template to a tidy, annotated dashboard.

The page lists every dashboard you may view in one table, with tabs for **All**, **Mine**, **Shared with me**, **Pinned** and **Templates**. Search by title, description or owner, sort by recently updated, name or panel count, and page through 25 at a time; the tab, search, sort and page are kept in the URL. The pin on each row pins or unpins it in place. Open one at `/dashboards/<id>`.

## Who sees what

| Permission | Allows | Built-in roles |
| --- | --- | --- |
| `dashboards:view` | Open dashboards you own or that are shared with one of your roles | Viewer, Analyst, Developer, Admin |
| `dashboards:edit` | Create dashboards; edit your own and those shared with you for editing | Analyst, Developer, Admin |
| `dashboards:delete` | Delete your own dashboards | Analyst, Developer, Admin |
| `dashboards:share` | Share your own dashboards with roles | Developer, Admin |
| `dashboards:manage` | See, edit, share and delete every dashboard | Admin |

Running a panel also needs `query:execute`, and the panel's tables must be allowed by your [data access rules](/docs/data-access-rules/). A panel you may not run shows why, such as *Access denied to orders.events*. It is never hidden or shown empty.

## Start a dashboard

- **New dashboard** starts empty and opens in edit mode.
- **Templates** tab: **Use template** copies a curated template into a dashboard you own: *ClickHouse overview*, *Merges and parts*, *Replication*, *Query latency*, *Disk and tables*, and *Kafka and S3Queue ingestion*. **Monitoring › Performance** and **Monitoring › Capacity** have **Open as dashboard**, which does the same for their template.
- **Pin to dashboard** in the SQL workspace's **Chart** tab adds the query you just ran, with its chart, to a dashboard you can edit, or to a new one.
- **Import** takes a CHouse export, or a [Grafana dashboard](#import-from-grafana).
- **Ask AI** drafts one from a goal. See [Draft dashboards with AI](/docs/dashboards-ai/).

## The view bar

- **Variables**: one picker per variable the dashboard defines. A multi-value variable picks several values.
- **Annotations**: which kinds of change to mark on the charts. See [Annotations and notes](#annotations-and-notes).
- **Compare**: draw the same chart a day or a week earlier, dashed. See [Compare and expected ranges](#compare-and-expected-ranges).
- **Time range**: from the last 15 minutes to the last 30 days, or an exact range after you zoom.
- **Auto-refresh**: off, 30 s, 1 m, 5 m or 15 m. It pauses while the browser tab is in the background.

Panels run on your active connection, the one picked in the dock, like every other page. See [Connections](#connections) for which dashboards you see on which connection.

The time range, variable values, compare and hidden annotation kinds are kept in the page's URL, so a link opens the view you are looking at, on the reader's own active connection. A link with a value the dashboard does not know, such as an unknown time range, says so and uses the dashboard's own setting instead.

## Connections

Each dashboard is assigned to **All connections** or to a list of connections. Click the connections chip next to the dashboard's title to change them (it saves straight away), or use **Settings › Connections** while editing. **New dashboard** and **Use template** let you pick when you make one, starting with the connection you are on; a dashboard drafted with AI or made by pinning a query is assigned to the connection you are on.

- **Dashboards** and Home list only the dashboards assigned to your active connection. Switch connection in the dock to see the others; the list says how many there are.
- A link to a dashboard that is not assigned to your active connection runs nothing. It says which connections the dashboard is for, with a button to switch to each one you may use.
- You can assign only connections you may use. If the dashboard is also assigned to connections you cannot use, you see how many, not their names, and your save keeps them.
- An imported dashboard keeps its connections. Connections that do not exist on this CHouse are refused, never dropped: edit the file's `connectionScope` first.
- A dashboard on an assigned connection may still read a table that connection does not have. That panel says so, naming the connection, and the rest still draw.

## Edit a dashboard

![The panel editor](/docs/img/app/dashboards-panel-editor.jpg "Editing a panel: its SQL, a preview of the result and the chart settings")

**Edit** starts an edit session. Nothing is saved until **Save**:

- **Add** a **chart**, a **text** panel (Markdown, for runbooks and links) or a **heading** that titles a section. The pencil on a panel edits it.
- For a chart: write the SQL, run a **preview**, and set the chart: type, x and y columns, split by series, unit, decimals, thresholds and colors. **Suggest a chart** picks one from the result's column types. **Links** and **Expected range** add [drill-down](#drill-down) and a [band](#compare-and-expected-ranges).
- **Settings**: title, description, default time range and refresh, [connections](#connections), annotation kinds, and the variables.
- **Run on every connection** makes a fleet panel. See [Fleet panels](#fleet-panels).

**Save** stores the whole dashboard at the version you opened. If someone saved it in the meantime, your save is refused: reload to see their version. Removing a panel that has [alerts](#panel-alerts) asks first, and its alerts are deleted with it.

### The canvas

![A dashboard in edit mode](/docs/img/app/dashboards-canvas.jpg "Edit mode: drag by the grip, resize from any edge, add text and headings, or Tidy up")

Panels sit on a 24-column grid. While editing, drag a panel anywhere by its grip and resize it from any edge or corner; panels never go below their kind's minimum size and never overlap, and panels move up into gaps. **Tidy up** lays the dashboard out for you: headings start sections, and within each section current values (stat panels) share a row at the top, then trends, then breakdowns, rankings and distributions two to a row, then tables at full width. Text panels keep their size. It only changes the dashboard you are editing; save to keep it, or restore the previous [version](#version-history). On a screen narrower than 768 px, panels stack in reading order at full width.

Text panels render Markdown; raw HTML is not rendered, and links open in a new tab.

### Panel SQL

A panel is **one read-only `SELECT`**, without a `FORMAT` clause. Use these macros. They become native ClickHouse query parameters and are never pasted into the text:

| Macro | Value |
| --- | --- |
| `{{from}}`, `{{to}}` | The time range, as `DateTime` |
| `{{interval_s}}` | A bucket size in seconds that gives about 120 points over the range |
| `{{var.NAME}}` | The selected value of variable `NAME`; a list for a multi-value variable |

```sql
SELECT toStartOfInterval(event_time, INTERVAL {{interval_s}} SECOND) AS t,
       quantile(0.95)(query_duration_ms) AS p95
FROM system.query_log
WHERE type = 'QueryFinish' AND event_time >= {{from}} AND event_time < {{to}}
GROUP BY t ORDER BY t
```

A macro inside quotes or a comment is an error: write `{{from}}`, not `'{{from}}'`.

### Variables

A variable is a **text value** (bound as `String`), a **database or table name** (bound as `Identifier`, letters, digits and `_` only), so `FROM {{var.db}}.{{var.table}}` reads the table the viewer picked, or a **multi-value** variable (bound as `Array(String)`), used as `col IN {{var.status}}` or `has({{var.status}}, col)`. Its values come from a list, or from a one-column `SELECT` that runs with each viewer's access. Data access is checked against the table actually selected. A multi-value variable needs at least one value picked.

### Things to check

The editor flags charts that render and are still wrong:

- a running total (`system.events`, `system.errors`, Kafka consumer counters) drawn as a line, without `runningDifference`;
- a numeric chart without a unit;
- an average of quantiles;
- a `system.*_log` read without `{{from}}`, which scans the whole log on every refresh;
- a pie or donut without a `LIMIT`, or with too many slices for the chart.

When the fix is mechanical, such as adding `LIMIT 12` or switching to a bar chart, **Apply fix** makes it. A finding never blocks a save.

## Annotations and notes

![Annotation markers on a chart](/docs/img/app/dashboards-annotations.jpg "Markers along the time axis: what changed around the chart, and your notes")

Line and area charts mark what changed around them, as small markers along the time axis: DDL on the tables involved, ClickHouse upgrades, settings changes, new writers, the dashboard's [panel alerts](#panel-alerts), incidents, [fixes](/docs/guide-approve-a-fix/) and notes. Each kind is read with your own access: DDL only for tables you may read, alerts with `alerting:view`, incidents and fixes with their permissions. A kind you may not read says so in the **Annotations** menu, where you can also hide kinds for this view. Click a marker for what happened.

Select a range on a chart by dragging across it, or click a point, for:

- **Zoom**: show that range.
- **Queries**: open a SQL tab with the slowest queries that finished in it.
- **Add note**: a note at that time, for everyone who sees the dashboard on that connection (needs edit access).
- **Explain this spike**: ask Chouse AI (`ai:optimize`). It reads the panel in that range and a week earlier, what changed, the slowest queries, mutations and merges, all with your access, and answers with the likely cause, the evidence and next steps. Anything it could not read is listed with the answer. **Add as note** keeps the cause on the chart.

## Compare and expected ranges

**Compare** draws a line or area chart a day or a week earlier, dashed, on the same time axis. It works on time series that are not split by series and do not run across the fleet; any other panel says why not.

An **Expected range** (in a chart's settings) draws a band from the same hours of the past 2 to 8 weeks: the median, give or take three median absolute deviations. Until enough weeks have data, the panel says the band is still learning. A [panel alert](#panel-alerts) can fire when the latest complete bucket leaves the band.

## Drill-down

A chart's **Links** make a clicked bar, point or table row open another dashboard with variables set from the clicked values, set a variable on this dashboard from the clicked value, or open a table named by the clicked values in the Data explorer. Links work on bar, line, area and table panels.

## Panel cost and rollups

The gauge on a panel shows what one run reads (bytes, rows, time) and what that comes to per hour for each viewer at the dashboard's refresh. A panel over 1 GiB a run, or 100 GiB an hour, is flagged as heavy.

A time-bucketed aggregate panel can be served from a rollup instead. When the panel's SQL is one `SELECT` from one `database.table` with a `toStartOfInterval(<time>, INTERVAL {{interval_s}} SECOND)` bucket, bounded by `<time> >= {{from}} AND <time> < {{to}}`, other conditions that compare a column with a value, grouped by the bucket and plain columns, and aggregates among `count()`, `sum`, `min`, `max`, `avg` and `uniqExact` of plain columns, **Propose rollup** (`remediation:propose` and edit access) proposes a [fix](/docs/guide-approve-a-fix/) that:

1. creates an `AggregatingMergeTree` table with 1-minute buckets, and a materialized view that keeps it up to date;
2. backfills it for 1 to 30 days;
3. compares the panel's query with the rollup, minute by minute, up to 10 minutes ago;
4. switches the panel to the rollup only if they match exactly, as a new [version](#version-history).

It needs two approvers with `remediation:approve_high`, runs in the maintenance window with the connection's remediation credential, and can be rolled back. A mismatch fails the fix and leaves the panel as it was. A panel that reads a rollup shows **1-min rollup**. On a cluster, name one with one shard; the tables use `ON CLUSTER` and a replicated engine. A `sum` or `avg` of a `Float` column is refused, because it could never match exactly.

## Version history

![Version history](/docs/img/app/dashboards-history.jpg "Version history: what a restore brings back, removes and changes")

**More › Version history** lists the last 50 saves, with who saved them and how (in the UI, with a token, by import, restore or rollup). Pick one to see what restoring it would bring back, remove and change, including the alerts it would delete with removed panels. **Restore** saves that version as a new one, so a restore can itself be undone.

## Snapshots

**More › Snapshots** freezes every chart's result for the current range on your active connection, so you can share what you saw after the data has moved on (`query:execute`). Give it a name, an expiry from 1 to 365 days, the roles the dashboard is shared with that may open it, and optionally the incident it belongs to. A snapshot is stored whole or not at all: over 10 MiB of results, it is refused with the size.

Its creator, and members of the roles it names who can still view the dashboard, can open it at `/dashboards/<id>/snapshots/<snapshotId>`. Nothing runs when it opens, but each panel's data access is checked again for whoever opens it: a panel they may not read shows *Access denied*, never the data. Expired snapshots are deleted.

## Scheduled reports

**More › Scheduled reports** (`alerting:view`; managing them needs `alerting:edit` and edit access) sends a text digest of the dashboard to your [notification channels](/docs/alerting/) every day or every week, at a time in the time zone you pick, covering the last 15 minutes to 30 days. The digest has each stat panel's value, each time series' min, average, max and last value, each table's first 5 rows, each panel's error, the panel alerts that fired, and a link to the dashboard at that range. **Only when an alert fired** skips ranges where none of the dashboard's alerts fired. **Send** sends one now.

A report runs with the access of whoever last saved it, checked again on every run, on the connection it was made on, with the variables' defaults. A run that fails sends nothing and records why; every run is listed in **Admin › Alerting** with its digest. Reports need `PUBLIC_BASE_URL` (Helm `publicBaseUrl`) for their link, and cannot be saved without it. A channel a report sends to cannot be deleted.

## Import from Grafana

![Grafana import preview](/docs/img/app/dashboards-grafana-import.jpg "The preview: ready, changed and skipped panels, before anything is saved")

**Import** takes a Grafana dashboard JSON (schema 30 or later, as Grafana 8+ exports it) and shows what converts before anything is saved:

- **Ready**: a panel using the ClickHouse data source (`grafana-clickhouse-datasource` or `vertamedia-clickhouse-datasource`) whose type has an equivalent: time series, bar chart, stat or gauge, table, pie chart, heatmap, text and rows.
- **Changed**, with each change: `$__timeFilter(col)` becomes `col >= {{from}} AND col < {{to}}`, `$__timeInterval(col)` a `toStartOfInterval` bucket, `$__fromTime` and `$__toTime` become `{{from}}` and `{{to}}`, `$__interval_s` and `$__interval` become `{{interval_s}}`, and `$var`, `${var}` and `[[var]]` become `{{var.var}}`. Units map where an equivalent exists; any other becomes none, and the change says so.
- **Skipped**, with the reason: another data source, a panel type or macro with no equivalent, or SQL whose columns are not named.

Custom, query, constant and text box variables convert; multi-value ones become multi-value variables. Grafana's 24-column layout carries over; panels from collapsed rows are moved down instead of overlapping. Pick the connections and **Import** saves the converted panels through the normal import.

## Limits

Every panel run is read-only (`readonly=1`) and capped. A capped query fails with a message instead of being cut short:

- 30 seconds of execution;
- 10,000 result rows: *aggregate further* (a coarser bucket, fewer groups) or add a `LIMIT`;
- 20 GiB read: narrow the time range or filter on the partition or primary key.

Results are shared between viewers for 30 seconds, so a dashboard ten people watch runs each panel about once per 30 seconds on each server, not once per viewer. Your own access is still checked on every request before a shared result is used. Dashboard queries are tagged in `system.query_log` (`log_comment` source `dashboards`) and left out of [Performance](/docs/monitoring-performance/).

## Fleet panels

A panel with **Run on every connection** runs on every connection the dashboard is assigned to that you may use, up to 20 sorted by name, and draws one line or bar per connection. It works for line, area, bar, stat and table panels with one y column. A connection that fails is listed under the chart with its error, and the others still render.

## Panel alerts

The bell on a panel lists its alerts (`alerting:view`). With `alerting:edit` and edit access to the dashboard, you can create one:

- **Above or below a value**: alert when the **last**, **max**, **min**, **avg** or **sum** of one of the panel's y columns over a window is above or below a value.
- **Outside the expected range**: alert when the latest complete bucket leaves the panel's [expected range](#compare-and-expected-ranges). While the band is still learning, the alert has no data.

Either is checked every few minutes and fires after a number of breaches in a row. It notifies the [notification channels](/docs/alerting/) you pick when it fires, resolves, can't be evaluated, and evaluates again.

An alert runs on the connection that was active when it was created, which must be one the dashboard is assigned to (alerts are checked with no browser open, so they keep their own; a save that would unassign it is refused), with the variable values it was saved with, and with the access of the person who saved it. That access is checked again on every evaluation. If they are deactivated or lose access, the alert goes to **Error** with the reason and notifies once. It never passes silently. Enabled threshold alerts draw their line on the panel's chart, red while firing. **Admin › Alerting** lists every panel alert with its state.

## Sharing, pins and export

- **Share** gives roles view or edit access. It shows the dashboard to their members; it never widens what they can read.
- The pin button puts the dashboard on your **Home** page.
- **Duplicate** makes a copy you own. **Export JSON** downloads the dashboard (`chouse.dashboard/v2`), which **Import**, the [CLI](/docs/cli/) and [MCP](/docs/mcp-tools/) take, so dashboards can live in git. An export from before CHouse 3.16 (`chouse.dashboard/v1`) still imports: its panels are placed on the canvas in their old order and sizes. Dashboards saved before 3.16 were converted the same way on upgrade.

## From the CLI and agents

- CLI: `chouse dashboard list`, `get`, `export`, `apply -f FILE`, `run-panel <dashboard> <panel> --range 24h --var db=shop` (repeat `--var` for a multi-value variable), `versions`, `restore`, `snapshot create|list|get`, `import-grafana -f FILE [--apply]`, and `delete`.
- MCP: `list_dashboards`, `get_dashboard`, `export_dashboard`, `run_dashboard_panel`, `list_dashboard_versions` and `get_dashboard_annotations` are on by default. `apply_dashboard` and `create_dashboard_snapshot` (write) and `delete_dashboard` (destructive) are off until an administrator enables them.
- In [Chobi](/docs/chobi/), CHouse Assistant can list dashboards, read their panels and what changed around them, and create or edit them for you.

A panel run from a token goes through the same [agent governance](/docs/agents/) as any query.
