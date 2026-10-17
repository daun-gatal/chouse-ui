type: minor

### Added
- **Dashboards** — a new Dashboards page for your own charts of ClickHouse: panels are read-only queries with a chart, sharing a time range, variables (`{{from}}`, `{{to}}`, `{{interval_s}}`, `{{var.NAME}}`, bound as native query parameters) and auto-refresh, all kept in the URL. Every panel runs with each viewer's own connection and table access; results are shared between viewers for 30 s, and every query is capped (30 s, 10,000 rows, 20 GiB read) and fails with a message instead of being cut short. Share with roles, pin to Home, duplicate, export and import JSON. New permissions `dashboards:view|edit|delete|share|manage`
- **Dashboard templates** — six curated templates (ClickHouse overview, merges and parts, replication, query latency, disk and tables, Kafka and S3Queue ingestion), and Open as dashboard on Monitoring › Performance and Capacity
- **Chart tab** — the SQL workspace charts a result from its column types and pins it to a dashboard
- **Panel alerts** — threshold alerts on a dashboard panel, delivered to the existing notification channels when they fire, resolve or can't be evaluated, evaluated as their owner with access re-checked every time; listed in Admin › Alerting
- **Fleet panels** — a panel can run on every connection you may use, one series per connection, with each failing connection listed
- **Draft a dashboard with AI** — Ask AI drafts a dashboard or new panels from a goal; every panel is checked and dry-run with your access before you accept it (built-in *Dashboard Drafter* agent)
- **Dashboards for agents** — MCP tools `list_dashboards`, `get_dashboard`, `export_dashboard`, `run_dashboard_panel` (on by default), `apply_dashboard` and `delete_dashboard` (off by default); CHouse Admin's Operations Analyst reads dashboards
