type: minor

### Added
- **What your statements run as, for agents and scripts** — a new MCP tool, `connection_runs_as`, and the CLI command `chouse connection runs-as` report which ClickHouse identity a caller's statements carry on each connection, whether it is usable now, and what a personal connection refuses. An agent can find out before its first statement instead of from a refusal.
- **Links from the command line** — a super admin can list, add, re-check and remove the links between accounts and ClickHouse users with `chouse connection links`, and print the GRANT script for the ClickHouse administrator.
- **Identity lab** — `testbed/identity-lab/` starts CHouse UI with PostgreSQL and two ClickHouse servers, seeded with one connection of each kind, to try them by hand.

### Changed
- **Switching a connection's kind, editing its role map, and confirming or removing a suspended link need a browser session** — a personal access token or an agent can no longer do these, even a super admin's. They store credentials or decide what ClickHouse lets every account do.
