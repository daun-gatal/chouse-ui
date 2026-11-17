# Welcome to your CHouse UI lab

This codespace runs a private copy of CHouse UI with four ClickHouse servers,
one per version, and sample data. It's yours alone: you are the admin, and nobody else can open it.

**You don't need this editor.** It only hosts the lab. Everything happens in
the CHouse UI tab.

## 1. Open CHouse UI

The lab opens in a new browser tab when it's ready, about 2–3 minutes after
the codespace starts. If the tab didn't open (a popup blocker can stop it),
open the **Ports** panel at the bottom, find **CHouse UI (5521)** and click
the globe icon.

## 2. Sign in

Your sign-in is printed in the terminal when the lab is ready, and saved in
`.devcontainer/lab/.state/login.txt`:

- **Username:** `admin`
- **Password:** a random password made for this lab

Teammates **maya** (analyst), **devon** (developer) and **vic** (viewer) use
the same password. Sign in as one of them to see what each role can and
can't do.

## 3. Take the tour

The **Getting Started** guide opens on your first sign-in. Its chapters walk
through every area. Here is what the lab has ready for each one:

| Area | What's there |
|---|---|
| **Fleet** | The lab's four ClickHouse servers (26.5, 26.3, 25.8 and 23.8), polled every 30 seconds. |
| **SQL workspace** | `shop` and `analytics` databases with 2 million orders, a small `finance` database, and four shared saved queries. Every server has the same data. |
| **Monitoring** | On every server: a steady query load, new orders every 30 seconds, one slow query every 2 minutes and one failing query every 10 minutes. |
| **Dashboards** | *Shop sales*, plus the *ClickHouse overview*, *Query latency* and *Disk and tables* templates. |
| **Data** | Two data-health promises. *Orders keep arriving* holds. *Shop orders are in EUR* breaks on purpose (about one order in ten is in USD), so there's an incident to investigate. Lineage shows the materialized view. |
| **Alerts** | A fleet threshold rule, *Lab fleet thresholds*. |
| **Scheduled queries** | *Daily revenue by country*, run once already. |
| **Admin** | Three teammates, a data access policy that limits analysts to the sample databases, and table descriptions and a `revenue` metric in Context. |

Things to try:

1. In **Monitoring › Query logs**, find the slow query (`lab:slow-query`) and
   open **Explain** on it. It reads every row because `customer_id` isn't in
   the table's sort key.
2. Open the incident in **Data › Incidents** and trace it to the USD orders.
3. Sign in as `maya` and run `SELECT * FROM finance.payouts`. Her data
   access policy covers only `shop` and `analytics`, so CHouse UI refuses it.

## 4. Try 3.18 on four ClickHouse versions

CHouse UI 3.18 asks each ClickHouse server what it can do instead of assuming.
The lab has one connection per version, and each one shows a different
result, so you can compare them. Switch
between them with the connection switcher at the top of the page.

| Connection | ClickHouse | Role ceiling | Personal connection |
|---|---|---|---|
| **Lab ClickHouse 26.5** (default) | 26.5 | Available | Offered, but **fails** the server self-test when you press **Check**: 26.5.7 runs `CREATE` under `EXECUTE AS` without checking grants. |
| **Lab ClickHouse 26.3** | 26.3.63 | Available | Offered, and **passes** the server self-test. |
| **Lab ClickHouse 25.8** | 25.8 LTS | Available | **Blocked up front**: 25.8 has no `EXECUTE AS` statement. |
| **Lab ClickHouse 23.8** | 23.8 LTS | **Blocked up front**: it needs 24.4 or newer. | **Blocked up front**: no `EXECUTE AS`. |

Things to try:

1. Open **Admin › Connections**, pick a connection and open
   **ClickHouse login**. The kinds the server can't run are disabled before
   you type anything, with the server's version and what is missing. Compare
   *Lab ClickHouse 23.8*, *25.8* and *26.3*.
2. Run `SELECT version()` on each connection, or open **Fleet** to see all
   four side by side.
3. In **Monitoring › Query logs**, look at the query ids. Each statement
   CHouse UI sends is `chouse:p:<account>:…` or `chouse:s:<purpose>:…`, so a
   ClickHouse administrator can tell whose it was. On 25.8 and newer,
   CHouse UI also sets a quota key with the same account; 23.8 refuses one,
   so it is left out there.
4. To set up a role ceiling or a personal connection, open the connection's
   **Identity** panel. It shows the statements to run as the ClickHouse
   administrator. In the lab, you are that administrator: run them in the SQL
   workspace on the same connection, then press **Check**.

Try the kinds on *Lab ClickHouse 26.3*, *25.8* and *23.8*. The default
connection, *Lab ClickHouse 26.5*, holds the dashboards, alerts, scheduled
report and data-health promises, and the teammates' data access policy covers
only that connection.

## 5. Turn on AI (optional)

The AI features (the AI SRE, *Optimize with AI*, Chobi, chat) need a model.
The lab uses **your own key**, billed to you:

1. Add a Codespaces secret named `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` at
   [github.com/settings/codespaces](https://github.com/settings/codespaces)
   and give it access to this repository.
2. Rebuild the codespace: <kbd>F1</kbd> › **Codespaces: Rebuild Container**.

The lab then registers the key as the default model. You can also add one
yourself under **Admin › AI models**.

## When you're done

The codespace stops by itself after 30 minutes without activity. Stopped
codespaces still use some of your free storage until they are deleted.
Delete it at [github.com/codespaces](https://github.com/codespaces) (**⋯ ›
Delete**), or let GitHub remove it after your retention period (30 days unless
you changed it).

## Something went wrong?

- Start or repair the lab: run `bash .devcontainer/lab/up.sh` in the terminal.
  It's safe to run again.
- See what's running: `docker compose -p chouse-lab ps`.
- Start over with fresh data:
  `docker compose -p chouse-lab down -v && rm .devcontainer/lab/.env && bash .devcontainer/lab/up.sh`.
- Still stuck? [Open an issue](https://github.com/daun-gatal/chouse-ui/issues/new?labels=lab)
  and paste what `up.sh` printed.

Want to run CHouse UI for real? See the
[quick start](https://chouseui.dglabs-ai.dev/docs/quick-start/).
