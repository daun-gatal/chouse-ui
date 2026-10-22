# 0023 — Dashboards v2: Canvas, Intent-Based AI Layout, Context, Baselines and Production Features

- **Status:** Proposed
- **Date:** 2026-10-22
- **Builds on:** [0021](0021-custom-dashboards.md) (dashboards, panels, the run pipeline, panel alerts, AI drafting — amended here), [0010](0010-pod-local-state-and-multi-replica-correctness.md) (leases, pod-local caches), [0015](0015-cluster-aware-materialize-destinations.md) (`ON CLUSTER` destinations), [0016](0016-data-observability-platform.md) (change events, incidents, the remediation catalog and its approval flow, the Doctor), [0019](0019-deepagents-managed-in-the-ui.md) (AI features run as registry agents), [0020](0020-ai-usage-and-data-egress-tracking.md) (AI usage is recorded)
- **Scope:** the panel model and layout, the AI drafter's output, and new dashboard
  features: annotations and notes, drill-down links, multi-value variables, compare
  with an earlier window, baseline bands with band alerts, Explain this spike, panel
  cost with rollups, version history, snapshots, scheduled reports and Grafana import.
  It also converts every existing dashboard to the new model.

## Context

ADR 0021 shipped dashboards on a 12-column CSS grid. A panel picks one of five
widths (3, 4, 6, 8, 12) and three heights (`s`, `m`, `l`), and dragging only
changes its place in a list. Users ask for what Metabase and Grafana give them: put
a panel anywhere, size it freely, and add a heading or a note between panels.

The AI drafter has the same limit. Its whole sizing rule is "width 3, 4, 6, 8 or 12;
height s, m or l", and it has no rules for which chart fits which question. It
guesses both, and the results look uneven.

Dashboards also answer "what is the number" but not "why did it change" or "is
this normal". CHouse already records what changed (the `changes` collector's DDL,
version and settings events, incidents, applied fixes, alert events). It has a
Doctor that investigates, and a remediation catalog with approvals. Dashboards use
none of this yet.

### What makes this hard

1. **Existing dashboards must convert, not break.** Every stored dashboard, every
   panel alert on it, and every export already in git or CI must keep working. That
   includes `chouse dashboard apply -f` of a file written before this change.
2. **Time is in two zones.** Panel x values are ClickHouse `DateTime` strings in
   the server's (or the column's) time zone. Events CHouse records are UTC
   milliseconds. Annotations, compare, baselines and range selection all have to
   line the two up exactly.
3. **More features means more load on the watched cluster.** Compare doubles a
   panel's queries. A baseline multiplies them by the number of weeks.
4. **AI output is unreliable at layout.** A model that writes `{x: 7, w: 13}` puts
   panels on top of each other.
5. **Rollups write DDL.** That is the only thing in dashboards that changes the
   cluster, so it must take the same approval path as every other change.

## Decision

### 1. Panel model and the canvas

A panel is one of three kinds. All three share an `id` and a `layout`.

| Kind | Fields |
| --- | --- |
| `chart` | `title`, `sql`, `viz` (spec v2, §2), `fleet` |
| `text` | `title` (may be empty), `markdown` (1–10,000 characters) |
| `heading` | `title`, `description` (0–500 characters) |

`layout` is `{x, y, w, h}` on a **24-column grid** with **32 px rows and 8 px
gaps**. Values are integers, with `0 ≤ x`, `1 ≤ w`, `x + w ≤ 24`, `0 ≤ y ≤ 500` and
`1 ≤ h ≤ 40`. Each kind and chart type has a minimum size:

| Panel | Minimum `w × h` |
| --- | --- |
| heading | 4 × 1 (`h` at most 3) |
| text | 3 × 2 |
| stat | 3 × 3 |
| table | 6 × 5 |
| every other chart | 4 × 5 |

Panels may not overlap; a save with overlapping panels is refused and names both.
Gaps are allowed. The server stores `position` as reading order, `(y, x)`. On
screens narrower than 768 px panels stack in that order at full width, keeping
their row height. A dashboard has at most 60 panels, of which at most 40 are
charts.

The editor uses `react-grid-layout`. Panels drag anywhere and resize from any
edge, and compaction moves panels up into gaps. Text panels render Markdown
sanitized with DOMPurify. Markdown is the only HTML source, and links open in a
new tab with `rel="noopener noreferrer"`.

### 2. Viz spec v2

Spec v2 is spec v1 with `version: 2` and two new fields:

- `links`: up to 6 drill-down links (§6).
- `baseline`: `null` or `{weeks: 2…8}` (§8). It is allowed only on line, multi-line,
  area and stacked-area charts with exactly one y column and no series split, and
  never on a fleet panel.

The server reads and writes **only v2**. v1 exists only as an input format, which
is converted (§3).

### 3. Converting what exists

**Stored dashboards.** Migration **1.63.0** adds the new columns and rewrites
every row with one deterministic rule:

- Panels are taken in stored `position` order and laid out the way the old CSS
  grid flowed them. Each panel takes `w = width × 2`. A panel that does not fit in
  the rest of the row starts a new row.
- Heights map `s, m, l → 6, 9, 12` rows. Because the old grid stretched every panel
  in a row to the tallest one, each panel in a row gets that row's height. A
  converted dashboard therefore looks as it did.
- Every viz spec becomes v2 with `links: []` and `baseline: null`.
- Every panel alert config gains `kind: "threshold"` (§8).
- The dashboard gets the default annotation sources (§5).
- One history entry is recorded, with source `migration` (§11).

Migration **1.64.0** drops the old `width` and `height` columns. It is a separate
migration so that a failed conversion never reaches the drop.

A server from before this change cannot read a v2 spec. During a rolling upgrade,
dashboards served by an old pod show "stored viz spec does not match" until the
rollout completes. An old pod's alert evaluator logs the same error and skips the
alert; it records no state change and sends no notification.

**Files and API bodies.** The export format becomes `chouse.dashboard/v2`. Import,
`POST`, `PUT`, the CLI's `apply` and MCP's `apply_dashboard` accept both formats:

- A document whose panels carry `layout` is v2.
- A document whose panels carry `width` is v1, and is converted with the same
  function the migration uses. A test proves that converting a v1 file and
  migrating the same dashboard in the database give identical documents.
- Mixing both shapes, or any other shape, is refused with an error that says why.
- A document with no panels is the same in both formats.

The CLI accepts both export formats. The CLI 1.1 binary still applies v1 files,
but it refuses v2 exports because it checks the format string. The upgrade notes
say to update the CLI.

### 4. Intent-based AI layout and Tidy up

The drafter no longer outputs sizes. For each panel it returns its role and chart:

| Role | Question | Charts allowed |
| --- | --- | --- |
| `kpi` | What is it now? | stat |
| `trend` | How is it changing? | line, multi_line, area, stacked_area, bar, stacked_bar |
| `breakdown` | What contributes? | bar, grouped_bar, stacked_bar, horizontal_bar, pie, donut, treemap, funnel, radar |
| `ranking` | Top N | horizontal_bar, bar, table |
| `distribution` | How is it spread? | histogram, heatmap, scatter |
| `detail` | Show the rows | table |

Each panel also gets an `importance` (`primary` or `secondary`) and a `section`
name. A role whose chart type is not allowed is `blocked`, with the reason. The
panel is not resized or retyped to make it fit.

The **layout engine** (`layout.ts`) is a pure function, shared by the AI draft,
templates, Pin to dashboard, Grafana import and **Tidy up**:

1. It groups panels by section, in first-seen order. A non-empty section gets a
   heading panel (`24 × 2`).
2. Within a section it places panels in this order: KPIs, then primary trends,
   then breakdowns, rankings and distributions, then secondary trends, then detail
   tables.
3. KPIs share one row in equal widths (24 / n, at least 4 columns; more than 6 wrap
   to a new row), `h = 4`.
4. A primary trend is `24 × 9`. Other charts are placed two per row at `12 × 9`;
   an odd one out is `24 × 9`.
5. A detail table is `24 × 10`. Text panels keep their size.

**Tidy up** runs the engine on an existing dashboard. It infers each panel's role
from its chart type: stat is `kpi`, a time-series chart is `trend`, histogram,
heatmap and scatter are `distribution`, horizontal_bar is `ranking`, table is
`detail`, and the rest are `breakdown`. Existing headings start sections. Tidy up
changes only the draft in the editor; the user saves it, and version history can
undo it.

**Chart fit.** The draft's dry run runs the panel query in full, with the
dashboard caps. The editor's preview has the result too. A chart-fit check then
reads the result and adds findings that may carry a `fixedViz`:

| Finding | When | Fix |
| --- | --- | --- |
| `too_many_slices` | pie, donut, treemap or funnel with more than 8 rows | horizontal_bar with the same x and y |
| `time_axis_not_time` | a line or area chart whose x column is not Date or DateTime | bar |
| `too_many_series` | a series split with more than 12 distinct values | none: filter or keep the top N |
| `too_many_categories` | a bar chart with more than 50 rows | none: aggregate or LIMIT |

The model's instructions spell out the role table, the chart rules (latency as
p50/p95/p99, never an average of quantiles, the unit taken from the column) and
the section conventions. An eval fixture (`draftLayout.fixture.json`) keeps 15
goals with expected layouts. The engine is tested against it: KPIs on top, no
panel under its minimum, no overlap, and every role's chart type allowed.

### 5. Annotations and notes

A dashboard stores which annotation sources it shows (`annotations`; the default
is all of them). The viewer can hide sources per view, and the choice is kept in
the URL. `POST /api/dashboards/:id/annotations {range, sources}` returns events for
the **active connection**:

| Source | From | Needs |
| --- | --- | --- |
| `ddl` | `obs_change_events` kind `ddl`, filtered by the viewer's table access | `observe:view` |
| `upgrades` | change events kind `version` | `observe:view` |
| `settings` | change events kind `settings` | `observe:view` |
| `writers` | change events kind `writer` | `observe:view` |
| `alerts` | `alert_events` for this dashboard's panel alerts | `alerting:view` |
| `incidents` | `obs_incidents` opened in range, filtered by table access | `observe:view` |
| `fixes` | `remediation_executions` finished in range for actions on this connection | `observe:view` |
| `notes` | `dashboard_notes` for this dashboard and connection | view access |

Each source answers on its own, as `{ok: true, events}` or `{ok: false, error}`.
A source the viewer may not read, or that failed, shows as an error chip; it is
never quietly hidden. Each source returns at most 200 events, the newest first,
and says when it truncated. Annotations come from the RBAC database only, so they
add no ClickHouse load.

**Notes** (`dashboard_notes`): a time, a connection, up to 500 characters of text,
the author and when it was created. Adding one needs edit access to the dashboard.
Deleting one needs edit access, or being its author.

Annotations are drawn on time-series charts as dashed vertical markers in the
bucket that contains the event. Hovering a marker shows its details.

### 6. Drill-down links

`viz.links` entries are one of:

- `dashboard`: the target dashboard id, a label, and values for the target's
  variables, each `{column}` or `{value}`. The current time range is passed along.
- `filter`: set one of this dashboard's variables from a column of the clicked datum.
- `explorer`: open the table named by `{column}` or `{value}` database and table
  references in Explorer.

On a chart, a `{column}` reference may name only the x, series or y columns. On a
table it may name any column. Saving checks that a target dashboard exists and
that every key is one of its variables; an import naming an unknown dashboard is
refused, never dropped. When the user clicks, a value missing from the clicked
datum, or a target the user cannot view, is an error message. The link is not
followed partly.

For time-series charts, "queries in this bucket" is always offered. It opens a SQL
workspace tab with a `system.query_log` query for that bucket's time range.

### 7. Multi-value variables

A new variable kind, `multi`, holds string values with a `default` list (1–100).
Its options are static or a one-column query, as with other kinds. It compiles to
`{v_NAME:Array(String)}`, so it is used as `col IN {{var.NAME}}` or
`has({{var.NAME}}, col)`. Identifier variables stay single-value.

A run carries an array of 1–1,000 values. An empty selection is an error ("Pick at
least one value for X"). The picker's **All** button selects every option and
sends them explicitly; there is no "match everything" value. In the URL, each
value is its own `v.NAME` parameter.

### 8. Compare and baseline bands

**Compare.** The view can compare with 1 day or 7 days ago (URL `cmp=1d|7d`). A
time-series panel that is not a fleet panel and has no series split runs a second
time with `shiftSeconds`. The window moves back, and every check runs as usual.
The earlier series is drawn dashed: for each y it is moved forward by the shift and
matched to the nearest current bucket within half an interval. Other panels show a
"compare not available" chip.

**Baseline.** A panel with `viz.baseline` gets an expected-range band from
`POST …/panels/:panelId/baseline`:

- The query runs for each of the past `weeks` weeks, shifted by k × 7 days, through
  the full pipeline. The shifted windows end at "now" rounded down to 15 minutes,
  plus 15 minutes, so they cover the current window and can be cached for 15
  minutes in their own cache.
- Each bucket gets `median ± max(3 × 1.4826 × MAD, 0.05 × |median|)` over the
  weeks that have that bucket. A bucket that fewer than 2 weeks have gets no band.
- The band is `ready` when at least half the current buckets have one. Otherwise
  it is `learning`, with the reason, and is drawn as a "learning" chip, not as a
  band.

**Band alerts.** A panel alert config is a discriminated union:

- `{kind: "threshold", column, reduce, op, value, …}`: the existing alert.
- `{kind: "outside_band", column, forEvaluations, everyMinutes, range, values}`.
  It needs a panel with `viz.baseline`, and `column` must be its y column.

A band alert reads the **latest complete bucket**: the second-newest row, because
the newest is still filling. It breaches when the value is below or above the band.
A learning baseline, or a bucket with no band, is `no_data` with the reason. It
never falls back to a fixed threshold.

**Time zones.** Every panel run returns the session time zone from ClickHouse's
`X-ClickHouse-Timezone` header. A time x value is read in the column type's
explicit zone (`DateTime('Asia/Jakarta')`), or else in that zone, and converted to
UTC milliseconds. Annotations, compare, bands and range selection do all their
arithmetic in UTC milliseconds. A Date x value is midnight in that zone.

### 9. Explain this spike

The user drags across a time-series chart to select a range, and the menu offers
**Explain this spike**. This calls a new structured AI feature, `explain-spike`,
served by a built-in **Spike Explainer** agent. Before the model runs, CHouse
gathers the evidence, as the viewer and through the same checks:

- the panel's SQL, the selected range, and the same range one week earlier;
- the annotations in the range, with the same per-source rules as §5;
- the 10 slowest normalized queries in the range from `system.query_log`;
- mutations created or running in the range and merge activity from
  `system.part_log`. Each query passes the viewer's data-access check, as a panel
  does; one that fails is listed in the evidence as `not available: <reason>`.

The model returns a summary, a likely cause with a confidence, evidence items and
next steps. It is read-only, and is recorded in AI usage like every AI feature. It
needs `ai:optimize`, view access to the dashboard and `query:execute`. **Add as
note** saves the summary as a note at the range's start.

### 10. Panel cost and rollups

`POST …/panels/:panelId/cost` runs the panel, using the shared cache, and reports:

- the bytes and rows read and the time taken;
- reads per hour at the dashboard's refresh rate, per viewer pod;
- whether the panel is **heavy**: more than 1 GiB per refresh, or more than
  100 GiB per hour.

A panel is **eligible for a rollup** when its SQL is:

- a single SELECT from one table, with no JOIN, subquery, UNION or WITH;
- with a `toStartOfInterval(<time column>, INTERVAL {{interval_s}} SECOND)` bucket;
- bounded by `<time column> >= {{from}} AND <time column> < {{to}}`;
- with other WHERE conditions that use no macros;
- grouped by the bucket and plain columns;
- selecting only the bucket, those columns, and aggregate function calls with no
  macros in their arguments.

Anything else gets "not eligible", with the first reason. Parsing uses
`node-sql-parser`, the parser the read-only validator already uses.

An eligible panel can **propose a rollup**. This adds a new remediation catalog
action, `create_panel_rollup`, with typed parameters only. It creates:

- an `AggregatingMergeTree` table `<db>.chouse_rollup_<hash>`, ordered by the group
  columns and `bucket`, with each aggregate as `AggregateFunction(...)` and a
  1-minute `bucket = toStartOfMinute(<time column>)`;
- a materialized view that writes `-State` aggregates into it;
- a backfill `INSERT … SELECT` for the chosen number of days (1–30), up to the
  minute the view was created.

On a cluster connection, the statements use `ON CLUSTER` and a `Replicated`
engine, following ADR 0015. The action goes through the existing approval flow,
with approval class 2. After it runs, verification compares the original and the
rollup panel queries over the backfilled hours, excluding the last 10 minutes. Only
an exact match switches the panel's SQL to read the rollup (`-Merge`, re-bucketed
by `{{interval_s}}`, at least 60 s). A mismatch stops the action as failed, leaves
the panel unchanged, and leaves the objects for the user to drop. The rollup has
1-minute resolution, and the panel says so.

### 11. Version history

Every create, save, import, restore and template copy writes a `dashboard_versions`
row inside the save's own transaction. The row holds the dashboard version number,
the v2 document, who saved it, when, and the source: `ui`, `token`, `import`,
`template`, `duplicate`, `restore` or `migration`. A dashboard keeps its last 50
versions; older ones are deleted in the same transaction.

The UI shows the versions and a diff that separates settings, layout, panels added
or removed, and SQL or chart changes. **Restore** saves the old document as a new
version. Before restoring, it lists the alerts that will be deleted with panels the
old version does not have.

### 12. Snapshots

A snapshot freezes the results of every chart panel for an absolute range. Each
panel runs as the creator, through the full pipeline. The snapshot stores the v2
document, each panel's result or error, the connection, the range, a name, the
roles that may open it, an optional observability incident it is linked to, and an
expiry date (1 day to 365 days). If the stored results exceed **10 MiB**, the
snapshot is refused and says the size. Results are never cut down to fit.

To open a snapshot, the viewer must be its creator, or hold one of its roles **and**
still be able to view the dashboard. Each panel's data-access check runs again as
that viewer; a panel they may not read shows "Access denied", never the data.
Expired snapshots are not served, and the report scheduler's sweep deletes them.
Creating a snapshot needs view access to the dashboard and `query:execute`.

### 13. Scheduled reports

A report is sent to existing notification channels, on a daily or weekly schedule
(day of week, hour, minute, IANA time zone), over a relative range, on one
connection. It can be set to send only when one of the dashboard's panel alerts
fired in the range. Its text digest has:

- each stat panel's value;
- each time-series panel's min, average, max and last value per y column;
- each table panel's first 5 rows;
- each panel's error, if it had one;
- the alerts that fired;
- a link to the dashboard at that absolute range: `PUBLIC_BASE_URL` +
  `/dashboards/:id?from=…&to=…`.

Reports **require `PUBLIC_BASE_URL`**: creating one without it is refused. A report
whose link cannot be built at send time records a failed delivery. It is not sent
without the link.

The report runs as its owner. Each run checks the owner again, the same way panel
alerts do. A 60 s scheduler starts with the panel alert evaluator, and claims each
due report with a row lease (`obs_leases`) so exactly one pod sends it. Every run
writes an `alert_events` row (source `dashboard_report`). A run that fails records
the failure and sends nothing partial. Managing reports needs `alerting:edit` and
edit access to the dashboard.

### 14. Grafana import

`POST /api/dashboards/import/grafana` takes a Grafana dashboard JSON (schema 30 or
later) and returns a **conversion preview**, saving nothing. Each Grafana panel
becomes one of:

- `ready`: a panel that uses the ClickHouse data source (`grafana-clickhouse-datasource`
  or `vertamedia-clickhouse-datasource`), whose type maps to a chart:
  - timeseries → line;
  - barchart → bar;
  - stat or gauge → stat;
  - table → table;
  - piechart → pie;
  - heatmap → heatmap;
  - text → text;
  - row → heading.
- `changed`, with the list of what changed:
  - `$__timeFilter(col)` becomes `col >= {{from}} AND col < {{to}}`;
  - `$__fromTime` and `$__toTime` become `{{from}}` and `{{to}}`;
  - `$__interval_s` and `$__interval` become `{{interval_s}}`;
  - `$var` and `${var}` become `{{var.var}}`;
  - units map where an equivalent exists; any other unit becomes `none`, and the
    change says so.
- `skipped`, with the reason: another data source, a panel type with no
  equivalent, or a macro with no equivalent.

Grafana's `gridPos` is on a 24-column grid, so it maps one to one; its height
units also become canvas rows. Overlaps from collapsed rows are resolved by the
layout engine's compaction. Template variables of type `custom` and `query` become
static or query variables, and `multi` ones become `multi`. The user reviews the
preview and imports through `POST /api/dashboards/import`, so every save check
applies.

### 15. Permissions, MCP, chat and CLI

There are no new permissions:

| Action | Needs |
| --- | --- |
| Notes | view access to read them; edit access to add one |
| Snapshots | view access and `query:execute` |
| Reports | `alerting:edit` and edit access |
| Explain this spike | `ai:optimize` |
| Rollups | `remediation:propose`, then the catalog's approval |

MCP gets `list_dashboard_versions`, `get_dashboard_annotations` and
`create_dashboard_snapshot` (write, off by default). The chat agent gets
`get_dashboard_annotations`. The CLI gets:

- `chouse dashboard versions` and `restore`;
- `snapshot create`, `snapshot list` and `snapshot get`;
- `import-grafana -f`, which prints the preview, and with `--apply` imports the
  convertible panels.

## Consequences

- **Easier.** Dashboards look how their owners arrange them. AI drafts come out
  tidy, because code places them. A chart can answer what changed (annotations),
  whether a value is normal (bands, compare) and why (Explain). Heavy panels can be
  made cheap through the approval path. Every save can be restored.
- **Harder.** The panel model has three kinds and a layout to validate. Compare
  and bands add queries; bands are cached for 15 minutes and capped at 8 weeks. The
  rollup parser accepts a deliberately narrow shape.
- **Accepted.**
  - Old pods cannot read converted dashboards during a rolling upgrade (§3).
  - The CLI 1.1 binary cannot apply v2 exports; it needs an update.
  - Reports are text with a link, because the channels are text-only webhooks.
  - Rollups have 1-minute resolution.
  - Annotations show only what the collectors and CHouse recorded.
- **Migration.**
  - 1.63.0 adds the columns `kind`, `x`, `y`, `w`, `h`, `markdown` and
    `description` on panels, and `annotations` on dashboards.
  - It adds the tables `dashboard_notes`, `dashboard_versions`,
    `dashboard_snapshots`, `dashboard_reports` and `dashboard_report_channels`.
  - It converts every dashboard, panel and panel alert, and records one history
    entry per dashboard.
  - 1.64.0 drops `width` and `height`.

## Alternatives considered

- **Keep v1 specs readable next to v2.** Rejected: two shapes in the database mean
  two code paths forever. Converting once, with a tested rule, is simpler and
  fails loudly.
- **Let the AI output coordinates.** Rejected: models overlap panels and ignore
  minimum sizes. Roles are easy for a model to get right, and placement is
  deterministic code.
- **PNG reports.** Rejected for now: the channels are text-only webhooks. An image
  would need a server-side renderer, a native rasterizer and a public image
  endpoint.
- **Rollups for any SQL.** Rejected: a rollup must give the same answer as the
  query it replaces, and that can be proven only for a narrow shape. A wrong
  rollup is worse than a slow panel.
- **Query ClickHouse for annotations.** Rejected: the collectors already record
  these events in the RBAC database. Querying `query_log` again per view would add
  load for the same data.
