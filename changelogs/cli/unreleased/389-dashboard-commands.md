type: minor

### Added
- **Dashboards** — `chouse dashboard list|get|export|apply -f|run-panel|delete`: export a dashboard as JSON, create or update one from that JSON (`apply` updates the dashboard its id names at its current version), run one panel with `--range` and repeatable `--var name=value`, and delete with `--yes` (needs a 3.15 server)
