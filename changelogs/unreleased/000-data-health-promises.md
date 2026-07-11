type: minor

### Added
- **Data Health Promises** — protect ClickHouse datasets with scheduled freshness, volume, per-column completeness, composite-key uniqueness, repeatable validity rules, schema, and repeatable custom-metric checks; investigate evidence and manage low-noise incidents from DataOps.

### Fixed
- **PostgreSQL Data Health evaluation** — update healthy and non-healthy timestamps without an untyped nullable SQL parameter, preventing evaluation finalization failures on PostgreSQL.
