type: patch

### Fixed
- **User management metric cards** — Active/Inactive (and Total) counts on the Admin → User management tab are now computed from backend totals over the whole filtered set instead of the current page, so they no longer change when the page size changes.
- **Query Logs RBAC user** — Query Logs now reads the RBAC actor from the dedicated `log_comment` column (falling back to the `Settings` map), so queries run through the app correctly attribute to the RBAC user instead of falling back to the bare ClickHouse user. RBAC-user resolution is also decoupled from the audit-log fetch: a failing or permission-gated audit request (e.g. right after login) no longer drops every row back to the ClickHouse user, since `log_comment`-tagged queries resolve independently. A resolved-but-deleted RBAC user no longer leaks a raw UUID into the user column.
