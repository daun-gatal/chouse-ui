# Troubleshooting

Common failure modes and how to diagnose them.

## Login & auth

| Symptom | Cause | Fix |
| --- | --- | --- |
| Default login rejected | Admin already created / password rotated | Check server boot logs for the RBAC seed; reset via another admin |
| Session keeps dropping | `JWT_SECRET` mismatch across replicas | Share one secret; see [Sessions & JWT](/docs/sessions-jwt/) |
| SSO button missing | `AUTH_SSO_ENABLED=false` or no provider configured | Enable per [SSO](/docs/sso/) |
| SSO callback fails | `base_url` ≠ registered redirect URI | Align `AUTH_SSO_BASE_URL` with the IdP |
| Password login disabled unexpectedly | Fail-safe requires a valid SSO provider | Re-enable a provider or flip `AUTH_PASSWORD_LOGIN_ENABLED` |

## Connections & queries

| Symptom | Cause | Fix |
| --- | --- | --- |
| Connection refused | ClickHouse HTTP port not reachable from the server container | Use the compose service name (`clickhouse-server:8123`), not `localhost` |
| Query blocked for everyone | [Data access rules](/docs/data-access-rules/) deny or no allow covers the table | Adjust rules/priority |
| 401 from CLI/MCP | Server older than the PAT backfill | Upgrade server (see [Migrations](/docs/migrations-upgrades/)) |
| Results truncated | Row cap reached | Raise preferences' max rows or query with LIMIT |

## Monitoring

| Symptom | Cause | Fix |
| --- | --- | --- |
| Tabs missing | Permission gates (`logs:view`, …) not granted | Check the [permission catalog](/docs/permissions/) |
| Empty query logs | `system.query_log` disabled / connection user lacks `system.*` read | Enable logging; widen grants |
| Time window empty | Clock skew between hosts / no data in window | Sync clocks; widen window |
| Fleet stuck on "polling" | Poller disabled (`FLEET_POLLER_ENABLED=false`) | Enable the poller — see [Fleet view](/docs/fleet-view/) |

## Alerts & AI

| Symptom | Cause | Fix |
| --- | --- | --- |
| No Slack/email delivered | Channel webhook/SMTP misconfigured | Test in **Admin → Alerting** — see [Alerting](/docs/alerting/) |
| AI actions hidden | No AI provider configured | Add under **Admin → AI models** — see [AI Assist](/docs/workspace-ai-assist/) |
| AI actions hidden for a user | Missing `ai:optimize` / `ai:chat` | Grant per [permission catalog](/docs/permissions/) |
| Doctor scans not firing | Schedule file missing/wrong | Check `DOCTOR_SCHEDULE_FILE` and `doctor:run` |

## Boot & migrations

| Symptom | Cause | Fix |
| --- | --- | --- |
| Fails on boot re: encryption | `RBAC_ENCRYPTION_KEY`/`SALT` missing or wrong length | Generate per [Secrets](/docs/configuration-secrets/) |
| Scheduler warning about HA | SQLite + `CHOUSE_HA=true` | Move to PostgreSQL for multi-replica — see [Scheduled queries](/docs/scheduled-queries/) |
| Migration failure on upgrade | Partial DB state | Restore backup, restart previous version, [open an issue](https://github.com/daun-gatal/chouse-ui/issues) |

## Diagnostics toolkit

```bash
docker logs -f chouse-ui                 # Pino JSON logs
docker logs chouse-ui | grep RBAC        # migration status
bun run rbac:status                      # manual migration state
curl -s http://localhost:5521/api/health # server liveness
```

Still stuck? [Open an issue](https://github.com/daun-gatal/chouse-ui/issues) with the log excerpt and steps to reproduce — see also the [FAQ](/docs/faq/).
