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
- [ ] Restrict access with firewall rules — `5521` serves the UI, API and MCP (`/mcp`)
- [ ] Make the proxy set `X-Forwarded-For` to the real client IP (sign-in rate limiting depends on it)
- [ ] Register the SSO redirect URI at your IdP if using SSO

## Storage

- [ ] Use PostgreSQL (`RBAC_DB_TYPE=postgres` + `RBAC_POSTGRES_URL`) for multi-instance deployments — SQLite cannot span pods
- [ ] With SQLite, mount a persistent volume at `/app/data`
- [ ] Schedule database backups — including the secrets needed to decrypt stored passwords

## Runtime

- [ ] Set `NODE_ENV=production` and `LOG_LEVEL=info` (or `warn`)
- [ ] Run **Check privileges** on each connection (**Admin › Connections › Edit**) so the [collector](/docs/data-observability/#grant-the-collector-what-it-needs) can read the system tables it needs
- [ ] To use [fixes](/docs/data-incidents/#set-up-fixes-for-a-connection), give each connection a remediation credential with only the grants the fixes need
- [ ] Set `PUBLIC_BASE_URL` to the address people use
- [ ] Leave MCP off (Agents › MCP) unless agents need access; turn on only the tools they need, and set [agent budgets](/docs/agents/)
- [ ] Verify migrations ran on boot: `docker logs chouse-ui | grep RBAC`

## AI (optional)

- [ ] Configure AI providers via **Admin › AI models** before enabling AI features
- [ ] AI calls spend provider tokens — set spending limits at the provider
- [ ] Gate who can spend tokens with `ai:optimize` / `ai:chat` / `doctor:run`

## Verification

```bash
# Health of the deployment
curl -s http://localhost:5521/api/health | head -1   # or your host
docker logs chouse-ui | grep -i error | head
```

Done? CHouse UI is production-ready. Ongoing care: [audit log](/docs/audit-log/) review, [Migrations & upgrades](/docs/migrations-upgrades/) for safe version bumps, and [Alerting](/docs/alerting/) to let the system page you when a cluster misbehaves.
