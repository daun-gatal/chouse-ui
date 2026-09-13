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
      FLEET_POLLER_ENABLED: "true"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

> **Warning:** `${VAR}` references come from your shell/`.env` — never commit real secrets. Generate them per [Secrets generation](/docs/configuration-secrets/).

## Volumes

| Path | Contents |
| --- | --- |
| `/app/data` | SQLite RBAC DB (if used), alert config, doctor schedule |
| PostgreSQL (recommended) | RBAC data — survives container replacement cleanly |

## Ports

| Port | Purpose |
| --- | --- |
| `5521` | UI + API |
| `8752` | [MCP](/docs/mcp/) — expose only if enabled |

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
curl -s http://localhost:5521/     # UI responds
```

## Behind a reverse proxy

Terminate TLS at the proxy; forward to `5521`. Set `CORS_ORIGIN` to the public URL. For MCP over the same domain, proxy `8752` and raise the read timeout (SSE streaming) — details in the [MCP page](/docs/mcp/).

## Kubernetes instead?

Use the signed Helm chart — [Helm chart](/docs/deploy-helm/).
