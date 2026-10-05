# Docker deployment

The primary install path: Docker Compose for the full stack (CHouse UI + ClickHouse), or the image alone against an existing cluster.

## Quick stack

```bash
git clone https://github.com/daun-gatal/chouse-ui.git
cd chouse-ui
docker-compose up -d
```

Access at `http://localhost:5521`. The full compose file lives in [`docker-compose.yml`](https://github.com/daun-gatal/chouse-ui/blob/main/docker-compose.yml); a minimal stack is on the [Quick start](/docs/quick-start/) page.

## Production compose

```yaml
services:
  chouse-ui:
    image: ghcr.io/daun-gatal/chouse-ui:latest
    container_name: chouse-ui
    ports:
      - "5521:5521"
    environment:
      NODE_ENV: production
      JWT_SECRET: ${JWT_SECRET}
      RBAC_ENCRYPTION_KEY: ${RBAC_ENCRYPTION_KEY}
      RBAC_ENCRYPTION_SALT: ${RBAC_ENCRYPTION_SALT}
      RBAC_DB_TYPE: postgres
      RBAC_POSTGRES_URL: postgres://user:password@postgres:5432/chouse
      CORS_ORIGIN: https://chouse.yourcorp.com
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

> **Warning:** `${VAR}` references come from your shell/`.env` — never commit real secrets. Generate them per [Secrets generation](/docs/configuration-secrets/).

## Volumes

| Path | Contents |
| --- | --- |
| `/app/data` | The SQLite RBAC database, when you use SQLite |
| PostgreSQL (recommended for production) | All CHouse UI state, so the container can be replaced freely |

## Ports

| Port | Purpose |
| --- | --- |
| `5521` | UI, API and the [MCP](/docs/mcp/) endpoint (`/mcp`, off until turned on in AI Governance › MCP) |

## Upgrading

```bash
docker pull ghcr.io/daun-gatal/chouse-ui:latest
docker compose up -d
docker logs chouse-ui | grep RBAC   # verify migration status
```

Migrations run automatically on boot — see [Migrations & upgrades](/docs/migrations-upgrades/).

## Health & logs

```bash
docker logs -f chouse-ui           # Pino JSON logs, LOG_LEVEL controls verbosity
curl -s http://localhost:5521/api/health   # liveness
```

## Behind a reverse proxy

Terminate TLS at the proxy and forward to `5521`. Set `CORS_ORIGIN` and `PUBLIC_BASE_URL` to the public URL. MCP is served at `/mcp` on the same upstream, so it needs no extra rule — but AI chat and MCP stream responses, so raise the read timeout and turn off response buffering. Make the proxy set `X-Forwarded-For` to the real client IP; sign-in rate limiting relies on it.

## Kubernetes instead?

Use the signed Helm chart — [Helm chart](/docs/deploy-helm/).
