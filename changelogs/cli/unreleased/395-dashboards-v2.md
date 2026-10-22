type: minor

### Added
- **`chouse dashboard versions` and `restore`** — list a dashboard's last 50 saves and restore one as a new version, after listing the alerts it would remove
- **`chouse dashboard snapshot create|list|get`** — freeze a dashboard's results for a range, list the snapshots you may open, and write one as JSON
- **`chouse dashboard import-grafana -f FILE`** — preview how a Grafana dashboard converts; `--apply` imports the convertible panels

### Changed
- **`chouse dashboard apply`** — takes `chouse.dashboard/v2` exports (CHouse 3.16+) as well as v1
- **`chouse dashboard get`** — shows each panel's kind and canvas size (`SIZE`) instead of `WIDTH`
- **`chouse dashboard run-panel --var`** — repeating a name sends a list for a multi-value variable; an unknown variable is refused before the panel runs
