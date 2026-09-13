# Compatibility matrix

Version combinations CHouse UI has been tested against end-to-end.

## Tested versions

| Component | Version | Notes |
| --- | --- | --- |
| ClickHouse | 24.11 | Monitoring suite verified end-to-end against a production cluster |
| ClickHouse | 25 | Query logs, metrics, fleet |
| PostgreSQL | 18 | RBAC database (`RBAC_DB_TYPE=postgres`) |
| SQLite | 3.51.0 | RBAC database via Bun's built-in SQLite (`RBAC_DB_TYPE=sqlite`) |

## Runtime requirements

| Requirement | Minimum |
| --- | --- |
| Bun (development) | 1.0+ |
| Node.js (alternative runtime) | 18+ |
| RAM | 2 GB recommended |
| Ports | `5521` (UI/server), `8123` (ClickHouse HTTP), `8752` (MCP, optional) |

## Deployment targets

| Target | Notes |
| --- | --- |
| Docker / Docker Compose | Primary install path — see [Docker deployment](/docs/deploy-docker/) |
| Kubernetes / Helm | Signed OCI chart on GHCR — see [Helm chart](/docs/deploy-helm/) |
| Source (`bun run dev`) | Frontend `:5173`, backend `:5521` |

## Monitoring caveats

The monitoring suite reads ClickHouse system tables (`system.query_log`, `system.part_log`, `system.replicas`, …). Clusters must have:

- `query_log` enabled (default on most installs)
- Sufficient permissions for the connection user to read `system.*`
- Clock sync between CHouse UI and ClickHouse hosts (time-window filters)

If a system table is missing, the corresponding tab shows an empty/degraded state rather than failing the page — see [Monitoring overview](/docs/monitoring-overview/).

## Browsers

Any current Chromium- or Gecko-based browser. The UI is responsive on desktop and tablet; container-query layouts adapt per component rather than per viewport.
