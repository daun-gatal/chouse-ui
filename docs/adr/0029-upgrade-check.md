# 0029 — Upgrade Check: What a ClickHouse Upgrade Changes for Your Workload

- **Status:** Accepted
- **Date:** 2026-11-02
- **Amends:** [0016](0016-data-observability-platform.md) §9 (*Upgrade readiness*)
- **Scope:** `services/upgrades/*` (including trying the workload on the current server), `routes/upgrades.ts`, the `match-upgrade-notes`
  AI feature, the upgrade MCP and assistant tools, Monitoring › Upgrades, the
  Fleet version text, the `UPGRADE_CHECK_ENABLED` setting and its Helm value,
  the docs. One PR.

## Context

Monitoring › Upgrades asks for a target version and answers with a verdict built
from six hand-written rules. Almost every check says "Ready". We measured what a
real upgrade path contains on 2 Nov 2026, from 25.8.33.6 to 26.8.36.3:

- 11 functions, the `Object` type, the `LiveView` engine and the `Lazy` database
  engine were removed; 41 setting defaults and 15 MergeTree setting defaults
  changed; 44 settings became obsolete;
- the "Backward Incompatible Change" sections of the changelog hold 131 entries
  for 25.9 to 26.8.

Neither source is enough alone. The release notes name 11 of the 14 removals but
only 16 of the 56 changed defaults: `async_insert` going from 0 to 1 and the
`LiveView` removal are in no breaking-change note. A comparison of two servers'
system tables is complete but needs a server on the target version.

The tab also tracks a rollout that the Fleet cards and the Performance tab
already show, and it has nothing a person can act on: no evidence, callers or
fix for a finding.

## Decision

### 1. One check, run when the user asks

The tab shows where the connection stands and offers targets. Clicking **Check**
runs everything at that moment; there is no background job, no CI job and no
bundled version data. The result is stored as an assessment (the existing
`upgrade_assessments` and `upgrade_findings` tables, no migration) and shown
until the next check.

### 2. Release data

When `UPGRADE_CHECK_ENABLED=true`:

- `version_date.tsv` from the ClickHouse repository gives release lines, dates
  and LTS lines (months 3 and 8). Supported lines are the three newest lines
  plus the two newest LTS lines.
- Docker Hub gives the newest patch of each line, one request per line
  (`?name=<line>.`), keeping only exact `x.y.z.w` tag names that start with the
  line, sorted numerically. Paging recent tags does not work: each release has
  about seven tags, so three pages cover two weeks and quiet lines drop out.
- Both are cached for 24 hours per server process.

### 3. Two ways to know what the target changes

1. **Exact.** If one of the user's connections runs the target line, CHouse
   reads the same system tables on both servers (settings with `is_obsolete`,
   MergeTree settings, functions, data types, table engines, formats, database
   engines) and diffs them. Machine-dependent defaults such as `auto(18)` are
   normalised to `auto`. Settings are never removed in ClickHouse; they become
   obsolete, so the diff compares `is_obsolete`.
2. **Release notes.** Otherwise CHouse fetches the breaking-change entries between
   the two versions from `CHANGELOG.md` (current year) and the clickhouse-docs
   yearly changelogs (earlier years). The UI says that notes miss most default
   changes and suggests adding a connection on the target line.

The user picks the comparison in a dropdown of connections they can access that
run the target line. No admin marking is needed; access is checked like any
other connection.

Parsing ClickHouse's C++ source (the settings history file) was rejected: it found
34 of 41 default changes with no false positives, but its format changed in 26.10
and it is not an API.

### 4. Matching against the workload

CHouse reads, from the current connection: column types, table and database
engines, settings profiles, settings changed on the server, and 30 days of
`query_log` (`used_functions`, `used_data_type_families`, `used_storages`,
`used_formats`, `Settings`, user, client name). A diff entry becomes a finding
only when the workload uses it: a removed function your queries call, a removed
type your columns use, a changed default you have not overridden, an obsolete
setting your profiles still set. Breaking-change notes are filtered to those that
name, in backticks, something the workload uses.

### 5. Chouse AI reads the notes

When an AI provider is configured, the `match-upgrade-notes` feature reads the
filtered notes against the workload facts and returns findings. Every finding
must cite a note and a workload fact that exist in the evidence; CHouse drops any
that does not. The model sees notes, query shapes and schema, never rows, through
the usual guardrails, usage tracking and egress controls. Without AI, the filtered
notes are listed for a person to judge.

### 6. Outbound requests

Only `raw.githubusercontent.com` (fixed `ClickHouse/ClickHouse` and
`ClickHouse/clickhouse-docs` paths) and `hub.docker.com` (the
`clickhouse/clickhouse-server` repository). Fixed URLs, HTTPS only, redirects
refused, a 10-second timeout, a size cap, strict parsing, and no response body is
ever returned to the user. Nothing downloaded is run. With the setting off, the
tab shows the version and the exact comparison only, and the Fleet colour is off.
A test-only override (`CHOUSE_UPGRADE_TEST_HOSTS`, honoured only with
`CHOUSE_ALLOW_TEST_OVERRIDES=1`) points the fetches at a local fake, as the chat
integrations do.

### 7. Fleet

The version text each Fleet card and row already shows gets a colour when it
needs attention (out of support, or a newer patch on the same line) and links to
Monitoring › Upgrades for that connection. The tooltip gives the support status
and the result of the last check. The card layout does not change.

### 8. Removed

The rollout tracker (`GET /upgrades/rollout` and the `get_upgrade_rollout` tool),
the rules pack (`rules/clickhouse.json`), the single verdict, and the workload
replay on a canary (its routes, the `get_canary_replay` and `run_canary_replay`
tools and `chouse upgrades replay`; past replays stay in the database). The
replay needed a second cluster with the same data, and its result comparison
mostly reported data differences. Regressions already open on upgraded replicas
stay as findings.

### 9. Try it on this server

Many of a new version's behaviours already exist on the current server as
settings it ships switched off; the analyzer, which can't be turned off from
26.9, is the one that breaks queries most. So a check, unless the user turns it
off, plans the workload's top 200 read-only query shapes of the last 30 days on
the current server with `EXPLAIN PLAN`:

- once with the settings each shape ran with (from `query_log`; a query that
  doesn't set the analyzer gets the server's own default), and
- once with the target's: the analyzer on, plus, in exact mode, every changed
  default this server knows. A pinned `compatibility` keeps the old defaults
  but not the old analyzer.

A shape that fails today too is skipped. One that fails only with the target's
settings is a **Breaks** finding; CHouse retries it with the analyzer alone,
then each changed setting alone, to name the cause. Plans that change are one
heads-up, compared only for shapes already on the analyzer. Settings the server
refuses are dropped and reported.

Nothing is executed: `readonly = 2`, 10 s per statement, rows read capped with
`read_overflow_mode = throw`, one statement at a time in a 60 s budget, tagged
as CHouse's own so it never counts as workload. Errors are cut before any
quoted query text; the query itself is shown only with `query:history:view:all`,
and rows on tables the reader can't access are hidden. It can't test code the
current server doesn't have (a removed function), queries outside the top 200,
or speed.

## Consequences

- The tab answers "what changes for me" from data instead of six rules, and says
  how complete the answer is.
- Without a connection on the target line the answer is partial, and the UI says
  so. Behaviour on the client side (request headers, INSERT payloads) and queries
  outside the `query_log` window cannot be seen.
- A check makes a few outbound requests when the setting is on. Air-gapped
  installs keep the exact comparison.
- The release-note parser depends on the changelog's headings. If they stop
  matching, the check reports that the notes could not be read rather than
  "no changes".

## Alternatives considered

- **Bundle per-version snapshots built in CI.** Complete without a target
  connection, but it adds a CI job and data to every release. Rejected by the
  owner in favour of checking on demand.
- **AI for everything.** The notes alone miss 40 of 56 changed defaults, and the
  model cannot run the target version. AI reads the notes; CHouse supplies and
  checks the facts.
- **A four-step planner (impact, prepare, rehearse, verify) with tracked
  findings.** Upgrades happen a few times a year per cluster; the workflow would
  cost more to maintain than it returns, and Performance already links
  regressions to version changes.
