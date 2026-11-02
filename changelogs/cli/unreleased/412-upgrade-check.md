type: minor

### Added
- **`chouse upgrades status`** – the `-c` connection's ClickHouse version, whether it is still supported, and the upgrade targets on offer (recommended LTS first).
- **`chouse upgrades fleet`** – every connection's version, support status and last upgrade check.

### Changed
- **`chouse upgrades rollout`** – now an alias of `fleet`; the rollout gates it listed live on the Fleet page and in Performance. `list` shows each check's mode and status instead of a verdict.

### Removed
- **`chouse upgrades replay`** – the workload replay on a canary is gone; an upgrade check now plans your top queries on the server with the target's settings instead.
