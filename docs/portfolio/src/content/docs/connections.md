---
app: Admin › Connections
route: /admin/connections
permissions: connections:view
screenshot: admin-connections
---
# Connections

A **connection** is a ClickHouse server CHouse UI talks to. You can register many — one UI, many clusters — and switch between them. Manage them in **Admin › Connections** (`connections:view`; adding and changing needs `connections:edit`, removing `connections:delete`).

## Add a connection

1. **Admin › Connections › Add connection**.
2. Fill in:
   - **Connection name** — shown in the connection selector and on [Fleet](/docs/fleet/)
   - **Host** and **Port** — the ClickHouse HTTP interface, e.g. `clickhouse-server` and `8123` (`8443` with TLS)
   - **Username** and **Password** — encrypted with AES-256-GCM on the server and never sent to the browser
   - **Default database** (optional) — empty uses the server's default
   - **SSL / TLS** — connect over HTTPS
   - **Environment** (optional) — see [below](#environment)
3. **Test connection** shows the server version and latency, and checks the ClickHouse user against [every feature](#required-clickhouse-privileges). **Create** saves it once every check passes.

`CLICKHOUSE_DEFAULT_URL`, `CLICKHOUSE_DEFAULT_USER` and `CLICKHOUSE_PRESET_URLS` pre-fill the form — see [Environment variables](/docs/configuration-env/#clickhouse-connection-defaults).

## Environment

![The Environment setting](/docs/img/app/admin-connection-environment.jpg "Mark a connection Production, Staging or Development")

**Environment** (*Not set*, *Production*, *Staging*, *Development*) labels what the connection is. A **Production** connection shows a badge in the list, and makes every AI change on it [one tier stricter](/docs/ai-approvals/#tiers): undoable changes ask once, and changes that ask once need a second approver. Leave it *Not set* for no effect.

## Who can use it

A new connection is invisible to non-admins until a [data access policy](/docs/data-access-rules/) with an allow rule for it is attached to their role. The list shows **who can reach** each connection. One connection can be the **default**, selected first for new sessions; a connection can be set **Inactive** to hide it without deleting it.

## Required ClickHouse privileges

**Test connection** checks the connection's ClickHouse user against what every feature needs — the explorer and editor, monitoring, Data Health, killing queries, changing tables in the default database, and ClickHouse users and roles — and lists each feature as granted or missing. **Create** and **Update** run the same check on the server, and save only when every feature is granted.

When something is missing, the dialog says **Can't create this connection yet** (or **Can't save these changes yet**), opens each failing feature with its `GRANT` statements and a **Copy** button, and highlights the username. **Copy all grants** copies the whole script. Run it as a ClickHouse admin — or grant it to a role the user has — and press **Check again**; once every feature passes, save.

![A connection that can't be saved yet, with the grants to run](/docs/img/app/admin-connection-privileges.jpg "The ClickHouse user is missing privileges: each failing feature lists its GRANT statements")

- **Editing** a connection checks again only when you change its host, port, user, password, SSL or default database; renaming it, or switching it on or off, doesn't. With the password field empty, the saved password is used — except when you change the host or port, or switch SSL off: then enter the password again, so the saved one never goes to another server.
- A table the server doesn't have is shown as *not available* and doesn't count. A check that fails for another reason, such as a timeout, blocks the save until **Check again** gets through.
- Existing connections keep working. **Test** on a row of the list warns when the user is missing something.

The full list, how the check works and a script for a user that has everything are on [ClickHouse privileges](/docs/connection-privileges/).

## Collection schedule

The observability collectors read every connection's system tables on a schedule — see [How data is watched](/docs/data-observability/#how-often-it-runs). **Collection schedule** in the page header sets how often each collector runs for **every connection**; a connection's **Edit** dialog sets its **own** schedule, which wins over that. Reading the schedule needs `connections:view`, changing it `connections:edit`.

![The Collection schedule sheet](/docs/img/app/admin-connections-schedule.jpg "Collection schedule: how often each collector runs, for every connection")

For each collector you choose:

- **Runs** — how often, from its fastest allowed interval up to once a day. *Inherit* follows the setting for every connection, or the built-in interval.
- **State** — *Running* or *Paused*. A paused collector stops reading that server and its Data pages stop updating; the Data page's status chip turns amber and names it. *Fleet health* can't be paused (Monitoring and alerts depend on it), and it runs once for all connections, so it has no per-connection setting.

Next to each collector you see its last run on that connection — how long it took, how many queries it ran and how much it read — and **Read per day**: that read multiplied by the runs a day at the chosen interval. In the schedule for every connection, **Read per day** is summed over the active connections. Changes apply within a few seconds on every server, with no restart, and are recorded in the audit log as `observe.collectors_update`.

## Remediation credential

In the same dialog, **Remediation credential** stores a second ClickHouse login, used only to run approved [fixes](/docs/data-incidents/#set-up-fixes-for-a-connection). It is encrypted like the main password and can be removed at any time; without it, fixes can't run on this connection.

## Grant the connection user what your team needs

The connection user's ClickHouse rights are the outer limit: CHouse UI's [permissions](/docs/permissions/) and data access can only narrow them.

| Team need | ClickHouse grant |
| --- | --- |
| Query and explore | `SELECT` on the databases people use |
| Monitoring and data observability | Read access to the `system` tables on [ClickHouse privileges](/docs/connection-privileges/) |
| Loading data, scheduled-query destinations | `INSERT` (and `CREATE TABLE` for create-if-missing) on target databases |
| Schema management in the Explorer | `CREATE`, `ALTER`, `DROP` on target databases |
| Codec trials and upgrade checks | Write access to the scratch database (`chouse_scratch`) |
| [ClickHouse users & roles](/docs/clickhouse-users-roles/) | `access_management` |

Fixes don't need any of these on the main user — they use the remediation credential.

## Credentials at rest

Connection passwords are encrypted with `RBAC_ENCRYPTION_KEY` and `RBAC_ENCRYPTION_SALT`. If those change, stored passwords can't be decrypted and must be entered again — see [Secrets](/docs/configuration-secrets/).
