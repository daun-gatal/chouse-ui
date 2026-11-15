type: patch

### Fixed
- **A scoped personal access token is held to its scopes everywhere** — a token whose scopes were narrowed could still pass permission checks on routes outside them when its owner held the permission. Every permission check for a token's request now answers from the token's own scopes. This covers personal access tokens and agents' OAuth grants. **If you rely on a scoped token for something outside its scopes, it now gets 403: add the permission to the token's scopes, or create a new token.** Tokens without scopes and browser sessions are unchanged.
- **An administrator's scoped token is held to its scopes in the SQL editor routes** — a statement from an administrator skips the permission check for its kind, and that applied to a scoped token too. A scoped token is now checked like anyone else's for the kind of statement (select, insert, DDL) and for the system tables that need a permission. Data access rules still do not restrict an administrator's token.
- **A scoped token is refused where only a role gates an action** — changing a connection's kind, role map or linked ClickHouse users needs a super admin, and a token keeps its owner's roles whatever its scopes. A scoped token is now refused there; use a browser session or a token without scopes.
- **The profile shows a token's own permissions** — `whoami` over MCP and `chouse auth whoami` listed the owner's permissions for a scoped token. They now list what the token may do.
- **Account names in the GRANT script** for linked ClickHouse users are written as plain comment text.
- **Connection details in the profile** — for someone who is not a super admin the profile no longer includes a connection's role names, server version or the reason a check failed, as on the connection list.
