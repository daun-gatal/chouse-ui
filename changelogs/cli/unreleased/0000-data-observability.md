type: minor

### Added
- **`chouse health dataset`** — one table's trust state, freshness, volume baseline and open incidents
- **`chouse lineage`** — table lineage across sources, materialized views, dictionaries and scheduled jobs, with `--impact` for downstream blast radius
- **`chouse incidents`** — data and pipeline incidents from every source with their root-cause summary
- **`chouse remediation list|get|approve|reject`** — review proposed fixes and approve or reject them (`--yes`); approval rules stay server-side
