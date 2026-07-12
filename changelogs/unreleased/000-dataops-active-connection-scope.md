type: patch

### Fixed
- **DataOps active-connection scoping** — Scheduled Queries and Data Health now show only the active connection's jobs, promises, and incidents, so editing, schema browsing, test runs, and AI assistance always operate on the connection a resource was created for. Resources pinned to other connections keep running in the background and reappear when switching connections. Updates can no longer silently move a job or promise to a different connection, and the AI preflight review is refused when the session is on a different connection than the job.
- **Scheduled Query job detail connection label** — show the connection's name instead of its raw id.
