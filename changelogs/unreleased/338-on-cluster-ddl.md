type: patch

### Fixed
- **ON CLUSTER DDL** — `CREATE/DROP/ALTER ... ON CLUSTER` in the SQL editor no longer shows a false `JSON Parse error` on success; per-host results render as a table and plain DDL returns a clean success
