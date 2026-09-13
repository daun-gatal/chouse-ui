# Helm chart

The production Helm chart is published to GHCR as a **signed OCI artifact** — install with three commands:

```bash
helm install chouse-ui oci://ghcr.io/daun-gatal/charts/chouse-ui \
  --set secrets.jwtSecret="$(openssl rand -base64 32)" \
  --set secrets.encryptionKey="$(openssl rand -hex 32)" \
  --set secrets.encryptionSalt="$(openssl rand -hex 32)"
```

Full values and the topology guide: [`charts/chouse-ui/README.md`](https://github.com/daun-gatal/chouse-ui/blob/main/charts/chouse-ui/README.md) and [ADR 0008](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0008-helm-chart-and-oci-distribution.md).

## Topology

| Choice | Configuration | Implication |
| --- | --- | --- |
| **Single replica + SQLite** | default (`replicaCount: 1`, `database.type: sqlite`) | State on a PersistentVolumeClaim; simplest install |
| **HA + PostgreSQL** | `database.type: postgres` + `replicaCount > 1` | Chart provisions PostgreSQL (`postgres.image`/tag), points `RBAC_POSTGRES_URL` at it, sets `CHOUSE_HA` |

The chart **enforces topology rules at render time** — SQLite cannot span pods; asking for replicas with SQLite fails the render instead of misbehaving at runtime.

## Bundled evaluation databases

For trying it out with everything included, the chart can deploy a bundled ClickHouse and a PostgreSQL instance — see "Trying it out" in the chart README. Production installs usually point `clickhouse` at external clusters and manage PostgreSQL themselves.

## App configuration

App-level settings (ClickHouse presets, [SSO](/docs/sso/), [MCP](/docs/mcp/), [scheduled queries](/docs/scheduled-queries/), [fleet](/docs/fleet-view/)) map to the same keys as the [YAML configuration](/docs/configuration-yaml/) — provided as chart values rather than env plumbing.

## Ingress notes

- UI ingress: standard `className`/`annotations`/`tls` values
- [MCP](/docs/mcp/) ingress: mirrors the UI ingress shape; raise the read timeout and disable buffering for SSE:

```yaml
ingress:
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
```

## Secrets

| Value | Feeds |
| --- | --- |
| `secrets.jwtSecret` | `JWT_SECRET` |
| `secrets.encryptionKey` | `RBAC_ENCRYPTION_KEY` |
| `secrets.encryptionSalt` | `RBAC_ENCRYPTION_SALT` |

Rotate by upgrading with new values (note the [rotation caveats](/docs/configuration-secrets/)).

## Migrating from docker-compose

The chart README includes a docker-compose → Helm migration path (data export/import for the RBAC store). Schedule a window for the credential re-encryption if keys change.

## Verification

```bash
kubectl get pods -l app.kubernetes.io/instance=chouse-ui
kubectl logs deploy/chouse-ui | grep RBAC   # migrations
```
