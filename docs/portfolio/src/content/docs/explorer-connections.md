# Connections

A connection is a registered ClickHouse server. CHouse UI supports multiple connections simultaneously — one UI, many clusters. Manage them in **Admin → Connections** (`connections:view`; changes need `connections:edit`/`connections:delete`).

## Adding a connection

1. **Admin → Connections → Add connection**.
2. Fill in:
   - **Name** — human label shown in the selector and fleet
   - **Host / port** — e.g. `clickhouse-server:8123` (HTTP port)
   - **User / password** — stored AES-256-GCM encrypted server-side; never exposed to the browser
3. Save. The connection appears in the selector immediately.

### Pre-fill & presets

Speed up setup with environment defaults — see [Environment variables](/docs/configuration-env/):

- `CLICKHOUSE_DEFAULT_URL` / `CLICKHOUSE_DEFAULT_USER` — pre-fill the form
- `CLICKHOUSE_PRESET_URLS` — comma-separated dropdown of preset hosts

## Switching connections

The connection selector (dock / header) switches the active connection for all tabs. Each browser tab remembers its own selection.

## Connection lifecycle

- **Credentials at rest** — encrypted with the [encryption key/salt](/docs/configuration-secrets/); rotating those requires re-saving connections
- **ClickHouse session** — created server-side on connect; auto-recovered on expiry (see [Sessions & JWT](/docs/sessions-jwt/))
- **Fleet** — every connection is a fleet card; status/memory/lag per cluster — see [Fleet view](/docs/fleet-view/)
- **Per-connection scoping** — [saved queries](/docs/workspace-saved-queries/) and [data access rules](/docs/data-access-rules/) can be connection-aware

## Least-privilege guidance

Give the connection user only what the team needs:

| Team need | Suggested ClickHouse grant |
| --- | --- |
| Read + monitoring | `SELECT` incl. `system.*` read |
| Write access | `INSERT` on target tables |
| Schema management | `CREATE`/`ALTER`/`DROP` on target databases |
| ClickHouse user management | `access_management` |

CHouse UI's own RBAC applies on top — the connection user's rights are the outer boundary.
