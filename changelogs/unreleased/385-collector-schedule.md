type: minor

### Added
- **Collection schedule** — Admin › Connections › Collection schedule sets how often each observability collector runs for every connection, and a connection's Edit dialog can override it or pause a collector. Each collector shows what its last run read from ClickHouse and that cost per day at the chosen interval. Stored in the RBAC database, so every replica follows the same schedule and changes apply without a restart (audited as `observe.collectors_update`)

### Fixed
- **Observability collector load** — The `usage` collector no longer re-scans 30 days of `system.query_log` (including query text) every 15 minutes: it reads only rows since its last run and keeps daily rollups of query shapes, filling in history from the newest days back. The `tables` collector reads only new `system.part_log` rows for write cadence instead of re-reading 7 days every 5 minutes
