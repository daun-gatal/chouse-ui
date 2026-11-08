type: patch

### Fixed
- **Per-user query and AI rate limits** — the `/api/query`, `/api/ai` and general API limits ran before sign-in was checked, so every caller on a server shared one bucket and one busy user could throttle everyone. They now count per user (browser sessions and the user's API/MCP tokens share one budget), or per client IP when signed out.
- **Secure generated passwords** — the "generate" buttons in Create user, Edit user and the ClickHouse user wizard now use the browser's secure random generator instead of `Math.random()`.
- **Explorer SQL quoting** — Create table, Query, Describe and Drop tabs quote database, table, column and cluster names, quote comments correctly, and reject a column type with extra SQL after it. A database's Query tab now opens `SHOW TABLES FROM <db>` instead of broken SQL.
- **`rbac:reset` resets everything** — it now drops every table CHouse UI creates (it used to drop only 8 old ones), and leaves other tables in a shared PostgreSQL database alone.
- **Clean shutdown** — stopping the server now also stops the AI approval sweeper, the auto-triage runner (handing its lease to another replica at once) and the Doctor scheduler.
- **ClickHouse users and roles reconnect** — these pages now recover when the server reports a stale connection (`CONNECTION_CONTEXT_STALE`).
- **API base URL** — sign-in, SSO, preferences and the other RBAC calls now honour `VITE_API_URL` and send cookies, like the rest of the app.
- **Format names** — `validateFormat` accepts every listed format in any case (only `CSV`, `TSV`, `JSON` and `XML` passed before).
- **Docs site under a sub-path** — landing-page and docs links respect `VITE_BASE_PATH`; before, the base path was never read in the browser.
- **Image: musl security fix** — the production image requires musl 1.2.5-r13 (CVE-2026-107891), so a stale base or build cache can't ship the vulnerable version.
