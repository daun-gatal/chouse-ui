# Plan a ClickHouse upgrade

Use **Monitoring › Upgrades** to find out whether a new ClickHouse version will break *your* workload before you roll it out, then watch the rollout. You need `upgrades:view`, and `upgrades:run` to run checks and replays.

## 1. Check readiness

1. **Monitoring › Upgrades** → **Target version**, e.g. `25.3` → run the check.
2. Read the **Verdict**: *Ready*, *Ready with warnings* or *Not ready*.
3. Work through **Blockers** first, then **Warnings**. Each finding names what in your workload it matched — a column type, an engine, a settings profile, a function or query setting you use.

*Nothing in your workload is affected* means no known behaviour change matches what you run.

## 2. Replay on a canary

Findings come from rules; a replay shows what actually happens.

1. Stand up a ClickHouse on the target version with a copy of the data you care about, and add it as a [connection](/docs/connections/).
2. With the current server as the active connection (the baseline), go to **Workload replay on a canary**, pick the new server as the **Canary connection** and start the replay.
3. Your top read-only query shapes run on both servers. **Replay differences** lists every query that returns a **different result**, gets **slower**, **errors**, or is **missing on canary** (its table isn't on the canary yet). Queries that no longer run on the baseline itself are **skipped**. See [outcomes](/docs/monitoring-upgrades/#replay-on-a-canary).

Only read-only queries are replayed; nothing is written to either server.

## 3. Roll out

Upgrade one connection at a time. The **Rollout tracker** shows each connection's version and three gates — replica lag, regressions and replica health. Move on when all three are green.

## 4. Watch afterwards

**Monitoring › Performance** compares each query shape with its own 14-day baseline and lines regressions up with the changes around them — an upgrade shows up on the change timeline, so a slowdown that starts with it is easy to spot. With `query:history:view:all`, compare a shape's `EXPLAIN` on the upgraded connection with a not-yet-upgraded one.
