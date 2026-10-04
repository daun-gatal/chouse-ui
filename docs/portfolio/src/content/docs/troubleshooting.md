# Troubleshooting

Find the symptom, check the cause, apply the fix. Server logs are JSON (Pino) on stdout; most problems name themselves there.

## Sign-in & sessions

| Symptom | Cause | Fix |
| --- | --- | --- |
| Default login rejected | The seeded admin is only created with a new RBAC database; its password may have been changed | Sign in as another admin and reset it in **Admin › Users** |
| "Password sign-in is disabled" | `AUTH_PASSWORD_LOGIN_ENABLED=false` with a working SSO provider | Use SSO, or set it back to `true` |
| Signed out after a deploy, or randomly with several replicas | `JWT_SECRET` differs between pods or changed | Use one fixed secret everywhere — see [Sessions & JWT](/docs/sessions-jwt/) |
| SSO button missing | `AUTH_SSO_ENABLED` is not `true`, or no valid provider | See [SSO](/docs/sso/) |
| SSO callback fails | Redirect URI at the IdP ≠ `<AUTH_SSO_BASE_URL>/auth/sso/callback` | Make them identical |
| SSO change not visible on some pods | Propagation interval | Wait `AUTH_CONFIG_WATCH_INTERVAL_MS` (15 s by default) |

## Connections & queries

| Symptom | Cause | Fix |
| --- | --- | --- |
| Connection refused | ClickHouse isn't reachable *from the server container* | Use a host the server can reach (in Compose, the service name such as `clickhouse-server:8123`, not `localhost`) |
| A user sees no connections | No data access policy on their roles allows a connection | Attach a policy with an allow rule scoped to the connection — see [Data access rules](/docs/data-access-rules/#which-connections-a-user-sees) |
| Query blocked: no matching rule | No allow rule matches the table, or a higher-priority deny does | Adjust the policy's rules and priorities |
| DDL refused with `SCHEMA_PREFLIGHT_BREAKS` | The change would break a dependent view, job, promise or saved query | Follow the safer plan shown, or have someone with `schema:override` confirm — see [schema preflight](/docs/data-incidents/#schema-change-preflight) |
| Results cut off | Your result row limit | Raise **Max result rows** in [Preferences](/docs/preferences/) or add `LIMIT` |
| Stored connections can't be decrypted after a restart | `RBAC_ENCRYPTION_KEY` or `RBAC_ENCRYPTION_SALT` changed | Restore the original values; re-enter passwords if they are lost |

## Data, monitoring & fleet

| Symptom | Cause | Fix |
| --- | --- | --- |
| A Monitoring tab or Data tab is missing | Permission not granted | Check [Preferences › Identity & access](/docs/preferences/) and the [permission catalog](/docs/permissions/) |
| Data shows "No tables observed yet" or *unsupported* features | The collector's first pass hasn't finished, or the connection user lacks system-table grants | **Admin › Connections › Edit › Check privileges** and run the listed `GRANT`s |
| Empty query logs | `query_log` disabled or not flushed yet, or no grant on `system.query_log` | Enable query logging; wait for the first flush; grant read access |
| Fleet shows **Snapshot worker stalled** | No fresh samples | Check server logs for collector errors and the connection's grants — see [Fleet](/docs/fleet/) |
| Fixes approved but never run | No remediation credential on the connection, outside the maintenance window, or the target changed since approval | Add the credential; wait for the window; re-propose — see [fixes](/docs/data-incidents/#set-up-fixes-for-a-connection) |
| Codec trials fail | The connection user can't write to `OBSERVE_SCRATCH_DATABASE` | Create the database and grant write access on it |

## AI, alerts & agents

| Symptom | Cause | Fix |
| --- | --- | --- |
| AI buttons missing for everyone | No active AI deployment | Add a provider, model and deployment in [AI models](/docs/ai-models/) |
| AI buttons missing for one user | No `ai:optimize` / `ai:chat` | Grant them through a role |
| No alert delivered | Channel misconfigured or disabled | **Send test** on the channel in [Alerting](/docs/alerting/) |
| Doctor scheduled scan didn't run | Schedule disabled, or no AI model | Check **Scheduled scans** on the [Doctor](/docs/doctor/#scheduled-scans) page |
| MCP returns `404 MCP_DISABLED` | The endpoint is off (the default) | Turn it on in **Agents › MCP** — see [MCP](/docs/mcp/) |
| MCP returns `403 ORIGIN_NOT_ALLOWED` | The client sends an `Origin` that isn't allowed | Add the origin in **Agents › MCP**, or use a client that sends none |
| MCP or CLI returns `401` | Token revoked, expired or mistyped | Create a new [token](/docs/personal-access-tokens/) |
| An agent can't see a tool | The tool is off, or the token lacks its permission | Check the tool in **Agents › MCP** and the [tool catalog](/docs/mcp-tools/) |
| Agent queries blocked | A budget policy, or agent access is paused | See **Agents › Policies** — see [Agents](/docs/agents/) |

## Start-up & upgrades

| Symptom | Cause | Fix |
| --- | --- | --- |
| Refuses to start in production | `JWT_SECRET`, `RBAC_ENCRYPTION_KEY` or `RBAC_ENCRYPTION_SALT` missing or the wrong length | Generate them as in [Secrets](/docs/configuration-secrets/) |
| Logs an error about the scheduler and HA | SQLite with `CHOUSE_HA=true` | Use PostgreSQL for more than one replica |
| Warning about `MCP_*` or `FLEET_POLLER_ENABLED` | Settings removed or deprecated in 3.14 | Remove them — see [What's new](/docs/whats-new/#upgrading-from-313) |
| Migration fails on upgrade | Unexpected database state | Restore the backup, run the previous version, and [open an issue](https://github.com/daun-gatal/chouse-ui/issues) with the log |

## Collect diagnostics

```bash
docker logs -f chouse-ui                   # server logs (JSON)
docker logs chouse-ui 2>&1 | grep RBAC     # migrations and seeding
curl -s http://localhost:5521/api/health   # liveness
chouse status --debug                      # server version, CLI compatibility, request ids
```

Still stuck? [Open an issue](https://github.com/daun-gatal/chouse-ui/issues) with the log excerpt, the request id from the error and the steps to reproduce.
