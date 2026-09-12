type: patch

### Fixed
- **CLI explicit server config** — removed the silent `http://localhost:5521` default; commands needing a server now fail fast with setup guidance (`--server`, `CHOUSE_SERVER`, or `chouse auth login --server …`), mirroring the missing-PAT error.
- **CLI `version` is offline** — prints the binary version instantly without contacting any server; use `chouse status` for server version and migrations.
