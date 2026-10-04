# Performance, capacity & upgrades

Three Monitoring tabs added by [ADR 0016](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0016-data-observability-platform.md).

## Performance (`performance:view`)

Every query shape (`normalized_query_hash`, per replica) is compared with its own 14-day baseline. A **regression** is p95 latency or bytes read at 1.5× or more, listed next to the **changes** around its onset: version upgrades, DDL, settings-profile changes and writer releases. Open one for the per-replica p95 series; with `query:history:view:all`, run `EXPLAIN indexes = 1` on this connection and, optionally, another to compare plans across versions.

## Capacity (`capacity:view`)

Disk usage per node over 30 days with a forecast of when each disk reaches its threshold (85% by default), the fastest-growing tables, and cold tables (data that nobody read for a week). **Measure a codec** (`upgrades:run`) copies a sample of one column into a scratch database and measures the compression a candidate codec would give — the original table is never touched. With `cost:view`, bytes read by each consumer are priced at your configured rates (edit rates with `settings:update`).

## Upgrades (`upgrades:view`)

- **Check** a target version (`upgrades:run`): a rules pack is matched against your real workload — column types, database engines, settings profiles, query settings and functions in use — and only the findings that apply are shown (blocker, warning, info).
- **Replay** the top read-only query shapes on a canary connection running the other version: same result, different result, slower, or error.
- **Rollout tracker**: every connection's version with replica-lag, regression and replica-health gates.
