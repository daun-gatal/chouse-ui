# What's new in 3.16

3.16 turns dashboards into a canvas you arrange yourself, and makes them answer the next question: what changed, whether a value is normal, and why it spiked. Place and size panels freely, add text and headings, and let Tidy up or Chouse AI lay them out. Charts mark the changes around them, compare with yesterday or last week, and draw the range a value usually falls in. Freeze what you saw in a snapshot, send a digest on a schedule, bring dashboards over from Grafana, and serve heavy panels from a verified rollup.

## Highlights

**A canvas for dashboards** — Drag panels anywhere and resize them from any edge on a 24-column grid; panels never overlap and never go below a readable size. Add **text** panels in Markdown for runbooks and links, and **headings** for sections. **Tidy up** lays a dashboard out in one click: current values in a row at the top, then trends, breakdowns and tables. Every dashboard you already have was converted on upgrade, keeping its panels' order and sizes, and old exports still import. → [The canvas](/docs/dashboards/#the-canvas)

**AI picks the chart and the size** — Ask AI now says what each panel is for (a current value, a trend, a breakdown, a ranking, a distribution or the rows) and CHouse picks a fitting chart and lays the panels out by section, so drafts come out tidy. Each draft runs in full first, and a chart that does not suit the result, such as a pie with 40 slices, is flagged with a fix. → [Draft dashboards with AI](/docs/dashboards-ai/)

**What changed, and why it spiked** — Line and area charts mark DDL, upgrades, settings changes, new writers, panel alerts, incidents, fixes and notes along the time axis, each read with your own access. Select a range to zoom, open its slowest queries, add a note, or **Explain this spike**: Chouse AI reads the range, a week earlier, the changes, queries, mutations and merges, and gives the likely cause with its evidence. → [Annotations and notes](/docs/dashboards/#annotations-and-notes)

**Is this normal?** — **Compare** draws a chart a day or a week earlier, dashed. An **expected range** draws the band a value usually falls in at that hour, from the past 2 to 8 weeks, and a panel alert can fire when it leaves the band. → [Compare and expected ranges](/docs/dashboards/#compare-and-expected-ranges)

**Drill-down and multi-value variables** — Click a bar, point or row to open another dashboard with its variables set, filter this one, or open the table in the explorer. Variables can now hold several values (`col IN {{var.status}}`). → [Drill-down](/docs/dashboards/#drill-down), [Variables](/docs/dashboards/#variables)

**Snapshots, reports and history** — Freeze every chart for a range in a **snapshot** that chosen roles can open, still within their own access. Send a **scheduled report** — a digest of values, ranges, top rows, errors and alerts, with a link to the dashboard at that time — to your notification channels daily or weekly. **Version history** keeps the last 50 saves and restores any of them. → [Snapshots](/docs/dashboards/#snapshots), [Scheduled reports](/docs/dashboards/#scheduled-reports), [Version history](/docs/dashboards/#version-history)

**Panel cost and rollups** — See what each panel reads per run and per hour at its refresh, with heavy panels flagged. A time-bucketed aggregate panel can propose a rollup: an approved fix builds a 1-minute pre-aggregated table, backfills it, and switches the panel only when the results match exactly. → [Panel cost and rollups](/docs/dashboards/#panel-cost-and-rollups)

**Import from Grafana, and a list that scales** — Import a Grafana dashboard and see, panel by panel, what converts, what changed and what was skipped and why before anything is saved. The dashboards list is now one searchable, sortable, paged table with tabs for yours, shared, pinned and templates. → [Import from Grafana](/docs/dashboards/#import-from-grafana)

**Agents and the CLI** — MCP gets `list_dashboard_versions`, `get_dashboard_annotations` and `create_dashboard_snapshot`; the chat can read what changed around a dashboard; and the CLI gets `chouse dashboard versions|restore|snapshot|import-grafana`. → [MCP tools](/docs/mcp-tools/), [CLI](/docs/cli/)

## Upgrading from 3.15

Migrations run on start; nothing to run by hand. Check these:

| What changed | What to do |
| --- | --- |
| Existing dashboards are converted to the canvas on start, keeping their panels' order and sizes; exports are now `chouse.dashboard/v2` | Nothing to do in CHouse. Update the `chouse` CLI before applying new exports with it; `chouse.dashboard/v1` files still import |
| Scheduled dashboard reports link back to the dashboard, so they need `PUBLIC_BASE_URL` | Set `PUBLIC_BASE_URL` (Helm `publicBaseUrl`) to CHouse's external URL before creating reports |
| Reports are sent, and expired snapshots deleted, by the Scheduled Queries scheduler | Nothing to do. With `SCHEDULED_QUERIES_ENABLED=false` on web pods, the dedicated scheduler sends them |
| A panel rollup runs with the connection's remediation credential | To use rollups, grant that credential `CREATE TABLE`, `CREATE VIEW`, `INSERT`, `DROP TABLE` and `DROP VIEW` on the panel's database, and `SELECT` on its table |
| A built-in *Spike Explainer* agent and its feature are installed on start | Nothing to do. Explaining a spike needs `ai:optimize` |
| New read-only MCP tools `list_dashboard_versions` and `get_dashboard_annotations` are on by default | Nothing to do; a token only lists them with `dashboards:view`. Switch them off in **AI Governance › MCP** to keep them from agents |
| *Operations Analyst* gets `get_dashboard_annotations` on start | Nothing to do for the built-in agent. If you customized it, it shows **Update available** in **AI Governance › Assistant** |

The full list of changes is in the [changelog](https://github.com/daun-gatal/chouse-ui/blob/main/CHANGELOG.md).
