# Production checklist

Work through this before exposing CHouse UI beyond localhost.

## Secrets & first-run

- [ ] Generate unique `JWT_SECRET` (min 32 bytes) — [Secrets generation](/docs/configuration-secrets/)
- [ ] Generate unique `RBAC_ENCRYPTION_KEY` (32-byte hex)
- [ ] Generate unique `RBAC_ENCRYPTION_SALT` (32-byte hex)
- [ ] Change the default admin password (`admin@localhost` / `admin123!`)

## Networking

- [ ] Set `CORS_ORIGIN` to your actual domain (default `*` is unsafe)
- [ ] Serve HTTPS via a reverse proxy or ingress
- [ ] Restrict access with firewall rules — `5521` for the UI, `8752` only if MCP is enabled
- [ ] Register the SSO redirect URI at your IdP if using SSO

## Storage

- [ ] Use PostgreSQL (`RBAC_DB_TYPE=postgres` + `RBAC_POSTGRES_URL`) for multi-instance deployments — SQLite cannot span pods
- [ ] Mount a persistent volume for `/app/data` (SQLite mode, alert config, doctor schedule)
- [ ] Schedule database backups — including the secrets needed to decrypt stored passwords

## Runtime

- [ ] Set `NODE_ENV=production` and `LOG_LEVEL=info` (or `warn`)
- [ ] Enable the [fleet poller](/docs/fleet-view/) rather than letting every browser poll clusters
- [ ] Keep `MCP_ENABLED=false` unless agents need access — and read the [MCP](/docs/mcp/) safety model first
- [ ] Verify migrations ran on boot: `docker logs chouse-ui | grep RBAC`

## AI (optional)

- [ ] Configure AI providers via **Admin → AI models** before enabling AI features
- [ ] Remember the AI is read-only/advisory — it still spends provider tokens; set budgets at the provider
- [ ] Gate who can spend tokens with `ai:optimize` / `ai:chat` / `doctor:run`

## Verification

```bash
# Health of the deployment
curl -s http://localhost:5521/api/health | head -1   # or your host
docker logs chouse-ui | grep -i error | head
```

Done? CHouse UI is production-ready. Ongoing care: [Migrations & upgrades](/docs/migrations-upgrades/) for safe version bumps, and [Alerting](/docs/alerting/) to let the system page you when a cluster misbehaves.
