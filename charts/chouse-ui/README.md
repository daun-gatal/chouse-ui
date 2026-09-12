# chouse-ui

![Version: 1.3.0](https://img.shields.io/badge/Version-1.3.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 3.12.1](https://img.shields.io/badge/AppVersion-3.12.1-informational?style=flat-square)

A modern web interface for ClickHouse with built-in RBAC, fleet monitoring, scheduled queries, data health checks, and an AI SRE.

The chart deploys the single CHouse UI container (API + SPA on port 5521) and
wires the topology rules the app expects — so a broken layout fails at
`helm install` instead of corrupting data at runtime.

## Quickstart

```bash
helm install chouse-ui oci://ghcr.io/daun-gatal/charts/chouse-ui \
  --set secrets.jwtSecret="$(openssl rand -base64 32)" \
  --set secrets.encryptionKey="$(openssl rand -hex 32)" \
  --set secrets.encryptionSalt="$(openssl rand -hex 32)"

kubectl port-forward svc/chouse-ui 5521:80
```

Log in at http://localhost:5521 with `admin@localhost` / `admin123!` — and
change that password immediately.

> **Keep those three secrets safe.** `encryptionKey`/`encryptionSalt` protect
> every stored ClickHouse connection password; if they change, those stored
> credentials are unrecoverable. For real installs put them in a Secret and
> pass `secrets.existingSecret` (keys `JWT_SECRET`, `RBAC_ENCRYPTION_KEY`,
> `RBAC_ENCRYPTION_SALT`).

## Choosing a topology

| | SQLite (default) | PostgreSQL |
|---|---|---|
| Replicas | exactly 1 (enforced) | any — the chart sets `CHOUSE_HA=true` when >1 |
| State | PVC at `/app/data` (kept on uninstall) | external database, stateless pods |
| Rollouts | `Recreate` (brief downtime) | `RollingUpdate`, HPA, PDB, spread constraints |
| Good for | single-team installs, evaluation | production, HA |

```yaml
# HA example
replicaCount: 3
database:
  type: postgres
  postgres:
    existingSecret: chouse-postgres      # key RBAC_POSTGRES_URL
secrets:
  existingSecret: chouse-secrets
pdb:
  enabled: true
```

The chart deliberately bundles **no** PostgreSQL or ClickHouse — bring your
own (CloudNativePG or a managed Postgres work well). Migrations run at pod
start and are safe under concurrent replica boot (Postgres advisory lock).

## Trying it out with everything included

For evaluation, the chart can stand up PostgreSQL and a single-node ClickHouse
alongside the app, so you get a working install with nothing external:

```bash
helm install chouse-ui oci://ghcr.io/daun-gatal/charts/chouse-ui \
  --set database.type=postgres \
  --set postgresql.enabled=true \
  --set postgresql.auth.password="$(openssl rand -hex 16)" \
  --set clickhouse.enabled=true \
  --set clickhouse.auth.password="$(openssl rand -hex 16)" \
  --set secrets.jwtSecret="$(openssl rand -base64 32)" \
  --set secrets.encryptionKey="$(openssl rand -hex 32)" \
  --set secrets.encryptionSalt="$(openssl rand -hex 32)"
```

Sign in and the connection form is already pointed at the bundled ClickHouse —
add it with the password above and start querying.

> **These are for evaluation and CI only.** Single pods, no backups, no
> failover, no upgrade path, and **persistence is off by default** (data is
> lost on restart — set `postgresql.persistence.enabled=true` /
> `clickhouse.persistence.enabled=true` for a longer-lived demo). For
> production, leave both disabled and point the chart at a managed PostgreSQL
> (or CloudNativePG) and the Altinity/ClickHouse operator. See
> [ADR 0009](../../docs/adr/0009-bundled-evaluation-databases.md).

## App configuration

Everything the app reads from its config file — SSO, fleet poller, AI doctor,
admin seeding, CORS, log level — goes under the freeform `config:` block,
which the chart renders into a Secret-mounted `config.yaml` (schema:
[`.config.example.yaml`](../../.config.example.yaml)):

```yaml
config:
  cors_origin: "https://chouse.example.com"
  fleet:
    poller_enabled: true
  auth:
    sso:
      enabled: true
      base_url: https://chouse.example.com
      providers:
        okta:
          type: oidc
          display_name: "Okta"
          issuer: https://corp.okta.com
          client_id: "..."
          client_secret: "${OKTA_CLIENT_SECRET}"   # via extraEnv from a Secret
extraEnv:
  - name: OKTA_CLIENT_SECRET
    valueFrom:
      secretKeyRef:
        name: okta-oidc
        key: client_secret
```

Keys the chart already manages (`port`, `rbac.db_type`, `jwt.secret`, …) are
rejected at render time to avoid silent conflicts — use the chart values for
those.

## Ingress notes

- AI chat streams over **SSE**: raise the proxy read timeout (nginx:
  `nginx.ingress.kubernetes.io/proxy-read-timeout: "300"`) and disable
  response buffering (`nginx.ingress.kubernetes.io/proxy-buffering: "off"`).
- Login rate limiting keys on **`X-Forwarded-For`** — the ingress must
  overwrite it with the real client IP (nginx: `use-forwarded-headers`
  configured correctly), or all users share one rate-limit bucket and
  spoofed headers bypass it.

## Migrating from docker-compose

Move to PostgreSQL *before* moving to Kubernetes, or copy your existing
`data/` directory into the release's PVC — the one-time legacy import of
`alert-config.json` / `doctor-schedule.json` and your SQLite database both
live there.

## Requirements

Kubernetes: `>=1.25.0-0`

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| affinity | object | `{}` | Affinity for all pods. |
| autoscaling.enabled | bool | `false` | Horizontal pod autoscaling for the web pods. Requires `database.type: postgres` (render fails on sqlite). Implies `CHOUSE_HA=true` regardless of `replicaCount`. |
| autoscaling.maxReplicas | int | `5` |  |
| autoscaling.minReplicas | int | `2` |  |
| autoscaling.targetCPUUtilizationPercentage | int | `80` | Target average CPU utilization (percent). |
| autoscaling.targetMemoryUtilizationPercentage | string | `""` | Target average memory utilization (percent). Empty disables the memory metric. |
| clickhouse.auth.accessManagement | bool | `true` | Grant the user access management rights (needed for CHouse UI's ClickHouse user/role management features). |
| clickhouse.auth.password | string | `""` |  |
| clickhouse.auth.username | string | `"default"` | ClickHouse user and password. The password is **required** when enabled. `openssl rand -hex 16`. |
| clickhouse.enabled | bool | `false` | Deploy a single-node ClickHouse StatefulSet and pre-fill the app's connection form with its in-cluster URL. |
| clickhouse.image.pullPolicy | string | `"IfNotPresent"` |  |
| clickhouse.image.repository | string | `"clickhouse/clickhouse-server"` |  |
| clickhouse.image.tag | string | `"25.3-alpine"` |  |
| clickhouse.nodeSelector | object | `{}` | Node selector for the ClickHouse pod. |
| clickhouse.persistence.enabled | bool | `false` | Off by default, same reasoning as the bundled PostgreSQL. |
| clickhouse.persistence.size | string | `"10Gi"` |  |
| clickhouse.persistence.storageClass | string | `""` |  |
| clickhouse.podSecurityContext | object | `{"fsGroup":101,"runAsGroup":101,"runAsNonRoot":true,"runAsUser":101,"seccompProfile":{"type":"RuntimeDefault"}}` | Pod security context. Defaults suit the official ClickHouse image (runs as uid/gid 101). |
| clickhouse.resources.limits.memory | string | `"2Gi"` |  |
| clickhouse.resources.requests.cpu | string | `"250m"` |  |
| clickhouse.resources.requests.memory | string | `"512Mi"` |  |
| clickhouse.tolerations | list | `[]` | Tolerations for the ClickHouse pod. |
| commonLabels | object | `{}` | Labels added to every rendered resource. |
| config | object | `{}` | Freeform CHouse UI configuration, rendered to a Secret-mounted `config.yaml` (see `.config.example.yaml` in the repo for the full schema: SSO, fleet poller, AI doctor, admin seeding, CORS, log level, ...). Do NOT set keys the chart already manages (`port`, `node_env`, `static_path`, `rbac.db_type`, `rbac.sqlite_path`, `rbac.postgres_url`, `rbac.encryption`, `jwt.secret`, `scheduled_queries`) — the chart refuses to render if you do, because config.yaml values override the pod environment. |
| containerSecurityContext | object | `{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":true}` | Container security context. The root filesystem is read-only; the chart mounts an emptyDir on `/tmp`. |
| database.postgres.existingSecret | string | `""` | Name of an existing Secret holding the connection URL. |
| database.postgres.existingSecretKey | string | `"RBAC_POSTGRES_URL"` | Key inside `existingSecret` that holds the URL. |
| database.postgres.poolSize | int | `10` | Connection pool size per pod. |
| database.postgres.url | string | `""` | Full PostgreSQL connection URL (`postgres://user:pass@host:5432/dbname`). Stored in a chart-managed Secret. Prefer `existingSecret` so the URL never lands in values files. |
| database.sqlite.persistence.accessModes | list | `["ReadWriteOnce"]` | PVC access modes. |
| database.sqlite.persistence.annotations | object | `{}` | Extra annotations for the PVC (e.g. to keep it on helm uninstall). |
| database.sqlite.persistence.enabled | bool | `true` | Persist the SQLite database (`/app/data`) on a PVC. Disabling this loses all users, connections, and settings on every pod restart — only do it for throwaway installs. |
| database.sqlite.persistence.existingClaim | string | `""` | Use a pre-created PVC instead of chart-managed one. |
| database.sqlite.persistence.size | string | `"1Gi"` | PVC size. |
| database.sqlite.persistence.storageClass | string | `""` | StorageClass. Empty string uses the cluster default. |
| database.type | string | `"sqlite"` | RBAC database backend: `sqlite` (single replica + PVC) or `postgres` (external PostgreSQL; required for HA / more than one replica). |
| dedicatedScheduler.enabled | bool | `false` | Run the scheduled-queries scheduler on a dedicated single-replica Deployment instead of the web pods. Requires `database.type: postgres`. |
| dedicatedScheduler.resources | object | `{}` | Resources for the scheduler pod. |
| extraEnv | list | `[]` | Extra environment variables for the web pods (list of EnvVar). Useful for referencing SSO client secrets from Secrets via `valueFrom`. |
| extraEnvFrom | list | `[]` | Extra `envFrom` sources (ConfigMap/Secret refs) for the web pods. |
| extraVolumeMounts | list | `[]` | Extra volume mounts for the web container. |
| extraVolumes | list | `[]` | Extra volumes for the web pods. |
| fullnameOverride | string | `""` | Override the fully qualified release name. |
| image.pullPolicy | string | `"IfNotPresent"` | Image pull policy. |
| image.repository | string | `"ghcr.io/daun-gatal/chouse-ui"` | Container image repository. |
| image.tag | string | `""` | Image tag. Defaults to `v<Chart.appVersion>`. |
| imagePullSecrets | list | `[]` | Secrets for pulling the image from a private registry. |
| ingress.annotations | object | `{}` | Ingress annotations. Two matter operationally: AI chat streams over SSE, so raise the proxy read timeout (nginx: `nginx.ingress.kubernetes.io/proxy-read-timeout: "300"`) and disable buffering (`nginx.ingress.kubernetes.io/proxy-buffering: "off"`); and login rate limiting keys on X-Forwarded-For, so the ingress must overwrite it with the real client IP. |
| ingress.className | string | `""` | IngressClass name. |
| ingress.enabled | bool | `false` | Expose the UI through an Ingress. |
| ingress.hosts[0].host | string | `"chouse-ui.local"` |  |
| ingress.hosts[0].paths[0].path | string | `"/"` |  |
| ingress.hosts[0].paths[0].pathType | string | `"Prefix"` |  |
| ingress.tls | list | `[]` | TLS configuration. |
| initContainers | list | `[]` | Extra init containers for the web pods. |
| mcp.allowDestructive | bool | `false` | Enable destructive tools (KILL, raw SQL, deletes). Requires `allowWrites`, and every invocation additionally requires in-host human approval (MCP elicitation). |
| mcp.allowWrites | bool | `false` | Allow the write-gated toolset (create/run/ack actions). This is a server-side policy — agents cannot opt in; read-only is the default. |
| mcp.allowedOrigins | list | `[]` | Origins allowed on the MCP endpoint. Empty rejects any request that carries an Origin header (DNS-rebinding protection); headerless clients (CLI agents, curl) always pass. Browser-embedded MCP hosts must be listed here explicitly. |
| mcp.enabled | bool | `false` | Serve the MCP (Model Context Protocol) endpoint on a dedicated port (8752) so AI agents can operate CHouse UI safely without the browser (ADR 0013). Authentication is PAT-only (`Authorization: Bearer ch_pat_…`, minted once in the UI); requests are verified live against RBAC on every call, exactly like the UI and CLI. Disabled by default: no Service, no port, unreachable. |
| mcp.service.port | int | `8752` | Service port for the dedicated MCP Service (`<release>-mcp`). |
| mcp.timeoutSeconds | int | `60` | Per-request tool timeout in seconds (1..600). |
| mcp.toolsets | list | `["core","explore","query","observe","ops"]` | Toolsets to register. Default: reads only. `writes`/`destructive` additionally require the flags above; `ai` spends LLM budget. |
| nameOverride | string | `""` | Override the chart name. |
| networkPolicy.egressTo | list | `[]` | Extra egress rules (full NetworkPolicyEgressRule objects) applied when `restrictEgress` is true. |
| networkPolicy.enabled | bool | `false` | Create a NetworkPolicy for the pods. |
| networkPolicy.ingressFrom | list | `[]` | Extra `from` peers allowed to reach the pods on the app port (in addition to same-namespace pods). Use this to admit your ingress controller's namespace. |
| networkPolicy.restrictEgress | bool | `false` | Restrict egress. When true, only DNS plus `egressTo` are allowed — list your ClickHouse hosts, PostgreSQL, IdP, SMTP, and AI provider endpoints there. When false, all egress is allowed. |
| nodeSelector | object | `{}` | Node selector for all pods. |
| pdb.enabled | bool | `false` | PodDisruptionBudget for the web pods. Only meaningful with more than one replica. |
| pdb.maxUnavailable | string | `""` | Maximum pods that may be unavailable. Set `minAvailable` to "" when using this. |
| pdb.minAvailable | int | `1` | Minimum pods that must stay available. Mutually exclusive with `maxUnavailable`. |
| podAnnotations | object | `{}` | Extra annotations for the pods. |
| podLabels | object | `{}` | Extra labels for the pods. |
| podSecurityContext | object | `{"fsGroup":1001,"runAsGroup":1001,"runAsNonRoot":true,"runAsUser":1001,"seccompProfile":{"type":"RuntimeDefault"}}` | Pod security context. The image runs as uid/gid 1001; `fsGroup` makes the SQLite PVC writable. |
| postgresql.auth.database | string | `"chouse"` | Database name, user, and password. The password is **required** when enabled — the chart never invents credentials. `openssl rand -hex 16`. |
| postgresql.auth.password | string | `""` |  |
| postgresql.auth.username | string | `"chouse"` |  |
| postgresql.enabled | bool | `false` | Deploy a PostgreSQL StatefulSet alongside the app and wire `RBAC_POSTGRES_URL` to it. Requires `database.type: postgres`, and conflicts with `database.postgres.url`/`existingSecret`. |
| postgresql.image.pullPolicy | string | `"IfNotPresent"` |  |
| postgresql.image.repository | string | `"postgres"` |  |
| postgresql.image.tag | string | `"16-alpine"` |  |
| postgresql.nodeSelector | object | `{}` | Node selector for the database pod. |
| postgresql.persistence.enabled | bool | `false` | Off by default: an evaluation database that loses its data on restart is honest about what it is. Turn it on for a longer-lived demo. |
| postgresql.persistence.size | string | `"8Gi"` |  |
| postgresql.persistence.storageClass | string | `""` |  |
| postgresql.podSecurityContext | object | `{"fsGroup":70,"runAsGroup":70,"runAsNonRoot":true,"runAsUser":70,"seccompProfile":{"type":"RuntimeDefault"}}` | Pod security context. Defaults suit the official postgres image (runs as uid/gid 70 on Alpine). |
| postgresql.resources.limits.memory | string | `"1Gi"` |  |
| postgresql.resources.requests.cpu | string | `"100m"` |  |
| postgresql.resources.requests.memory | string | `"256Mi"` |  |
| postgresql.tolerations | list | `[]` | Tolerations for the database pod. |
| preStopSleepSeconds | int | `5` | Seconds the web container keeps serving after Kubernetes starts terminating it (preStop sleep). Endpoint removal reaches kube-proxy asynchronously; without this, connections routed to a terminating pod during a rolling update can hang. Set to 0 to disable. Applies to web pods only (the scheduler receives no Service traffic). |
| priorityClassName | string | `""` | Priority class for all pods. |
| probes.liveness | object | `{"failureThreshold":3,"httpGet":{"path":"/api/health","port":"http"},"periodSeconds":20,"timeoutSeconds":5}` | Liveness probe — dependency-free endpoint. |
| probes.readiness | object | `{"failureThreshold":3,"httpGet":{"path":"/api/rbac/health","port":"http"},"periodSeconds":10,"timeoutSeconds":5}` | Readiness probe — 503 until the RBAC database is healthy and migrations have applied. |
| probes.startup | object | `{"failureThreshold":60,"httpGet":{"path":"/api/rbac/health","port":"http"},"periodSeconds":5,"timeoutSeconds":5}` | Startup probe — generous budget (5 min) so long upgrade migrations don't get the pod killed. |
| replicaCount | int | `1` | Number of web pods. Must be 1 when `database.type` is `sqlite` (the chart refuses to render otherwise). When >1, the chart sets `CHOUSE_HA=true` on the pods automatically. |
| resources.limits.memory | string | `"1Gi"` |  |
| resources.requests.cpu | string | `"250m"` |  |
| resources.requests.memory | string | `"256Mi"` |  |
| scheduledQueries.enabled | bool | `true` | Run the in-process scheduled-queries scheduler on the web pods. Redundant ticks across pods are harmless (per-job atomic lease on PostgreSQL). Ignored (forced off on web pods) when `dedicatedScheduler.enabled` is true. |
| secrets.encryptionKey | string | `""` | AES-256 key for stored connection passwords, 64 hex chars. Generate: `openssl rand -hex 32`. |
| secrets.encryptionSalt | string | `""` | Key-derivation salt, exactly 64 hex chars. Generate: `openssl rand -hex 32`. |
| secrets.existingSecret | string | `""` | Name of an existing Secret with keys `JWT_SECRET`, `RBAC_ENCRYPTION_KEY`, and `RBAC_ENCRYPTION_SALT` (recommended). When empty, the three inline values below are required and rendered into a chart-managed Secret. The chart never auto-generates these: the encryption key/salt protect stored ClickHouse passwords, and a regenerated key makes them unrecoverable. |
| secrets.jwtSecret | string | `""` | JWT signing secret, min 32 chars. Generate: `openssl rand -base64 32`. |
| service.annotations | object | `{}` | Extra annotations for the Service. |
| service.port | int | `80` | Service port (targets the fixed container port 5521). |
| service.sessionAffinity | string | `""` | Service `sessionAffinity` (`ClientIP` or `None`). Since ADR 0010 the app keeps no request-authoritative state in pod memory, so multi-replica is correct WITHOUT stickiness and you should not need this. It remains available for operators who want a client pinned to one pod for other reasons (e.g. warm per-pod caches). Note that behind an ingress controller or mesh proxy every request appears to come from the proxy's IP, which collapses `ClientIP` affinity onto a single pod — prefer cookie affinity at your ingress if you need stickiness. |
| service.sessionAffinityTimeoutSeconds | int | `10800` | Session stickiness timeout when `sessionAffinity: ClientIP`. |
| service.type | string | `"ClusterIP"` | Service type. |
| serviceAccount.annotations | object | `{}` | Annotations for the ServiceAccount. |
| serviceAccount.create | bool | `true` | Create a ServiceAccount for the pods. |
| serviceAccount.name | string | `""` | ServiceAccount name override. |
| terminationGracePeriodSeconds | int | `60` | Grace period so the SIGTERM handler can release poller leases and drain scheduled-query slots. |
| tolerations | list | `[]` | Tolerations for all pods. |
| topologySpreadConstraints | list | `[]` | Topology spread constraints for the web pods (postgres/HA installs). |

----------------------------------------------
Autogenerated from chart metadata using [helm-docs v1.14.2](https://github.com/norwoodj/helm-docs/releases/v1.14.2)
