# Plan a ClickHouse upgrade

Use **Monitoring › Upgrades** to choose a version and find out what it changes for *your* workload before you roll it out. You need `upgrades:view`, and `upgrades:run` to run checks and replays. Release data and notes need [`UPGRADE_CHECK_ENABLED`](/docs/configuration-env/).

## 1. Choose a target

Open **Monitoring › Upgrades** on the connection you want to upgrade. The left card says whether its version is still supported. Under **Where to go next**, the newest LTS line is **Recommended**; an older LTS is a smaller step, and the newest stable line is only supported for about three months. When a newer patch is out on your own line, take that first.

## 2. Check it against your workload

1. If you have a server on the target line, add it as a [connection](/docs/connections/) and pick it under **Compare with**. The comparison is then exact. Without one, pick **Release notes only**; notes miss most default changes.
2. Click **Check**.
3. Work through **Breaks** first: removed types, functions and engines your workload uses. Then **Behaves differently** (changed defaults) and **Heads-up**.
4. Read the **Release notes that name what you use**. With Chouse AI set up, it reads them for you and turns the ones that matter into findings.

Each finding has the SQL to fix it or to keep today's behaviour, and links to the ClickHouse pull request. **Copy as Markdown** turns the check into a report for your change request. See [Check an upgrade](/docs/monitoring-upgrades/#check-an-upgrade).

## 3. Replay on a canary

The check shows what changed; a replay shows what actually happens to your queries.

1. With the current server as the active connection (the baseline), go to **Workload replay on a canary**, pick the server on the target version as the **Canary connection** and start the replay.
2. Your top read-only query shapes run on both servers. **Replay differences** lists every query that returns a **different result**, gets **slower**, **errors**, or is **missing on canary**. See [outcomes](/docs/monitoring-upgrades/#replay-on-a-canary).

Only read-only queries are replayed; nothing is written to either server.

## 4. Roll out and watch

Upgrade one replica at a time. The [Fleet](/docs/fleet/) page shows each connection's version, and **Monitoring › Performance** compares each query shape with its own 14-day baseline and lines regressions up with the version change, so a slowdown that starts with the upgrade is easy to spot. A regression on an upgraded replica also shows as a finding the next time you check.
