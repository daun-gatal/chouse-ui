type: minor

### Added
- **Upgrade check** — **Monitoring › Upgrades** shows whether the connection's ClickHouse version is still supported, when its last patch came out, and the versions worth moving to (the newest LTS recommended, a same-line patch first when one is out). **Check** compares the target with your real workload: exactly against another of your connections on the target line (settings and their defaults, obsolete settings, functions, types, engines and formats), or from the breaking-change notes between the two versions. Only changes your schema, settings profiles and 30 days of `query_log` use become findings, each with its sources, evidence, callers and the SQL to fix it or keep today's defaults; notes that name what you use are listed to judge, and **Copy as Markdown** gives a report. Release data and notes come from GitHub and Docker Hub when `UPGRADE_CHECK_ENABLED` (Helm `observability.upgradeCheckEnabled`) is on (ADR 0029)
- **Try it on this server** — a check also plans your top 200 read-only query shapes on the current server with `EXPLAIN`, once with the settings each ran with and once with the target's (the new analyzer on, plus the changed defaults in an exact check). Queries that fail only with the target's settings become findings with the setting that breaks them, their callers and the error; plans that change are a heads-up. Nothing is executed. On by default, with a checkbox to turn it off
- **Chouse AI reads the release notes** — when a model is set up, it turns the notes that matter for your workload into findings; each must cite a note and names from your workload, or it is dropped
- **Fleet version colour** — a card's version turns red when its line is out of support and amber when a newer patch is out, with the reason on hover and a link to Upgrades
- **MCP and assistant tool `get_upgrade_status`**; `run_upgrade_assessment` takes a connection to compare with

### Removed
- **Upgrade rollout tracker**, the six-rule readiness pack and its verdict; the MCP and assistant tool `get_upgrade_rollout` and `GET /api/upgrades/rollout` and `/rules`
- **Workload replay on a canary** — replaced by trying the workload on the current server; the `get_canary_replay` and `run_canary_replay` tools and `/api/upgrades/replays` are removed
