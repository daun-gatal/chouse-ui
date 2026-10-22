---
generated: the chouse command tree (src/content/reference/cli.json)
---
Every `chouse` command and flag, generated from the CLI itself. For installing, signing in, profiles, output formats and exit codes, read the [CLI guide](/docs/cli/) first.

## Global flags

Every command accepts these. Most can also come from the environment or the active profile.

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--ca-cert` | `string` |   | PEM CA bundle to trust for the server, e.g. an internal CA (env CHOUSE_CA_CERT) |
| `-c, --connection` | `string` |   | ClickHouse connection name or id (env CHOUSE_CONNECTION) |
| `--debug` |   |   | trace each request (method, path, status, time, request id) on stderr; never prints tokens |
| `--dry-run` |   |   | preview a change without making it, where supported |
| `--insecure-skip-tls-verify` |   |   | do not verify the server certificate — debugging only (env CHOUSE_INSECURE_SKIP_TLS_VERIFY) |
| `--no-headers` |   |   | omit the header row in table and csv output |
| `-o, --output` | `string` |   | output format: auto\|table\|csv\|json\|yaml (default auto: table on a terminal, json when piped; env CHOUSE_OUTPUT) |
| `--profile` | `string` |   | config profile (env CHOUSE_PROFILE) |
| `-q, --quiet` |   |   | no notes on stderr (results and errors still print) |
| `--server` | `string` |   | CHouse UI server URL (env CHOUSE_SERVER) |
| `--timeout` | `int` | `60` | request timeout in seconds (1-600) |
| `--token` | `string` |   | personal access token ch_pat_… (env CH_HOUSE_PAT; prefer the env or auth login) |
| `--wide` |   |   | do not truncate long table cells |
| `--yes` |   |   | approve changes without a prompt (required without a terminal) |

## Getting started

### chouse auth

Log in with a personal access token.

Manage the personal access token (PAT) this CLI uses. Tokens are
stored 0600 in ~/.config/chouse/credentials.yaml and never printed (only a
masked form). Log in once per profile; every other command then just works.

```bash
chouse auth
```

```bash
chouse auth login --server https://chouse.corp
echo "$TOKEN" | chouse auth login --server https://chouse.corp --token-stdin
chouse auth status
chouse auth whoami
```

#### chouse auth login

Validate a token and store it for the profile.

Validate a personal access token against the server and store it
(0600) for the profile, remembering --server and --ca-cert so later commands
need no flags. The token is read from a hidden prompt, --token-stdin or
CH_HOUSE_PAT — never pass it as an argument. Mint it once in the UI:
Preferences → Personal access tokens.

```bash
chouse auth login [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--token-stdin` |   |   | read the token from stdin |

```bash
chouse auth login --server https://chouse.corp
chouse auth login --server https://chouse.internal --ca-cert corp-ca.pem --profile prod
echo "$TOKEN" | chouse auth login --server https://chouse.corp --token-stdin
```

#### chouse auth logout

Remove the stored token for the profile.

Delete the profile's stored token from this machine. The token
stays valid on the server — revoke it in the UI to retire it.

```bash
chouse auth logout
```

```bash
chouse auth logout
chouse auth logout --profile prod
```

#### chouse auth status

Show the effective profile without printing secrets.

Show the resolved profile, server, connection, CA bundle and masked
token — fully offline, safe to run any time to check what later commands use.

```bash
chouse auth status
```

```bash
chouse auth status
chouse auth status -o json
```

#### chouse auth whoami

Show the token's user, roles and permissions.

Ask the server who the token belongs to: user, roles, permissions and data-access rules.

```bash
chouse auth whoami
```

```bash
chouse auth whoami
chouse auth whoami -o json | jq .permissions
```

### chouse config

Profiles and their settings.

Profiles hold non-secret defaults — server, connection, output and
CA bundle — in ~/.config/chouse/config.yaml. Tokens live separately in
credentials.yaml and are set with chouse auth login. --profile (or
CHOUSE_PROFILE) picks a profile for one command; use-profile switches the
default.

```bash
chouse config
```

```bash
chouse config view
chouse config set connection prod
chouse config use-profile staging
chouse config profiles
```

#### chouse config delete-profile

Delete a profile and its stored token.

```bash
chouse config delete-profile <name>
```

```bash
chouse config delete-profile old --yes
```

#### chouse config get

Print one profile setting (server, connection, output, ca_cert).

Print one setting stored in the profile (not the flag or environment override).

```bash
chouse config get <key>
```

```bash
chouse config get server
```

#### chouse config profiles

List profiles.

```bash
chouse config profiles
```

```bash
chouse config profiles
```

#### chouse config set

Set a profile setting (server, connection, output, ca_cert).

Store a non-secret setting in the profile (current, or --profile).
connection takes a name or an id; output takes auto, table, csv, json or
yaml; ca_cert is stored as an absolute path. Tokens are not settable here —
use chouse auth login.

```bash
chouse config set <key> <value>
```

```bash
chouse config set server https://chouse.corp
chouse config set connection prod
chouse config set output json --profile ci
```

#### chouse config unset

Clear a profile setting.

```bash
chouse config unset <key>
```

```bash
chouse config unset connection
```

#### chouse config use-profile

Make a profile the default.

Switch the default profile. It must already exist (create one with chouse auth login --profile NAME).

```bash
chouse config use-profile <name>
```

```bash
chouse config use-profile prod
```

#### chouse config view

Show the effective settings and where each comes from.

Show the settings this invocation resolves to (flags > environment > profile), with the token masked.

```bash
chouse config view
```

```bash
chouse config view
chouse config view --profile prod -o yaml
```

### chouse connection

ClickHouse connections you can use.

List, inspect and check the ClickHouse connections your token can
use. Every command takes -c with a connection name or id; set a default with
chouse config set connection NAME. Creating and deleting connections stores
or removes credentials, so it stays in the UI (Admin › Connections).

```bash
chouse connection
```

Aliases: `conn`, `connections`

```bash
chouse connection list
chouse connection get prod
chouse connection can-i analytics events -c prod
```

#### chouse connection can-i

Check whether you may read a database or table.

Ask the server whether your token may read a database, or one
table, on the -c connection. Run it before scripting anything that assumes
access.

```bash
chouse connection can-i <database> [table]
```

```bash
chouse connection can-i analytics -c prod
chouse connection can-i analytics events -c prod -o json
```

#### chouse connection get

Show one connection (no password).

```bash
chouse connection get <name|id>
```

```bash
chouse connection get prod -o yaml
```

#### chouse connection list

List the connections you can use (no passwords).

```bash
chouse connection list [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--limit` | `int` | `0` | max rows (0: all) |
| `--search` | `string` |   | filter by name or host |

```bash
chouse connection list
chouse connection list --search prod -o json
```

#### chouse connection test

Check that a connection is reachable.

Dial a saved connection and report reachability and the server
version. Nothing is stored or changed. Testing ad-hoc credentials stays in
the UI.

```bash
chouse connection test <name|id>
```

```bash
chouse connection test prod
```

### chouse status

Server health, version, compatibility and migration status.

Probe the configured server: health, version and whether this CLI
supports it, plus (with a token) the RBAC migration state. Run it before
debugging anything else.

```bash
chouse status
```

```bash
chouse status
chouse status -o json
```

### chouse version

Print the CLI version (server version: chouse status).

Print the CLI version, build commit and date. Always offline — it
never contacts a server, so it doubles as the install check. chouse status
shows the server version and whether this CLI supports it.

```bash
chouse version
```

```bash
chouse version
chouse version -o json
```

## Query and explore

### chouse query

Run SQL: read-only by default, writes with --raw.

Run SQL on the -c connection. SELECT, WITH, SHOW, DESCRIBE and
EXPLAIN run directly and print as a table (or -o csv/json/yaml). Anything
else needs --raw, and then a confirmation or --yes; --dry-run estimates it
without running it. Give SQL as arguments, -f FILE (- for stdin) or --stdin.
--out FILE writes the result to a file (format from the extension).

```bash
chouse query [sql] [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--explain` | `string` |   | show the plan instead of running: plan\|ast\|syntax\|pipeline\|estimate |
| `-f, --file` | `string` |   | read SQL from a file (- for stdin) |
| `--format` | `string` | `JSON` | with --raw: the server result format (JSON, JSONEachRow, CSV, TabSeparated) |
| `--limit` | `int` | `1000` | max result rows (1-100000) |
| `--out` | `string` |   | write the result to a file (.csv, .json, .yaml) |
| `--raw` |   |   | allow any SQL (writes need confirmation or --yes) |
| `--stdin` |   |   | read SQL from stdin |

```bash
chouse query "SELECT name, engine FROM system.tables LIMIT 5"
chouse query -f report.sql --out report.csv
chouse query "SELECT * FROM events LIMIT 1000" -o csv > events.csv
chouse query --explain plan "SELECT * FROM big WHERE day = today()"
chouse query --raw --dry-run "ALTER TABLE t DELETE WHERE id = 2"
chouse query --raw --yes "ALTER TABLE t DELETE WHERE id = 2"
```

### chouse saved

Saved queries: list, show, run, create, delete.

Named queries shared with the UI. run executes one through the
read-only path (saved writes are refused — use query --raw); delete asks
first (or needs --yes).

```bash
chouse saved
```

Aliases: `saved-queries`

```bash
chouse saved list
chouse saved run 3f2a… -o csv > out.csv
chouse saved create --name daily-orders -f orders.sql
```

#### chouse saved create

Save a query (SQL as arguments, -f FILE or --stdin).

```bash
chouse saved create [sql] [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--description` | `string` |   | description |
| `-f, --file` | `string` |   | read SQL from a file (- for stdin) |
| `--name` | `string` |   | name (required) |
| `--public` |   |   | share with everyone |
| `--stdin` |   |   | read SQL from stdin |

```bash
chouse saved create --name six-seven "SELECT 6*7 AS x"
chouse saved create --name daily -f daily.sql --public -c prod
```

#### chouse saved delete

Delete a saved query.

```bash
chouse saved delete <id>
```

```bash
chouse saved delete 3f2a… --yes
```

#### chouse saved get

Show one saved query and its SQL.

```bash
chouse saved get <id>
```

```bash
chouse saved get 3f2a… -o yaml
```

#### chouse saved list

List saved queries (scoped to -c when given).

```bash
chouse saved list [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--limit` | `int` | `0` | max rows (0: all) |

```bash
chouse saved list -c prod
```

#### chouse saved run

Run a saved query (read-only).

```bash
chouse saved run <id> [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--limit` | `int` | `1000` | max result rows |
| `--out` | `string` |   | write the result to a file (.csv, .json, .yaml) |

```bash
chouse saved run 3f2a…
chouse saved run 3f2a… --out result.csv
```

### chouse table

Databases, tables, schemas and samples (read-only).

Explore what your token can see on the -c connection: databases
and tables, a table's columns and CREATE statement, and sample rows. All
read-only; run DDL with chouse query --raw.

```bash
chouse table
```

Aliases: `tables`, `explorer`

```bash
chouse table list
chouse table list analytics
chouse table schema analytics.events
chouse table sample analytics.events --limit 20
```

#### chouse table list

List tables (optionally in one database).

```bash
chouse table list [database]
```

```bash
chouse table list -c prod
chouse table list analytics -o csv
```

#### chouse table sample

Show sample rows.

```bash
chouse table sample <db.table | db table> [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--limit` | `int` | `20` | rows (max 1000) |

```bash
chouse table sample analytics.events --limit 20
chouse table sample analytics.events -o csv
```

#### chouse table schema

Show a table's engine, columns and CREATE statement.

```bash
chouse table schema <db.table | db table>
```

```bash
chouse table schema analytics.events
chouse table schema analytics.events -o json
```

### chouse upload

Check how a CSV/TSV/JSON file would import.

Send the first megabyte of a file for column inference — names,
types, nullability and sample values. Nothing is stored. Importing the file
stays in the UI (Explorer › Upload), or use chouse query --raw with INSERT.

```bash
chouse upload
```

```bash
chouse upload preview rows.csv
chouse upload preview rows.tsv --format TSV --header=false -o json
```

#### chouse upload preview

Infer columns from a file.

```bash
chouse upload preview <file> [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--format` | `string` | `CSV` | file format: CSV, TSV or JSON |
| `--header` |   | `true` | the first row is a header |

```bash
chouse upload preview rows.csv
```

## Operate

### chouse alert

Alert channels, rules and deliveries.

Inspect alerting: channels (secrets masked), rules and recent
deliveries. test sends a real notification, so it asks first (or needs
--yes). Editing rules and channels stays in the UI.

```bash
chouse alert
```

```bash
chouse alert channels
chouse alert events --limit 10
chouse alert test 51b0… --yes
```

#### chouse alert channels

Notification channels (secrets masked).

```bash
chouse alert channels
```

```bash
chouse alert channels
```

#### chouse alert events

Recent alert deliveries, newest first.

```bash
chouse alert events [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--limit` | `int` | `50` | max events |

```bash
chouse alert events --limit 10
```

#### chouse alert rules

Alert rules.

```bash
chouse alert rules
```

```bash
chouse alert rules
```

#### chouse alert test

Send a test notification through a channel.

```bash
chouse alert test <channelId>
```

```bash
chouse alert test 51b0… --yes
```

### chouse audit

Audit log: list and export.

Who did what, when and from where. You see your own entries
unless you hold audit:view. export writes CSV (audit:export). Pruning stays
in the UI.

```bash
chouse audit
```

```bash
chouse audit list --limit 20
chouse audit list --action mcp.tool_call --status failed
chouse audit export --limit 5000 > audit.csv
```

#### chouse audit export

Export entries as CSV (up to 10000).

Write audit entries as CSV to stdout (always CSV; -o does not apply). Same filters as list.

```bash
chouse audit export [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--action` | `string` |   | only this action, e.g. mcp.tool_call |
| `--limit` | `int` | `1000` | max rows |
| `--status` | `string` |   | success or failed |
| `--user` | `string` |   | only this user id |

```bash
chouse audit export --limit 1000 > audit.csv
```

#### chouse audit list

List entries, newest first.

```bash
chouse audit list [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--action` | `string` |   | only this action, e.g. mcp.tool_call |
| `--limit` | `int` | `50` | max rows |
| `--status` | `string` |   | success or failed |
| `--user` | `string` |   | only this user id |

```bash
chouse audit list --limit 20
```

### chouse capacity

Disk forecasts, table growth, cold tables and codec trials.

Capacity of the -c connection (Monitoring › Capacity): days until each
node's disk reaches its threshold (--view forecasts), the fastest-growing
tables (growth), tables nobody read in 7 days (cold) and codec trials
(trials). -o json shows everything, with cost by consumer when you have
cost:view.

```bash
chouse capacity [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--view` | `string` | `forecasts` | table to show: forecasts, growth, cold or trials |

```bash
chouse capacity -c prod
chouse capacity -c prod --view growth
chouse capacity -c prod -o json
```

### chouse collectors

Observability collectors: last runs, errors and schedule.

The collectors that feed Data, Monitoring and alerting from
ClickHouse system tables. status shows each collector's last run, last
error, missing grants and what it read on the -c connection; schedule shows
how often each runs (the defaults, or the -c connection's own schedule with
its bytes read per day). Read-only; the schedule is edited in Admin ›
Connections.

```bash
chouse collectors
```

```bash
chouse collectors status -c prod
chouse collectors schedule
chouse collectors schedule -c prod
```

#### chouse collectors schedule

How often each collector runs (defaults, or the -c connection's).

```bash
chouse collectors schedule
```

```bash
chouse collectors schedule -c prod -o json
```

#### chouse collectors status

Each collector's state, last run and last error.

```bash
chouse collectors status
```

```bash
chouse collectors status -c prod
```

### chouse dashboard

Dashboards: list, show, run a panel, export, apply, versions, snapshots, Grafana import.

Custom dashboards (ADR 0021, ADR 0023) as code. export writes a dashboard as
JSON; apply creates a dashboard from that JSON, or updates the dashboard its
id names so it matches the file exactly (panels left out are removed with
their alerts). run-panel runs one panel's read-only query with your own data
access. versions and restore read and roll back its history; snapshot freezes
its results for a range. import-grafana converts a Grafana dashboard. delete
and restore ask first (or need --yes).

```bash
chouse dashboard
```

Aliases: `dashboards`

```bash
chouse dashboard list
chouse dashboard export 7c1e… > orders.json
chouse dashboard apply -f orders.json
chouse dashboard run-panel 7c1e… 2b9d… --range 24h --var db=shop
chouse dashboard import-grafana -f grafana.json --apply
```

#### chouse dashboard apply

Create or update a dashboard from an export.

With "id": null in the file, a new dashboard is created (yours, with new
panel ids). With an id, that dashboard is updated to match the file: panels
keep their ids, panels missing from the file are removed together with
their alerts. The server validates every panel; nothing is partly applied.
An export from before CHouse 3.16 (chouse.dashboard/v1) is converted.

```bash
chouse dashboard apply -f FILE [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `-f, --file` | `string` |   | the export to apply (- for stdin) |

```bash
chouse dashboard apply -f orders.json
chouse dashboard export 7c1e… | chouse dashboard apply -f -
```

#### chouse dashboard delete

Delete a dashboard with its panels and alerts.

```bash
chouse dashboard delete <id>
```

```bash
chouse dashboard delete 7c1e… --yes
```

#### chouse dashboard export

Write a dashboard as JSON (the format apply takes).

```bash
chouse dashboard export <id> [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--out` | `string` |   | write to this file instead of stdout |

```bash
chouse dashboard export 7c1e… > orders.json
chouse dashboard export 7c1e… --out orders.json
```

#### chouse dashboard get

Show a dashboard's panels (-o json for everything).

```bash
chouse dashboard get <id>
```

```bash
chouse dashboard get 7c1e…
```

#### chouse dashboard import-grafana

Convert a Grafana dashboard, and with --apply import it.

Prints what converts: each Grafana panel is ready, changed (with what
changed) or skipped (with why). Only ClickHouse panels convert. Nothing is
saved without --apply, which imports the convertible panels like apply -f.
The dashboard is assigned to the -c connection, or to every connection with
--all-connections.

```bash
chouse dashboard import-grafana -f FILE [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--all-connections` |   |   | assign the dashboard to every connection instead of -c |
| `--apply` |   |   | import the convertible panels |
| `-f, --file` | `string` |   | the Grafana dashboard JSON (- for stdin) |

```bash
chouse dashboard import-grafana -f grafana.json -c prod
chouse dashboard import-grafana -f grafana.json -c prod --apply
```

#### chouse dashboard list

List the dashboards you may view.

```bash
chouse dashboard list
```

```bash
chouse dashboard list -o json
```

#### chouse dashboard restore

Save an old version as the newest one.

Restoring saves the old version's document as a new version, so it can be
undone by restoring the version before it. Panels the old version does not
have are removed with their alerts; restore lists those alerts and asks
first (or needs --yes).

```bash
chouse dashboard restore <id> <version>
```

```bash
chouse dashboard restore 7c1e… 12 --yes
```

#### chouse dashboard run-panel

Run one panel's read-only query.

```bash
chouse dashboard run-panel <dashboardId> <panelId> [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--range` | `string` | `1h` | how far back: 15m, 1h, 3h, 6h, 12h, 24h, 2d, 7d, 30d |
| `--var` | `stringArray` |   | a variable value as name=value (repeatable; repeat a name for a multi-value variable) |

```bash
chouse dashboard run-panel 7c1e… 2b9d… -c prod --range 24h
chouse dashboard run-panel 7c1e… 2b9d… --var db=shop -o csv
chouse dashboard run-panel 7c1e… 2b9d… --var status=ok --var status=err
```

#### chouse dashboard snapshot

Freeze a dashboard's results for a range, and read them back.

A snapshot stores every chart panel's result for a range ending now, run as
you on the -c connection (at most 10 MiB). You, and the shared roles you name
with --role, can open it until it expires; whoever opens it still only sees
what their own access allows.

```bash
chouse dashboard snapshot
```

```bash
chouse dashboard snapshot create 7c1e… --name "Incident 42" --range 6h -c prod
chouse dashboard snapshot list 7c1e…
chouse dashboard snapshot get 7c1e… 9a0f… --out incident-42.json
```

#### chouse dashboard snapshot create

Take a snapshot.

```bash
chouse dashboard snapshot create <dashboardId> --name NAME [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--expires-days` | `int` | `30` | days until it expires (1 to 365) |
| `--name` | `string` |   | the snapshot's name |
| `--range` | `string` | `1h` | the range to freeze, ending now: 15m, 1h, 3h, 6h, 12h, 24h, 2d, 7d, 30d |
| `--role` | `stringArray` |   | a role id the dashboard is shared with that may open it (repeatable) |
| `--var` | `stringArray` |   | a variable value as name=value (repeatable) |

```bash
chouse dashboard snapshot create 7c1e… --name "Incident 42" --range 6h -c prod --role team-b-role-id --expires-days 90
```

#### chouse dashboard snapshot get

Write a snapshot (document and results) as JSON.

```bash
chouse dashboard snapshot get <dashboardId> <snapshotId> [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--out` | `string` |   | write to this file instead of stdout |

```bash
chouse dashboard snapshot get 7c1e… 9a0f… --out incident-42.json
```

#### chouse dashboard snapshot list

List the snapshots you may open.

```bash
chouse dashboard snapshot list <dashboardId>
```

```bash
chouse dashboard snapshot list 7c1e…
```

#### chouse dashboard versions

List a dashboard's last 50 saves.

```bash
chouse dashboard versions <id>
```

```bash
chouse dashboard versions 7c1e…
```

### chouse fleet

Every connection at once: health snapshots and history.

The latest health snapshot of every connection you can see, their
history, and fixed server-side metrics (no ad-hoc SQL).

```bash
chouse fleet
```

```bash
chouse fleet list
chouse fleet history --metric summary --from 2026-10-01T00:00:00Z
```

#### chouse fleet history

Snapshot history in an RFC3339 window.

```bash
chouse fleet history [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--from` | `string` |   | RFC3339 start |
| `--limit` | `int` | `100` | max rows |
| `--metric` | `string` | `summary` | metric name |
| `--to` | `string` |   | RFC3339 end |

```bash
chouse fleet history --metric summary --limit 50
```

#### chouse fleet list

Latest snapshot per connection.

```bash
chouse fleet list
```

```bash
chouse fleet list
```

#### chouse fleet query

One fixed server-side metric for the -c connection.

```bash
chouse fleet query <metric>
```

```bash
chouse fleet query summary -c prod
```

### chouse live

Running queries: list, and kill runaways.

See what is running on the -c connection and kill runaways. You
see your own queries unless you hold live_queries:kill_all. kill changes
things, so it asks first (or needs --yes).

```bash
chouse live
```

```bash
chouse live list
chouse live kill 8f1c… --yes
```

#### chouse live kill

Kill a running query.

```bash
chouse live kill <queryId>
```

```bash
chouse live kill 8f1c2d… --yes
```

#### chouse live list

List running queries.

```bash
chouse live list
```

```bash
chouse live list -o json | jq -r '.queries[].query_id'
```

### chouse logs

Recent queries from system.query_log.

The most recent queries in ClickHouse's query log on the -c
connection, newest first: when, how long, and whether they finished or
failed. Filter by ClickHouse user with --user.

```bash
chouse logs [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--limit` | `int` | `20` | max rows (1-100) |
| `--user` | `string` |   | only this ClickHouse user |

```bash
chouse logs
chouse logs --user etl --limit 50 -o csv
```

### chouse metrics

ClickHouse server metrics (read-only).

Server stats, the largest tables, recent errors, part pressure,
your own SELECT as a metric, and the impact of an ALTER UPDATE/DELETE —
which is estimated, never run.

```bash
chouse metrics
```

```bash
chouse metrics overview
chouse metrics top-tables --limit 5
chouse metrics simulate "ALTER TABLE t DELETE WHERE day < today() - 30"
```

#### chouse metrics custom

Run your own SELECT as a metric.

```bash
chouse metrics custom [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--query` | `string` |   | SELECT … (required) |

```bash
chouse metrics custom --query "SELECT count() FROM system.query_log"
```

#### chouse metrics errors

Server errors in the last --interval minutes.

```bash
chouse metrics errors
```

```bash
chouse metrics errors --interval 60
```

#### chouse metrics overview

Server stats and resource use.

```bash
chouse metrics overview
```

```bash
chouse metrics overview
```

#### chouse metrics parts-pressure

Tables with too many parts or slow merges.

```bash
chouse metrics parts-pressure
```

```bash
chouse metrics parts-pressure
```

#### chouse metrics simulate

Estimate the rows an ALTER UPDATE/DELETE would touch (never runs it).

```bash
chouse metrics simulate <ALTER …>
```

```bash
chouse metrics simulate "ALTER TABLE t UPDATE x = 1 WHERE id = 2"
```

#### chouse metrics top-tables

Largest tables.

```bash
chouse metrics top-tables
```

```bash
chouse metrics top-tables --limit 5
```

### chouse perf

Query regressions against their own baseline.

Query shapes on the -c connection that got slower or heavier than
their own baseline, lined up with the upgrades, DDL and setting changes
around their onset (Monitoring › Performance). Sample query text needs
query:history:view:all.

```bash
chouse perf
```

```bash
chouse perf regressions -c prod
chouse perf shape 9f2c41d0a1b2 -c prod
```

#### chouse perf regressions

Open regressions, worst first.

```bash
chouse perf regressions
```

```bash
chouse perf regressions -c prod -o json
```

#### chouse perf shape

Hourly history of one query shape.

```bash
chouse perf shape <fingerprint>
```

```bash
chouse perf shape 9f2c41d0a1b2 -c prod
```

### chouse scheduled

Scheduled queries: jobs, runs, run now.

Scheduled query jobs and their runs. preview checks a SELECT
without creating anything; run and delete ask first (or need --yes).
Creating and editing jobs stays in the UI.

```bash
chouse scheduled
```

Aliases: `jobs`

```bash
chouse scheduled list -c prod
chouse scheduled runs 4d2e… --limit 5
chouse scheduled run 4d2e… --yes
```

#### chouse scheduled delete

Delete a job.

```bash
chouse scheduled delete <id>
```

```bash
chouse scheduled delete 4d2e… --yes
```

#### chouse scheduled get

Show one job.

```bash
chouse scheduled get <id>
```

```bash
chouse scheduled get 4d2e… -o yaml
```

#### chouse scheduled list

List jobs (scoped to -c when given).

```bash
chouse scheduled list
```

```bash
chouse scheduled list -c prod
```

#### chouse scheduled preview

Check a SELECT as a job body without creating anything.

```bash
chouse scheduled preview [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `-f, --file` | `string` |   | read the SELECT from a file (- for stdin) |
| `--query` | `string` |   | SELECT to check |

```bash
chouse scheduled preview -c prod --query "SELECT count() FROM events"
chouse scheduled preview -c prod -f job.sql
```

#### chouse scheduled run

Run a job now.

```bash
chouse scheduled run <id>
```

```bash
chouse scheduled run 4d2e… --yes
```

#### chouse scheduled runs

A job's runs, newest first.

```bash
chouse scheduled runs <id> [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--limit` | `int` | `20` | max runs |

```bash
chouse scheduled runs 4d2e… --limit 5
```

### chouse upgrades

Upgrade readiness, canary replays and rollout gates.

Upgrade readiness (Monitoring › Upgrades): assessments of a target
version against your real workload, workload replays on a canary, and the
rollout gates of every connection. Read-only; assessments and replays are
started in the UI.

```bash
chouse upgrades
```

```bash
chouse upgrades list -c prod
chouse upgrades get 3d1e… -o yaml
chouse upgrades replay 7a90…
chouse upgrades rollout
```

#### chouse upgrades get

One assessment: every rule and its evidence.

```bash
chouse upgrades get <assessmentId>
```

```bash
chouse upgrades get 3d1e… -o yaml
```

#### chouse upgrades list

Assessments and replays of the -c connection.

```bash
chouse upgrades list
```

```bash
chouse upgrades list -c prod
```

#### chouse upgrades replay

One canary replay: replayed, skipped, missing and differing queries.

```bash
chouse upgrades replay <replayId>
```

```bash
chouse upgrades replay 7a90…
```

#### chouse upgrades rollout

Every connection's version and rollout gates.

```bash
chouse upgrades rollout
```

```bash
chouse upgrades rollout
```

## Data observability

### chouse context

Curated table context and metric definitions.

What people wrote down about the data on the -c connection (Data ›
Context): a table's description, owner, grain, column notes and caveats,
and the defined business metrics. Read-only; context is edited in the UI.

```bash
chouse context
```

```bash
chouse context get shop.orders -c prod
chouse context metrics -c prod
chouse context metrics gmv -c prod -o json
```

#### chouse context get

One table's curated context.

```bash
chouse context get <database.table>
```

```bash
chouse context get shop.orders -c prod -o yaml
```

#### chouse context metrics

Metric definitions (all, or one by name).

```bash
chouse context metrics [name]
```

```bash
chouse context metrics gmv -c prod
```

### chouse health

Data health: promises, incidents, dataset trust.

Data health promises and their incidents, one table's trust state,
and the actions to re-run checks or acknowledge an incident (both ask first,
or need --yes).

```bash
chouse health
```

```bash
chouse health list -c prod
chouse health incidents
chouse health dataset shop.orders -c prod
chouse health ack 9a1f… --yes
```

#### chouse health ack

Acknowledge an incident.

```bash
chouse health ack <incidentId>
```

```bash
chouse health ack 9a1f… --yes
```

#### chouse health dataset

One table's trust state, freshness and open incidents.

How far to trust one table right now: trust state, freshness,
volume baseline, open incidents, owners and recent writers.

```bash
chouse health dataset <database.table>
```

```bash
chouse health dataset shop.orders -c prod
```

#### chouse health incidents

Data health incidents, newest first.

```bash
chouse health incidents [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--limit` | `int` | `50` | max rows |

```bash
chouse health incidents --limit 10
```

#### chouse health list

List promises (scoped to -c when given).

```bash
chouse health list
```

```bash
chouse health list -c prod
```

#### chouse health run

Run a promise's checks now.

```bash
chouse health run <promiseId>
```

```bash
chouse health run 2b7c… --yes
```

#### chouse health timeline

A promise's check history.

```bash
chouse health timeline <promiseId> [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--limit` | `int` | `50` | max samples |

```bash
chouse health timeline 2b7c… --limit 10
```

### chouse incidents

Data and pipeline incidents with their root cause.

Incidents from Data Health promises and the observability platform
(pipelines, freshness, volume, parts, replication) with severity, subject
and root cause. Active only unless --all; scoped to -c when given.

```bash
chouse incidents [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--all` |   |   | include recovered incidents |
| `--limit` | `int` | `50` | max rows |

```bash
chouse incidents
chouse incidents --all --limit 20 -o json
```

### chouse lineage

Where a table's data comes from and where it goes.

Lineage around one table, built from ClickHouse metadata, query
logs and scheduled jobs. --impact lists everything downstream that a change
to the table would affect (what schema preflight checks before DDL).

```bash
chouse lineage <database.table> [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--depth` | `int` | `3` | hops to follow (1-8) |
| `--direction` | `string` | `both` | up, down or both |
| `--impact` |   |   | list what a change to the table would affect |

```bash
chouse lineage shop.orders -c prod
chouse lineage shop.orders --direction up --depth 2
chouse lineage shop.orders --impact
```

### chouse notebook

Investigation notebooks of incidents and Doctor reports.

The investigation notebook of an incident or Doctor report: Chouse AI
findings, query snapshots, notes and actions. <kind> is data-health (a Data
Health incident), observe (an observability incident, see chouse incidents)
or doctor (a Doctor report). export writes it as a Markdown postmortem to
stdout. Read-only; notebooks are written in the UI.

```bash
chouse notebook
```

```bash
chouse notebook show observe 4b2e…
chouse notebook export doctor 91fa… > postmortem.md
```

#### chouse notebook export

Write a notebook as a Markdown postmortem to stdout.

Write the notebook as Markdown to stdout (always Markdown; -o does not apply).

```bash
chouse notebook export <kind> <ref>
```

```bash
chouse notebook export observe 4b2e… > postmortem.md
```

#### chouse notebook show

A notebook's cells in order.

```bash
chouse notebook show <kind> <ref>
```

```bash
chouse notebook show data-health 12 -o yaml
```

### chouse remediation

Review, approve or reject proposed fixes.

Fixes proposed for incidents (by people, Chouse AI or MCP agents)
from the remediation catalog. Approving is how a fix gets to run. The server
enforces who may approve: a person may approve their own low-risk fix, but
high-risk fixes need two approvers other than the proposer, and a fix
proposed by Chouse AI or an agent always needs someone else. approve and
reject ask first (or need --yes).

```bash
chouse remediation
```

Aliases: `fixes`

```bash
chouse remediation list -c prod --status proposed
chouse remediation get 6e0b…
chouse remediation approve 6e0b… --comment "checked the plan" --yes
```

#### chouse remediation approve

Approve a proposed action.

Approve one proposed action — review it with get first. The server enforces
the approval rules and records the decision with channel=cli.

```bash
chouse remediation approve <actionId> [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--comment` | `string` |   | decision comment |

```bash
chouse remediation approve 6e0b… --comment "reviewed" --yes
```

#### chouse remediation get

One action: statements, approvals, executions.

```bash
chouse remediation get <actionId>
```

```bash
chouse remediation get 6e0b… -o yaml
```

#### chouse remediation list

Actions on the -c connection, newest first.

```bash
chouse remediation list [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--limit` | `int` | `50` | max rows |
| `--status` | `string` |   | comma-separated: proposed, approved, executing, executed, verified, failed_verification, failed, rolled_back, rejected |

```bash
chouse remediation list -c prod --status proposed,approved
```

#### chouse remediation reject

Reject a proposed action.

Reject one proposed action — review it with get first. The server enforces
the approval rules and records the decision with channel=cli.

```bash
chouse remediation reject <actionId> [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--comment` | `string` |   | decision comment |

```bash
chouse remediation reject 6e0b… --comment "reviewed" --yes
```

## AI and agents

### chouse agents

Agent activity: sessions, queries, budgets (agents:view).

What agents connected over MCP or with personal access tokens did:
sessions with their queries, bytes read and policy outcomes, and the budget
policies that apply. Read-only; policies and the pause switch stay in the UI.

```bash
chouse agents
```

```bash
chouse agents summary
chouse agents sessions --days 7
chouse agents session <sessionId>
chouse agents policies
```

#### chouse agents policies

Budget policies (per token, per role, default).

Budget policies checked with EXPLAIN ESTIMATE before agent queries
run: per-query and daily read limits, partition-filter thresholds and what
happens on tables with an open incident. The most specific policy wins:
token, then role, then the default.

```bash
chouse agents policies
```

```bash
chouse agents policies
```

#### chouse agents session

One session with every tool call (replay).

Replay one session: every tool call with its arguments, outcome,
policy notices and bytes read. Arguments of other people's sessions need
query:history:view:all.

```bash
chouse agents session <sessionId>
```

```bash
chouse agents session pat-123:1790000000000
```

#### chouse agents sessions

Agent sessions in the last --days (1-30).

Every MCP and personal-access-token session in the window, newest
first, with its queries, bytes read and how many calls were warned or
blocked. A session is consecutive calls from one token with gaps under
30 minutes.

```bash
chouse agents sessions [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--days` | `int` | `1` | window in days (1-30) |

```bash
chouse agents sessions --days 7
```

#### chouse agents summary

Last 24 hours: active agents, queries, warnings, blocks, pause state.

Agent activity over the last 24 hours: active agents and sessions,
queries and bytes read, results that carried a health warning, queries
blocked by a budget policy, and whether agent access is paused.

```bash
chouse agents summary
```

```bash
chouse agents summary
```

### chouse ai

Chouse AI: optimize SQL (LLM cost), usage, cost and agents.

Ask Chouse AI to optimize or diagnose SQL. Advisory only — it never
runs anything — but it calls the AI model (LLM cost), so it asks first (or
needs --yes). Listing capabilities and models is free, and so are the
governance reads: usage and estimated cost, data sent to providers, recent
requests, and how CHouse's AI agents are set up.

```bash
chouse ai
```

```bash
chouse ai optimize -f slow.sql --yes
chouse ai optimize --capability debug-query "SELECT …" --yes
chouse ai models
chouse ai usage --by origin --days 30
chouse ai requests --origin mcp
```

#### chouse ai agents

CHouse's AI agents: what each feature runs, models, tools (ai_agents:view).

The AI agents CHouse runs (AI Governance › Assistant): each agent with
its model config, harness, tools, skills and subagents, whether it is built
in or customized and has an update, and which agent each AI feature is bound
to (-o json for features, harnesses and skills). Read-only; agents are edited
in the UI.

```bash
chouse ai agents
```

```bash
chouse ai agents
chouse ai agents -o json | jq '.features'
```

#### chouse ai capabilities

What Chouse AI can do for your token.

```bash
chouse ai capabilities
```

```bash
chouse ai capabilities
```

#### chouse ai egress

Tables, columns and records AI tools sent to LLM providers.

Data CHouse's AI tools returned to an LLM provider in the last --days,
by source (a table or a CHouse record type), most rows first: columns, rows,
bytes, users, requests and providers. --search narrows the sources on the
server.

```bash
chouse ai egress [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--days` | `int` | `7` | window in days (capped at the server's retention) |
| `--search` | `string` |   | only sources whose name contains this text |

```bash
chouse ai egress --days 30
chouse ai egress --search customers
```

#### chouse ai guardrail-triggers

Recent guardrail triggers: stage, action, matches, agent and tool.

Guardrail triggers of the last --days, newest first: the guardrail, the
stage, the action and mode, how many values matched, the agent and tool, and
the AI request. Matched values are never stored.

```bash
chouse ai guardrail-triggers [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--days` | `int` | `7` | window in days (capped at the server's retention) |
| `--guardrail` | `string` |   | only this guardrail's triggers (id from `chouse ai guardrails`) |
| `--limit` | `int` | `100` | rows to return (1-500) |
| `--offset` | `int` | `0` | rows to skip, for paging |

```bash
chouse ai guardrail-triggers
chouse ai guardrail-triggers --guardrail builtin-guardrail-pii --days 7
chouse ai guardrail-triggers --limit 50 --offset 50
```

#### chouse ai guardrails

AI guardrails: what every AI run passes through (ai_guardrails:view).

The guardrails CHouse applies to its AI runs and, where enabled, to MCP
tool results (AI Governance › Guardrails): kind, stages, action, shadow or
enforce mode, whether it is on, and its triggers in the last 24 hours.
Read-only; guardrails are edited in the UI or the REST API.

```bash
chouse ai guardrails
```

```bash
chouse ai guardrails
chouse ai guardrails -o json | jq '.guardrails[] | select(.enabled)'
```

#### chouse ai models

Active AI models.

```bash
chouse ai models
```

```bash
chouse ai models
```

#### chouse ai optimize

Optimize or diagnose SQL (LLM cost).

```bash
chouse ai optimize [sql] [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--capability` | `string` | `optimize-query` | optimize-query\|debug-query\|diagnose-error\|diagnose-parts\|diagnose-schema |
| `-f, --file` | `string` |   | read SQL from a file (- for stdin) |
| `--model` | `string` |   | AI model id |
| `--stdin` |   |   | read SQL from stdin |

```bash
chouse ai optimize -f slow.sql --yes -o json
```

#### chouse ai request

One AI request step by step: LLM calls, tool calls, queries, data sent.

```bash
chouse ai request <requestId>
```

```bash
chouse ai request 0c5f… -o yaml
```

#### chouse ai requests

Recent AI requests: who started them, tokens, cost, status.

AI requests of the last --days, newest first: the user, where it came
from (--origin ui, mcp, token or background), the token and client of MCP
and token requests, the agent, tokens, estimated cost, ClickHouse read and
status. Prompt and response text are never stored.

```bash
chouse ai requests [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--days` | `int` | `7` | window in days (capped at the server's retention) |
| `--limit` | `int` | `50` | rows to return (1-200) |
| `--offset` | `int` | `0` | rows to skip, for paging |
| `--origin` | `string` |   | only requests started from ui, mcp, token or background |
| `--search` | `string` |   | match on user, agent, feature, client, token name or a table sent to the model |

```bash
chouse ai requests --origin mcp
chouse ai requests --search ci-agent --limit 20
chouse ai requests --days 30 -o json
```

#### chouse ai usage

What CHouse's AI used and cost (tokens, est. cost, data sent).

CHouse's own AI (the chat and every AI feature) in the last --days:
requests, tokens, estimated cost over priced models, ClickHouse read by AI
tools and rows sent to LLM providers. --by origin splits it by who started
the requests (the UI, MCP agents, access tokens, background); --by model
shows usage per model. With ai_usage:view it covers everyone, otherwise only
your own requests (the "scope" field says which).

```bash
chouse ai usage [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--by` | `string` |   | origin or model |
| `--days` | `int` | `7` | window in days (capped at the server's retention) |

```bash
chouse ai usage --days 30
chouse ai usage --by origin
chouse ai usage --by model -o json
```

### chouse doctor

Chouse AI Doctor: fleet health reports.

Read past Doctor reports for free. A new scan calls the AI model
(LLM cost) and stores a report, so it asks first (or needs --yes). Advisory
only — it never changes data.

```bash
chouse doctor
```

```bash
chouse doctor reports
chouse doctor get 7c1e…
chouse doctor scan --hours 24 --yes
```

#### chouse doctor get

Show one report.

```bash
chouse doctor get <reportId>
```

```bash
chouse doctor get 7c1e… -o yaml
```

#### chouse doctor reports

List reports.

```bash
chouse doctor reports
```

```bash
chouse doctor reports
```

#### chouse doctor scan

Run a scan (LLM cost).

```bash
chouse doctor scan [flags]
```

| Flag | Type | Default | Description |
| --- | --- | --- | --- |
| `--connections` | `stringSlice` |   | only these connection ids |
| `--hours` | `int` | `24` | look back 1-72 hours |
| `--model` | `string` |   | AI model id (default: the server's) |

```bash
chouse doctor scan --hours 12 --yes
```

#### chouse doctor schedule

Show the scan schedule.

```bash
chouse doctor schedule
```

```bash
chouse doctor schedule
```

### chouse mcp

The MCP endpoint for AI agents: status, tools, client setup.

The server's MCP endpoint (ADR 0013, ADR 0017) is served at /mcp on the
same address as the UI. An administrator turns it on and picks the tools in
the UI (AI Governance › MCP); these commands show what your token gets there and
print setup for agent hosts. They never change the server's MCP settings.

```bash
chouse mcp
```

```bash
chouse mcp status
chouse mcp tools
chouse mcp config claude-code | sh
```

#### chouse mcp config

Print agent host setup for this server's MCP endpoint.

Print ready-to-use setup that points an agent host at this profile's
server. The token is read from CH_HOUSE_PAT (VS Code prompts for it), so no
secret is written into a config file. Output is the raw snippet (it bypasses
-o): a shell command for claude-code/codex, JSON for the others.

```bash
chouse mcp config <claude-code|codex|cursor|vscode|opencode>
```

```bash
chouse mcp config claude-code | sh
chouse mcp config cursor > .cursor/mcp.json
chouse mcp config vscode > .vscode/mcp.json
```

#### chouse mcp settings

The server's MCP settings and every tool's state (agents:view).

Show what an administrator configured in AI Governance › MCP: whether the
endpoint is on, allowed origins, the tool call timeout, and every tool with
its access level, required permissions and whether it is on (-o yaml for
everything). Changing them stays in the UI.

```bash
chouse mcp settings
```

```bash
chouse mcp settings -o yaml
```

#### chouse mcp status

Whether MCP is on, its endpoint, and how many tools your token gets.

Report whether an administrator turned the MCP endpoint on, the URL
agents connect to (this server's address plus /mcp), and — when it is on and
a token is configured — how many tools that token gets.

```bash
chouse mcp status
```

```bash
chouse mcp status
chouse mcp status -o json
```

#### chouse mcp tools

The MCP tools your token gets.

List the tools an agent using your token sees: the ones an
administrator turned on in AI Governance › MCP that your permissions allow.

```bash
chouse mcp tools
```

```bash
chouse mcp tools
chouse mcp tools -o yaml
```
