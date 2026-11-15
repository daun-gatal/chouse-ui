# Connection-identity lab

A CHouse UI you can click through to try the three connection kinds of
[ADR 0033](../../docs/adr/0033-every-statement-gets-a-clickhouse-identity.md)
by hand: a shared login, a role ceiling and a personal connection.

It is for manual testing. The automated suites are in
[`testbed/connection-identity/`](../connection-identity/).

## Start and stop

```bash
./up.sh                                   # build, start, seed
LAB_ORIGIN=http://my-host:3000 ./up.sh    # when the browser reaches it under another address
./up.sh down                              # stop and delete everything, volumes included
```

It needs only Docker and works with a remote daemon (`DOCKER_HOST`).
To use `docker compose` commands directly, copy `.env.example` to `.env` and set
`LAB_ORIGIN` there, so they use the same origin as `up.sh`; a different value
recreates the CHouse UI container.
`LAB_ORIGIN` is the address in your browser; CHouse UI refuses requests from
any other origin. Running `./up.sh` again rebuilds CHouse UI from the working
tree and keeps the data; the seed does nothing the second time.

## What runs

| Service | What | Port |
| --- | --- | --- |
| `chouse-ui` | Built from this working tree, with PostgreSQL for its own data | 3000 |
| `postgres` | PostgreSQL 16, CHouse UI's database (`chouse` / `lab`) | not published |
| `ch-a` | ClickHouse 26.3.63.123: passes the personal-connection self-test | 8200 |
| `ch-b` | ClickHouse 26.5.7.64: fails it (runs `CREATE` under `EXECUTE AS` unchecked) | 8201 |
| `docs` | The docs site and landing page, built from this working tree | 5173 |
| `seed` | Runs once: connections, roles, accounts, links | — |

Both ClickHouse servers hold the same data, users and roles
([`fixture.sql`](fixture.sql)). The ClickHouse administrator is `default` / `lab`.

To look at CHouse UI's own database:
`docker compose exec postgres psql -U chouse chouse`.

## Connections

| Connection | Server | Kind | ClickHouse user |
| --- | --- | --- | --- |
| **Production** | `ch-a` | Personal | `svc_personal` (roles `chouse_system`, `chouse_impersonate`) |
| **Analytics** | `ch-b` | Role ceiling | `svc_ceiling` (roles `chouse_system`, `analyst_ro`, `finance_rw`) |
| **Legacy** | `ch-b` | Shared login | `default` |

## Accounts

`admin` signs in with `Lab-admin-123!`; everyone else with `Lab-pass-123!`.

| Account | CHouse role | On Analytics | On Production |
| --- | --- | --- | --- |
| `admin` | Super admin | Not mapped: refused | No link: refused |
| `ann.lee` | Lab analyst (reads `shop`) | Role `analyst_ro` | Runs as `alice` (reads `shop`) |
| `ben.ortiz` | Lab finance (reads and writes) | Role `finance_rw` | Runs as `bob` (reads `shop`, writes `finance`) |
| `chris.wu` | Lab analyst | Role `analyst_ro` | Link to `carol` is **disabled**: she can create users |
| `dana.kim` | Lab analyst | Role `analyst_ro` | Link to `dave` **waits for the grant** |
| `eve.park` | Lab analyst | Role `analyst_ro` | No link |
| `omar.admin` | Admin (not super admin) | Not mapped: refused | No link |

`ben.ortiz` owns two scheduled queries, one on Production and one on Analytics.

## Things to try

**See who a statement runs as.** As `ann.lee`, run
`SELECT currentUser(), currentRoles()` on each connection: `alice` on
Production, `svc_ceiling` with `analyst_ro` on Analytics, `default` on Legacy.

**Let ClickHouse refuse.** As `ann.lee` on Production, run
`SELECT count() FROM finance.salaries`. ClickHouse refuses and names `alice`
and the missing grant. On Legacy the same statement is refused by CHouse UI's
data access rule instead. As `ben.ortiz` it works everywhere.

**Activate a waiting link.** As `admin`: Admin › Connections › **Linked
ClickHouse users** on Production shows `dana.kim` waiting, and the grant to
run. Run it on `ch-a`:

```bash
curl -u default:lab http://localhost:8200 -d "GRANT IMPERSONATE ON dave TO chouse_impersonate"
```

Then press **Check again**, or sign in as `dana.kim` and press it in Preferences.

**Suspend a link.** As `admin`, reset `ben.ortiz`'s password in Admin › Users.
Ben's link on Production is suspended, and his scheduled query there is
refused on its next run, with the reason on the run. Only a super admin can
confirm the link again: `omar.admin` cannot. (`omar.admin` cannot reset Ben's
password either, because Ben's role is mapped to a ClickHouse role on Analytics.)

**Disable a link.** Drop and recreate a linked user, then press **Check now**
in the connection's ClickHouse login panel:

```bash
curl -u default:lab http://localhost:8200 -d "DROP USER alice"
curl -u default:lab http://localhost:8200 -d "CREATE USER alice IDENTIFIED BY 'lab'"
```

**Statements a personal connection refuses.** On Production: `SET max_threads = 1`,
`USE finance`, `INSERT INTO finance.imports VALUES (1, 'a')`,
`SELECT 1 FORMAT CSV`, `EXECUTE AS bob SELECT 1`, `SYSTEM FLUSH LOGS`.

**Import a file as yourself.** As `ben.ortiz` on Production, import a CSV into
`finance.imports` from the explorer. As `ann.lee` it is refused.

**A build that does not qualify.** As `admin`, open **ClickHouse login** on
Legacy, choose **Personal**, user `svc_personal`, password `lab`, system role
`chouse_system`, impersonation role `chouse_impersonate`, and press **Check**.
The check that `CREATE` is access-checked fails on 26.5.7 and nothing is saved.

**A login that drifts.** Give the ceiling login a direct grant and press
**Check now** on Analytics: the connection refuses everyone until it is revoked.

```bash
curl -u default:lab http://localhost:8201 -d "GRANT SELECT ON shop.* TO svc_ceiling"
curl -u default:lab http://localhost:8201 -d "REVOKE SELECT ON shop.* FROM svc_ceiling"
```

**What ClickHouse logged.** On `ch-a`:

```bash
curl -u default:lab http://localhost:8200 -d "SYSTEM FLUSH LOGS"
curl -u default:lab http://localhost:8200 -d "SELECT user, authenticated_user, query_id, substring(query, 1, 60) FROM system.query_log WHERE type = 'QueryFinish' AND event_time > now() - 600 ORDER BY event_time DESC LIMIT 10 FORMAT PrettyCompact"
```

## The passwords and secrets here are for the lab only

They are written in this directory and in `docker-compose.yml`. Do not reuse
them, and do not expose the lab to a network you do not trust.
