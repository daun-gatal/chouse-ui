# Saved queries & history

Saved queries persist the SQL your team reuses; history keeps every execution findable. Both are per-connection aware.

## Saved queries

Manage under the workspace's saved-queries panel (`saved_queries:*` [permissions](/docs/permissions/)):

| Action | Permission |
| --- | --- |
| View | `saved_queries:view` |
| Create | `saved_queries:create` |
| Update | `saved_queries:update` |
| Delete | `saved_queries:delete` |
| Share | `saved_queries:share` |

- Queries are **organized by connection** — a saved query belongs to the cluster it was written for
- **Sharing** exposes a personal query to the team (subject to data access rules at run time)
- Saved queries surface in the [command palette](/docs/workspace-command-palette/) for one-keystroke recall

## Query history

Every execution in the [editor](/docs/workspace-editor/) is recorded:

- **Own history** by default (`query:history:view`)
- **Everyone's history** with `query:history:view:all` — for admins and reviewers
- Entries carry SQL, timing, status and the connection used; re-run with one click

History complements the [audit log](/docs/audit-log/): history is workflow-oriented (re-run, iterate), audit is governance-oriented (who did what).

## Patterns that work well

| Pattern | Setup |
| --- | --- |
| Team playbook | A shared set of saved queries per cluster (connect + [share](/docs/permissions/)) |
| Recurring extraction | Save the query, then promote it to a [scheduled job](/docs/scheduled-queries/) |
| Parameterized reports | Combine saved queries with Redash-style dashboards (see [By Redash](/docs/monitoring-query-logs/)) |
| Fast recall | `Cmd/Ctrl+K` → type a fragment of the name — see [Command palette](/docs/workspace-command-palette/) |

> **Tip:** Saved queries still pass [data access rules](/docs/data-access-rules/) at run time — a shared query can exist for everyone but only return data for users whose rules allow the tables it touches.
