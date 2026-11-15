type: minor

### Added
- **Personal connections** — a third connection kind. A super admin links each CHouse account to a ClickHouse user, and that person's statements run as that user (`EXECUTE AS`), so the grants, row policies and quotas already in ClickHouse decide what they reach. The connection's own ClickHouse user holds no grant; CHouse UI stores no password for the linked users. Existing connections are unchanged.
- **Server self-test** — a connection can be personal only on a ClickHouse build that checks the target user's grants for every statement run with `EXECUTE AS`. CHouse UI tests this before the switch and every five minutes, and again at most a minute before a statement runs as a person. Of the builds tested, 26.3.63 passes; 26.5.7 (it runs `CREATE` unchecked) and builds without `EXECUTE AS` are refused.
- **Links between accounts and ClickHouse users** — Admin › Connections › Linked ClickHouse users (super admin): create, confirm and remove links, see the `GRANT` to hand to the ClickHouse administrator, and the users the connection may still act as without a link. A link is suspended when someone else resets the account's password or changes its email, when a sign-in identity is added or removed, and on reactivation; it is disabled when the ClickHouse user was dropped and created again or gains a privilege that manages users.
- **Your ClickHouse user in Preferences and the connection switcher** — each person sees which ClickHouse user their statements run as on a personal connection, and the state of the link.
- **File import on a personal connection** — rows go in as the person, through a short ClickHouse session.

### Changed
- **On a personal connection** data access rules do not decide what a statement reaches (the person's ClickHouse user does; rules still limit collected monitoring evidence), `SET`, `USE`, `INSERT … VALUES` and a typed `FORMAT` clause are refused, only statement kinds on a tested list run, and materialize jobs, ClickHouse user management and background reads of table data are unavailable.

### Fixed
- **Column names in a file import** are written as quoted identifiers, so a name with a space or another special character imports correctly and is never read as SQL.
- **`DELETE FROM` and `UPDATE` in the SQL editor** — a lightweight delete or update typed in the editor failed with a syntax error at `FORMAT`. They now run as commands, on every connection kind.
