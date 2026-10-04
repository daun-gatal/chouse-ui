---
app: Monitoring › Upgrades
route: /monitoring/upgrades
permissions: upgrades:view
---
# Upgrades

**Monitoring › Upgrades** checks a ClickHouse upgrade against *your* workload before you roll it out: the query shapes in `query_log`, your table engines and column types, settings profiles, and the replicas you have already upgraded.

## Check readiness

1. Enter a **Target version** (e.g. `25.3`) and run the check (needs `upgrades:run`).
2. A rules pack of known behaviour changes is matched against what you actually use — column types, database engines, settings profiles, query settings and functions — and only findings that apply are shown.
3. The **Verdict** is **Ready**, **Ready with warnings** or **Not ready**, with **Blockers** and **Warnings** listed under **Findings**. *Nothing in your workload is affected* means no rule matched.

## Replay on a canary

**Workload replay on a canary** runs your top read-only query shapes on a **Canary connection** that already runs the target version, and compares each with the current server: **same result**, **different result**, **slower**, or **error**. Differences are listed under **Replay differences**. Only read-only queries are replayed.

Set up the canary as an ordinary [connection](/docs/connections/) pointing at a server on the new version, with a copy of the data you care about.

## Track the rollout

The **Rollout tracker** lists every connection with its version and three gates — replica lag, regressions and replica health — so you can see whether it is safe to move on to the next one. Regressions that start with the upgrade also show on [Performance](/docs/monitoring-performance/).
