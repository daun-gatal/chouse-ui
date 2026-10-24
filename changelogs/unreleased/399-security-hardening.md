type: patch

### Fixed
- **Data access rules cover every table a query touches** — tables read through scalar or `IN`/`EXISTS` subqueries, `UNION` arms, `INSERT … SELECT` / `CREATE … AS SELECT` sources, a same-named table in another database, a db-qualified name shadowed by a CTE, and `dictGet`/`joinGet` lookups are now checked against the user's data access rules, so a user limited to some databases can no longer read others through them
- **Data-reaching table functions are admin-only** — `remote`, `cluster`, `merge`, `url`, `file`, `s3` and similar table functions are denied to non-admins because they read data the per-table rules can't see; inline-data functions such as `numbers()` keep working
- **Explorer create/drop respect data access rules** — creating or dropping a database or table from the explorer now checks the user's data access rules, like the same statement in the SQL editor
- **Explorer table creation validates every clause** — column types, engines and ORDER BY / PARTITION BY / PRIMARY KEY must be well-formed on their own, `DEFAULT`/`COMMENT` values escape backslashes, and non-admins are limited to local-storage table and database engines
- **Admins can't grant more than they hold** — assigning a role, creating or updating a user, and creating or updating a role now refuse anything that grants permissions the caller doesn't have, so an `admin` can no longer make themselves or a new account `super_admin`
- **Request size limit counts the bytes actually received** — the 10 MB cap now also applies to requests sent without a `Content-Length` header
- **File import respects permissions and data access rules** — importing a file now needs `table:insert` and access to the target table, only CSV, TSV and JSON are accepted, and the import preview requires a signed-in user
- **Backslashes are escaped in generated ClickHouse statements** — ClickHouse user/role management, the live-query kill action and the recent-queries filter now escape `\` as well as quotes, so values ending in a backslash (such as a password) no longer break or alter the statement
- **Health endpoints no longer return raw database errors** — `/api/rbac/health` and `/api/rbac/status` log the error server-side instead of returning it
- **Login brute-force limit can't be bypassed with `X-Forwarded-For`** — the per-IP login and SSO limits key on the address the nearest proxy appended, and login adds a per-account limit (20 attempts per 15 minutes)
- **No credentialed CORS for a wildcard origin** — with `CORS_ORIGIN=*` the server no longer echoes any origin with `Access-Control-Allow-Credentials`, and `*.example.com` entries match on hostname so lookalike domains are rejected
- **SSO redirect guard rejects control characters** — a post-login redirect such as `/\t/evil.com` falls back to `/`
- **Dependency advisories** — nodemailer 10.1.4 (address-parser recipient injection), fast-uri 3.1.9, vite 7.3.7, rollup, postcss and other transitive packages are patched; vitest moves to 4.1.12; the unused `happy-dom` and `drizzle-kit` dev dependencies are removed; `bun audit` is clean for the app and the docs site

### Added
- **Security rules for contributors** — `.rules/SECURITY.md` is the security baseline: threat model, authorization and privilege escalation, data access and SQL building, tokens and sessions, SSO, browser controls, SSRF, secrets and audit, AI/MCP, resource limits and uploads, ClickHouse user management, CLI, container/Helm, dependencies and CI, vulnerability handling, and a review checklist
