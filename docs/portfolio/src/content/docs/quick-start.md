# Quick start

CHouse UI ships as a single Docker image that pairs with any ClickHouse server. This page takes you from zero to a running UI with the bundled ClickHouse in under five minutes.

## Prerequisites

- Docker and Docker Compose installed
- Ports `5521` (CHouse UI) and `8123` (ClickHouse HTTP) free
- 2 GB RAM recommended

## One-file compose stack

Create a `docker-compose.yml` with the full stack — CHouse UI plus a ClickHouse server:

```yaml
services:
  chouse-ui:
    image: ghcr.io/daun-gatal/chouse-ui:latest
    container_name: chouse-ui
    ports:
      - "5521:5521"
    environment:
      NODE_ENV: production
      JWT_SECRET: dev-secret-change-me
      RBAC_ENCRYPTION_KEY: dev-key-change-me
      RBAC_ENCRYPTION_SALT: dev-salt-change-me
    volumes:
      - ./data:/app/data
    restart: unless-stopped

  clickhouse:
    image: clickhouse/clickhouse-server:latest
    container_name: clickhouse-server
    ports:
      - "8123:8123"
    environment:
      CLICKHOUSE_USER: admin
      CLICKHOUSE_PASSWORD: password
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: 1
    restart: unless-stopped
```

Then start it:

```bash
docker compose up -d
```

> **Warning:** The `dev-secret-*` placeholders are fine for a local throwaway. Before exposing CHouse UI to anyone, generate real secrets — see [Secrets generation](/docs/configuration-secrets/) and the [Production checklist](/docs/production-checklist/).

## Open and sign in

Navigate to `http://localhost:5521`. On first run an admin user is created automatically:

| Field | Value |
| --- | --- |
| URL | `http://localhost:5521` |
| Email | `admin@localhost` |
| Username | `admin` |
| Password | `admin123!` |

> **Warning:** Rotate this password immediately — Preferences → Account — before anyone else can reach the instance.

## Connect to ClickHouse

After login, add your first ClickHouse connection:

1. Open **Admin → Connections**.
2. Add a connection with host `clickhouse-server:8123` (from inside the compose network), user `admin`, password `password`.
3. Save — credentials are encrypted with AES-256-GCM server-side, never exposed to the browser.

You now land on the [Overview dashboard](/docs/workspace-overview/) and can start querying in the [SQL editor](/docs/workspace-editor/).

## Next steps

- [First login](/docs/first-login/) — the first-run tour and initial settings
- [Core concepts](/docs/concepts/) — how RBAC, connections and the proxy fit together
- [Docker deployment](/docs/deploy-docker/) — production hardening for the same stack
- [Helm chart](/docs/deploy-helm/) — Kubernetes install from the signed OCI chart
