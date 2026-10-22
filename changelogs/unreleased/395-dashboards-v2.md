type: minor

### Added
- **Dashboard canvas** — panels are placed and resized freely on a 24-column grid, never overlapping or going below a readable size; new text (Markdown) and heading panels; **Tidy up** lays a dashboard out by section and role. Existing dashboards are converted on upgrade, and `chouse.dashboard/v1` exports still import
- **AI-chosen charts and layout** — Ask AI says what each panel is for, CHouse picks a fitting chart and places it, and drafts run in full with a chart-fit check that can switch a crowded chart
- **Annotations and notes** — line and area charts mark DDL, upgrades, settings changes, new writers, panel alerts, incidents, fixes and notes, each read with the viewer's access; select a range to zoom, open its slowest queries or add a note
- **Explain this spike** — Chouse AI explains a selected range from the panel, a week earlier, the changes, queries, mutations and merges, and lists what it could not read
- **Compare and expected ranges** — draw a chart a day or a week earlier, or the band a value usually falls in over the past 2–8 weeks, with panel alerts on leaving the band
- **Drill-down links and multi-value variables** — click through to another dashboard, filter this one or open a table; variables can hold several values
- **Panel cost and rollups** — each panel shows what it reads per run and per hour; a time-bucketed aggregate panel can propose a verified 1-minute rollup through the fixes approval flow
- **Version history, snapshots and scheduled reports** — restore any of the last 50 saves; freeze a dashboard's results for chosen roles; send a daily or weekly digest with a link (needs `PUBLIC_BASE_URL`)
- **Grafana import** — preview what converts, what changed and what was skipped before importing a Grafana dashboard
- **MCP and chat** — `list_dashboard_versions`, `get_dashboard_annotations` and `create_dashboard_snapshot` (off by default); the chat can read a dashboard's annotations

### Changed
- **Dashboards list** — one searchable, sortable, paged table with tabs for all, mine, shared, pinned and templates
- **Exports** — dashboards export as `chouse.dashboard/v2`

### Fixed
- **MCP `run_dashboard_panel`** — accepts a list for a multi-value variable, as its schema documents
