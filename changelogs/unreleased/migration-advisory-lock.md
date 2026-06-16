type: patch

### Fixed
- **Migrations no longer race across replicas at startup (multi-replica PostgreSQL only)** — every replica runs RBAC migrations on boot, so when running **more than one replica** on PostgreSQL, a rolling deploy or scale-up could have several pods migrate the same database concurrently and the loser would crash on a duplicate version-table insert (or a non-idempotent step). `runMigrations()` now takes a PostgreSQL session-level advisory lock on a dedicated reserved connection, so exactly one replica migrates at a time and the others wait, then observe the work as already applied. Single-replica and SQLite deployments are unaffected (the lock is a no-op there).
