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
      # Throwaway local values. Production mode checks their length at startup:
      # JWT_SECRET and RBAC_ENCRYPTION_KEY need 32+ characters, the salt exactly 64.
      JWT_SECRET: dev-jwt-secret-change-me-min-32-characters-long
      RBAC_ENCRYPTION_KEY: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
      RBAC_ENCRYPTION_SALT: fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210
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

> **Warning:** These placeholder secrets are public. They are fine for a local throwaway, but the server refuses to start in production mode with shorter ones. Before exposing CHouse UI to anyone, generate real secrets — see [Secrets generation](/docs/configuration-secrets/) and the [Production checklist](/docs/production-checklist/).

## Open and sign in

Navigate to `http://localhost:5521`. On first run an admin user is created automatically:

| Field | Value |
| --- | --- |
| URL | `http://localhost:5521` |
| Email | `admin@localhost` |
| Username | `admin` |
| Password | `admin123!` |

> **Warning:** Change this password right away — the **Getting started** guide that opens on first sign-in has a **Change password** step ([First login](/docs/first-login/#the-getting-started-guide)).

## Connect to ClickHouse

After login, add your first ClickHouse connection:

1. Open **Admin › Connections**.
2. Add a connection with host `clickhouse-server:8123` (from inside the compose network), user `admin`, password `password`.
3. Save — credentials are encrypted with AES-256-GCM server-side, never exposed to the browser.

Make it the active connection, then open **Explorer** to start querying in the [SQL editor](/docs/workspace-editor/), or **Data** to see what CHouse UI learns about your tables.

## Next steps

- [First login](/docs/first-login/) — the first-run tour and initial settings
- [Core concepts](/docs/concepts/) — how RBAC, connections and the proxy fit together
- [Docker deployment](/docs/deploy-docker/) — production hardening for the same stack
- [Helm chart](/docs/deploy-helm/) — Kubernetes install from the signed OCI chart
