type: minor

### Added
- **`chouse connection runs-as`** — shows which ClickHouse identity your statements run with on each connection (the connection's login, a ClickHouse role, or your own linked ClickHouse user), whether it is usable now, and what a personal connection refuses. It also lists a connection where your link is still waiting.
- **`chouse connection identity get|recheck`** (super admin) — a connection's kind, roles, health and which kinds its ClickHouse server can run, and running the login's checks now.
- **`chouse connection links list|add|grants|check|remove`** (super admin) — manage the links between accounts and ClickHouse users on a personal connection. `links grants` prints the GRANT statements for your ClickHouse administrator as SQL on stdout (`--revokes` for the REVOKEs). Confirming or removing a suspended link, switching a kind and editing the role map stay in the UI. `identity recheck` exits with 5 when the login fails its checks.

These commands need CHouse UI 3.18 or newer.
