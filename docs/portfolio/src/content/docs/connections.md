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
3. **Test Connection** shows the server version and latency. Save.

`CLICKHOUSE_DEFAULT_URL`, `CLICKHOUSE_DEFAULT_USER` and `CLICKHOUSE_PRESET_URLS` pre-fill the form — see [Environment variables](/docs/configuration-env/#clickhouse-connection-defaults).

## Who can use it

A new connection is invisible to non-admins until a [data access policy](/docs/data-access-rules/) with an allow rule for it is attached to their role. The list shows **who can reach** each connection. One connection can be the **default**, selected first for new sessions; a connection can be set **Inactive** to hide it without deleting it.

## Check privileges

Open a connection's **Edit** dialog. The **Observability grants** panel checks what the connection's ClickHouse user can read and lists the exact `GRANT` statements for anything missing. Saving never fails because of a missing grant — the collector that needs it is simply switched off, and the affected features show missing evidence. See [How data is watched](/docs/data-observability/#grant-the-collector-what-it-needs).

## Collection schedule

The observability collectors read every connection's system tables on a schedule — see [How data is watched](/docs/data-observability/#how-often-it-runs). **Collection schedule** in the page header sets how often each collector runs for **every connection**; a connection's **Edit** dialog sets its **own** schedule, which wins over that. Reading the schedule needs `connections:view`, changing it `connections:edit`.

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
| Monitoring and data observability | Read access to the `system` tables listed by **Check privileges** |
| Loading data, scheduled-query destinations | `INSERT` (and `CREATE TABLE` for create-if-missing) on target databases |
| Schema management in the Explorer | `CREATE`, `ALTER`, `DROP` on target databases |
| Codec trials and upgrade checks | Write access to the scratch database (`chouse_scratch`) |
| [ClickHouse users & roles](/docs/clickhouse-users-roles/) | `access_management` |

Fixes don't need any of these on the main user — they use the remediation credential.

## Credentials at rest

Connection passwords are encrypted with `RBAC_ENCRYPTION_KEY` and `RBAC_ENCRYPTION_SALT`. If those change, stored passwords can't be decrypted and must be entered again — see [Secrets](/docs/configuration-secrets/).
