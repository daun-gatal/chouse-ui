---
generated: charts/chouse-ui/values.yaml (via the chart README)
---
Every value of the `chouse-ui` Helm chart, version **2.0.1**. Installing, topology and upgrades are covered in [Helm chart](/docs/deploy-helm/); this page is the lookup table.

The app itself is configured through the free-form `config:` value, which the chart renders to a YAML file loaded via `CHOUSE_CONFIG_PATH` — so every key on [Environment variables](/docs/configuration-env/) can go there. Secrets belong in `secrets.*` or an existing Kubernetes secret, not in `config:`.

## affinity

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `affinity` | `object` | `{}` | Affinity for all pods. |

## autoscaling

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `autoscaling.enabled` | `bool` | `false` | Horizontal pod autoscaling for the web pods. Requires `database.type: postgres` (render fails on sqlite). Implies `CHOUSE_HA=true` regardless of `replicaCount`. |
| `autoscaling.maxReplicas` | `int` | `5` |   |
| `autoscaling.minReplicas` | `int` | `2` |   |
| `autoscaling.targetCPUUtilizationPercentage` | `int` | `80` | Target average CPU utilization (percent). |
| `autoscaling.targetMemoryUtilizationPercentage` | `string` | `""` | Target average memory utilization (percent). Empty disables the memory metric. |

## clickhouse

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `clickhouse.auth.accessManagement` | `bool` | `true` | Grant the user access management rights (needed for CHouse UI's ClickHouse user/role management features). |
| `clickhouse.auth.password` | `string` | `""` |   |
| `clickhouse.auth.username` | `string` | `"default"` | ClickHouse user and password. The password is **required** when enabled. `openssl rand -hex 16`. |
| `clickhouse.enabled` | `bool` | `false` | Deploy a single-node ClickHouse StatefulSet and pre-fill the app's connection form with its in-cluster URL. |
| `clickhouse.image.pullPolicy` | `string` | `"IfNotPresent"` |   |
| `clickhouse.image.repository` | `string` | `"clickhouse/clickhouse-server"` |   |
| `clickhouse.image.tag` | `string` | `"25.3-alpine"` |   |
| `clickhouse.nodeSelector` | `object` | `{}` | Node selector for the ClickHouse pod. |
| `clickhouse.persistence.enabled` | `bool` | `false` | Off by default, same reasoning as the bundled PostgreSQL. |
| `clickhouse.persistence.size` | `string` | `"10Gi"` |   |
| `clickhouse.persistence.storageClass` | `string` | `""` |   |
| `clickhouse.podSecurityContext` | `object` | `{"fsGroup":101,"runAsGroup":101,"runAsNonRoot":true,"runAsUser":101,"seccompProfile":{"type":"RuntimeDefault"}}` | Pod security context. Defaults suit the official ClickHouse image (runs as uid/gid 101). |
| `clickhouse.resources.limits.memory` | `string` | `"2Gi"` |   |
| `clickhouse.resources.requests.cpu` | `string` | `"250m"` |   |
| `clickhouse.resources.requests.memory` | `string` | `"512Mi"` |   |
| `clickhouse.tolerations` | `list` | `[]` | Tolerations for the ClickHouse pod. |

## commonLabels

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `commonLabels` | `object` | `{}` | Labels added to every rendered resource. |

## config

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `config` | `object` | `{}` | Freeform CHouse UI configuration, rendered to a Secret-mounted `config.yaml` (see `.config.example.yaml` in the repo for the full schema: SSO, fleet poller, AI doctor, admin seeding, CORS, log level, ...). Do NOT set keys the chart already manages (`port`, `node_env`, `static_path`, `rbac.db_type`, `rbac.sqlite_path`, `rbac.postgres_url`, `rbac.encryption`, `jwt.secret`, `scheduled_queries`) — the chart refuses to render if you do, because config.yaml values override the pod environment. |

## containerSecurityContext

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `containerSecurityContext` | `object` | `{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":true}` | Container security context. The root filesystem is read-only; the chart mounts an emptyDir on `/tmp`. |

## database

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `database.postgres.existingSecret` | `string` | `""` | Name of an existing Secret holding the connection URL. |
| `database.postgres.existingSecretKey` | `string` | `"RBAC_POSTGRES_URL"` | Key inside `existingSecret` that holds the URL. |
| `database.postgres.poolSize` | `int` | `10` | Connection pool size per pod. |
| `database.postgres.url` | `string` | `""` | Full PostgreSQL connection URL (`postgres://user:pass@host:5432/dbname`). Stored in a chart-managed Secret. Prefer `existingSecret` so the URL never lands in values files. |
| `database.sqlite.persistence.accessModes` | `list` | `["ReadWriteOnce"]` | PVC access modes. |
| `database.sqlite.persistence.annotations` | `object` | `{}` | Extra annotations for the PVC (e.g. to keep it on helm uninstall). |
| `database.sqlite.persistence.enabled` | `bool` | `true` | Persist the SQLite database (`/app/data`) on a PVC. Disabling this loses all users, connections, and settings on every pod restart — only do it for throwaway installs. |
| `database.sqlite.persistence.existingClaim` | `string` | `""` | Use a pre-created PVC instead of chart-managed one. |
| `database.sqlite.persistence.size` | `string` | `"1Gi"` | PVC size. |
| `database.sqlite.persistence.storageClass` | `string` | `""` | StorageClass. Empty string uses the cluster default. |
| `database.type` | `string` | `"sqlite"` | RBAC database backend: `sqlite` (single replica + PVC) or `postgres` (external PostgreSQL; required for HA / more than one replica). |

## dedicatedScheduler

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `dedicatedScheduler.enabled` | `bool` | `false` | Run the scheduled-queries scheduler on a dedicated single-replica Deployment instead of the web pods. Requires `database.type: postgres`. |
| `dedicatedScheduler.resources` | `object` | `{}` | Resources for the scheduler pod. |

## extraEnv

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `extraEnv` | `list` | `[]` | Extra environment variables for the web pods (list of EnvVar). Useful for referencing SSO client secrets from Secrets via `valueFrom`. |

## extraEnvFrom

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `extraEnvFrom` | `list` | `[]` | Extra `envFrom` sources (ConfigMap/Secret refs) for the web pods. |

## extraVolumeMounts

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `extraVolumeMounts` | `list` | `[]` | Extra volume mounts for the web container. |

## extraVolumes

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `extraVolumes` | `list` | `[]` | Extra volumes for the web pods. |

## fullnameOverride

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `fullnameOverride` | `string` | `""` | Override the fully qualified release name. |

## image

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `image.pullPolicy` | `string` | `"IfNotPresent"` | Image pull policy. |
| `image.repository` | `string` | `"ghcr.io/daun-gatal/chouse-ui"` | Container image repository. |
| `image.tag` | `string` | `""` | Image tag. Defaults to `v<Chart.appVersion>`. |

## imagePullSecrets

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `imagePullSecrets` | `list` | `[]` | Secrets for pulling the image from a private registry. |

## ingress

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `ingress.annotations` | `object` | `{}` | Ingress annotations. Two matter operationally: AI chat streams over SSE, so raise the proxy read timeout (nginx: `nginx.ingress.kubernetes.io/proxy-read-timeout: "300"`) and disable buffering (`nginx.ingress.kubernetes.io/proxy-buffering: "off"`); and login rate limiting keys on X-Forwarded-For, so the ingress must overwrite it with the real client IP. |
| `ingress.className` | `string` | `""` | IngressClass name. |
| `ingress.enabled` | `bool` | `false` | Expose the UI through an Ingress. |
| `ingress.hosts[0].host` | `string` | `"chouse-ui.local"` |   |
| `ingress.hosts[0].paths[0].path` | `string` | `"/"` |   |
| `ingress.hosts[0].paths[0].pathType` | `string` | `"Prefix"` |   |
| `ingress.tls` | `list` | `[]` | TLS configuration. |

## initContainers

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `initContainers` | `list` | `[]` | Extra init containers for the web pods. |

## nameOverride

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `nameOverride` | `string` | `""` | Override the chart name. |

## networkPolicy

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `networkPolicy.egressTo` | `list` | `[]` | Extra egress rules (full NetworkPolicyEgressRule objects) applied when `restrictEgress` is true. |
| `networkPolicy.enabled` | `bool` | `false` | Create a NetworkPolicy for the pods. |
| `networkPolicy.ingressFrom` | `list` | `[]` | Extra `from` peers allowed to reach the pods on the app port (in addition to same-namespace pods). Use this to admit your ingress controller's namespace. |
| `networkPolicy.restrictEgress` | `bool` | `false` | Restrict egress. When true, only DNS plus `egressTo` are allowed — list your ClickHouse hosts, PostgreSQL, IdP, SMTP, and AI provider endpoints there. When false, all egress is allowed. |

## nodeSelector

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `nodeSelector` | `object` | `{}` | Node selector for all pods. |

## observability

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `observability.fleetIntervalSeconds` | `string` | `""` | Fleet snapshot interval in seconds (`OBSERVE_FLEET_INTERVAL`, app default 30). Replaces `FLEET_POLL_INTERVAL_SECONDS`, which is still read. |
| `observability.maxFingerprints` | `string` | `""` | Query shapes tracked per connection for regression detection (`OBSERVE_MAX_FINGERPRINTS`, app default 5000). |
| `observability.retentionDays` | `string` | `""` | Days of lineage, pipeline and query-shape evidence to keep (`OBSERVE_RETENTION_DAYS`, app default 90). |
| `observability.scratchDatabase` | `string` | `""` | ClickHouse database where codec trials copy samples (`OBSERVE_SCRATCH_DATABASE`, app default `chouse_scratch`). |

## pdb

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `pdb.enabled` | `bool` | `false` | PodDisruptionBudget for the web pods. Only meaningful with more than one replica. |
| `pdb.maxUnavailable` | `string` | `""` | Maximum pods that may be unavailable. Set `minAvailable` to "" when using this. |
| `pdb.minAvailable` | `int` | `1` | Minimum pods that must stay available. Mutually exclusive with `maxUnavailable`. |

## podAnnotations

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `podAnnotations` | `object` | `{}` | Extra annotations for the pods. |

## podLabels

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `podLabels` | `object` | `{}` | Extra labels for the pods. |

## podSecurityContext

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `podSecurityContext` | `object` | `{"fsGroup":1001,"runAsGroup":1001,"runAsNonRoot":true,"runAsUser":1001,"seccompProfile":{"type":"RuntimeDefault"}}` | Pod security context. The image runs as uid/gid 1001; `fsGroup` makes the SQLite PVC writable. |

## postgresql

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `postgresql.auth.database` | `string` | `"chouse"` | Database name, user, and password. The password is **required** when enabled — the chart never invents credentials. `openssl rand -hex 16`. |
| `postgresql.auth.password` | `string` | `""` |   |
| `postgresql.auth.username` | `string` | `"chouse"` |   |
| `postgresql.enabled` | `bool` | `false` | Deploy a PostgreSQL StatefulSet alongside the app and wire `RBAC_POSTGRES_URL` to it. Requires `database.type: postgres`, and conflicts with `database.postgres.url`/`existingSecret`. |
| `postgresql.image.pullPolicy` | `string` | `"IfNotPresent"` |   |
| `postgresql.image.repository` | `string` | `"postgres"` |   |
| `postgresql.image.tag` | `string` | `"16-alpine"` |   |
| `postgresql.nodeSelector` | `object` | `{}` | Node selector for the database pod. |
| `postgresql.persistence.enabled` | `bool` | `false` | Off by default: an evaluation database that loses its data on restart is honest about what it is. Turn it on for a longer-lived demo. |
| `postgresql.persistence.size` | `string` | `"8Gi"` |   |
| `postgresql.persistence.storageClass` | `string` | `""` |   |
| `postgresql.podSecurityContext` | `object` | `{"fsGroup":70,"runAsGroup":70,"runAsNonRoot":true,"runAsUser":70,"seccompProfile":{"type":"RuntimeDefault"}}` | Pod security context. Defaults suit the official postgres image (runs as uid/gid 70 on Alpine). |
| `postgresql.resources.limits.memory` | `string` | `"1Gi"` |   |
| `postgresql.resources.requests.cpu` | `string` | `"100m"` |   |
| `postgresql.resources.requests.memory` | `string` | `"256Mi"` |   |
| `postgresql.tolerations` | `list` | `[]` | Tolerations for the database pod. |

## preStopSleepSeconds

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `preStopSleepSeconds` | `int` | `5` | Seconds the web container keeps serving after Kubernetes starts terminating it (preStop sleep). Endpoint removal reaches kube-proxy asynchronously; without this, connections routed to a terminating pod during a rolling update can hang. Set to 0 to disable. Applies to web pods only (the scheduler receives no Service traffic). |

## priorityClassName

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `priorityClassName` | `string` | `""` | Priority class for all pods. |

## probes

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `probes.liveness` | `object` | `{"failureThreshold":3,"httpGet":{"path":"/api/health","port":"http"},"periodSeconds":20,"timeoutSeconds":5}` | Liveness probe — dependency-free endpoint. |
| `probes.readiness` | `object` | `{"failureThreshold":3,"httpGet":{"path":"/api/rbac/health","port":"http"},"periodSeconds":10,"timeoutSeconds":5}` | Readiness probe — 503 until the RBAC database is healthy and migrations have applied. |
| `probes.startup` | `object` | `{"failureThreshold":60,"httpGet":{"path":"/api/rbac/health","port":"http"},"periodSeconds":5,"timeoutSeconds":5}` | Startup probe — generous budget (5 min) so long upgrade migrations don't get the pod killed. |

## publicBaseUrl

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `publicBaseUrl` | `string` | `""` | External URL of CHouse UI (`PUBLIC_BASE_URL`), used in Slack messages to link back to incidents and fixes. Empty: links are omitted. |

## remediation

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `remediation.maintenanceWindow` | `string` | `""` | UTC window `HH:MM-HH:MM` for window-only fixes such as codec or TTL changes (`REMEDIATION_MAINTENANCE_WINDOW`, app default `02:00-04:00`). |
| `remediation.slackChannel` | `string` | `""` | Slack channel id that receives approval requests (`REMEDIATION_SLACK_CHANNEL`). Needs `slack.*`. |

## replicaCount

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `replicaCount` | `int` | `1` | Number of web pods. Must be 1 when `database.type` is `sqlite` (the chart refuses to render otherwise). When >1, the chart sets `CHOUSE_HA=true` on the pods automatically. |

## resources

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `resources.limits.memory` | `string` | `"1Gi"` |   |
| `resources.requests.cpu` | `string` | `"250m"` |   |
| `resources.requests.memory` | `string` | `"256Mi"` |   |

## scheduledQueries

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `scheduledQueries.enabled` | `bool` | `true` | Run the in-process scheduled-queries scheduler on the web pods. Redundant ticks across pods are harmless (per-job atomic lease on PostgreSQL). Ignored (forced off on web pods) when `dedicatedScheduler.enabled` is true. |

## secrets

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `secrets.encryptionKey` | `string` | `""` | AES-256 key for stored connection passwords, 64 hex chars. Generate: `openssl rand -hex 32`. |
| `secrets.encryptionSalt` | `string` | `""` | Key-derivation salt, exactly 64 hex chars. Generate: `openssl rand -hex 32`. |
| `secrets.existingSecret` | `string` | `""` | Name of an existing Secret with keys `JWT_SECRET`, `RBAC_ENCRYPTION_KEY`, and `RBAC_ENCRYPTION_SALT` (recommended). When empty, the three inline values below are required and rendered into a chart-managed Secret. The chart never auto-generates these: the encryption key/salt protect stored ClickHouse passwords, and a regenerated key makes them unrecoverable. |
| `secrets.jwtSecret` | `string` | `""` | JWT signing secret, min 32 chars. Generate: `openssl rand -base64 32`. |

## service

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `service.annotations` | `object` | `{}` | Extra annotations for the Service. |
| `service.port` | `int` | `80` | Service port (targets the fixed container port 5521). |
| `service.sessionAffinity` | `string` | `""` | Service `sessionAffinity` (`ClientIP` or `None`). Since ADR 0010 the app keeps no request-authoritative state in pod memory, so multi-replica is correct WITHOUT stickiness and you should not need this. It remains available for operators who want a client pinned to one pod for other reasons (e.g. warm per-pod caches). Note that behind an ingress controller or mesh proxy every request appears to come from the proxy's IP, which collapses `ClientIP` affinity onto a single pod — prefer cookie affinity at your ingress if you need stickiness. |
| `service.sessionAffinityTimeoutSeconds` | `int` | `10800` | Session stickiness timeout when `sessionAffinity: ClientIP`. |
| `service.type` | `string` | `"ClusterIP"` | Service type. |

## serviceAccount

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `serviceAccount.annotations` | `object` | `{}` | Annotations for the ServiceAccount. |
| `serviceAccount.create` | `bool` | `true` | Create a ServiceAccount for the pods. |
| `serviceAccount.name` | `string` | `""` | ServiceAccount name override. |

## slack

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `slack.botToken` | `string` | `""` | Slack bot token (`xoxb-…`): posts approval requests. |
| `slack.existingSecret` | `string` | `""` | Name of an existing Secret with keys `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN` (either may be absent). Slack reaches `/api/integrations/slack/interactions` through your Ingress; with `networkPolicy.restrictEgress`, add an `egressTo` rule for slack.com. |
| `slack.signingSecret` | `string` | `""` | Slack app signing secret: verifies approve/reject button clicks. |

## terminationGracePeriodSeconds

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `terminationGracePeriodSeconds` | `int` | `60` | Grace period so the SIGTERM handler can release poller leases and drain scheduled-query slots. |

## tolerations

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `tolerations` | `list` | `[]` | Tolerations for all pods. |

## topologySpreadConstraints

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `topologySpreadConstraints` | `list` | `[]` | Topology spread constraints for the web pods (postgres/HA installs). |
