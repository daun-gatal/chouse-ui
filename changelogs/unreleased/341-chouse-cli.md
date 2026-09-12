type: minor

### Added
- **chouse CLI** — safe browserless operations for CHouse UI as versioned Go binaries shipped with every app release (same version/tags/gates via `auto-release.yml`, `curl | bash` installer). PAT-only auth (`CH_HOUSE_PAT`), operator-complete commands (query, explorer, metrics/logs, live, fleet/doctor, scheduled, data health, alerting, AI optimize, upload preview, audit), safe-by-default guards (`--yes` + `--dry-run`, exit codes `0/2/3/4/5/6`, `--output json`). Break-glass admin stays UI-only. See `docs/cli.md` and ADR 0012.
