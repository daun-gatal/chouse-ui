type: patch

### Fixed
- **No more `system.grants` probe on connect** — connecting no longer checks whether the connection's ClickHouse user is an admin. That check failed with `ACCESS_DENIED` (and logged "Failed to check admin status" about once a minute) on users without `SELECT ON system.grants`, and missed admin rights granted through roles. CHouse UI authorises from its own roles, so nothing depended on it (#422).
- **Recent queries respect query history permissions** — the Home page and the command palette list everyone's recent queries only for admins and holders of `query:history:view:all`. Everyone else sees the queries they ran in CHouse UI on the current connection. The list now covers the last 7 days, so the log scan stays bounded.
- **`GET /api/metrics/custom` follows data access rules** — the query is checked like one from the SQL editor before it runs, so it can no longer read tables the caller's rules deny.

### Removed
- **`isAdmin` and `permissions` in the connect response** — `POST /api/rbac/connections/:id/connect` no longer returns them; they described the ClickHouse user, not the CHouse user, and were often wrong.
- **`GET /api/rbac/connections/session`** — the route was registered after `GET /:id`, so it always answered `404 Connection not found` and nothing called it.
