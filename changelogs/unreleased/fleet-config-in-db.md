type: patch

### Changed
- **Fleet alert config & Doctor schedule now persist in the shared database** — alert rules/thresholds, Slack/Google Chat/email delivery settings, and the scheduled-scan config + run-state moved off local pod disk into the shared RBAC DB. This makes settings consistent across replicas, survive restarts, and immune to concurrent-write races. Existing `alert-config.json` / `doctor-schedule.json` files are imported automatically on first upgrade.

### Fixed
- **Scheduled health scans no longer double-fire under multiple replicas** — the scheduled Chouse AI scan is now gated by an atomic per-slot claim in the DB, so exactly one instance runs (and delivers) a given scheduled slot instead of every replica firing it.
