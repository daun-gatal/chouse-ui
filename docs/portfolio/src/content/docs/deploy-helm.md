# Helm chart

The `chouse-ui` Helm chart is published to GHCR as a signed OCI artifact. This page covers installing and running it; every value is listed on [Helm values reference](/docs/helm-values/).

## Install

```bash
helm install chouse-ui oci://ghcr.io/daun-gatal/charts/chouse-ui \
  --set secrets.jwtSecret="$(openssl rand -base64 32)" \
  --set secrets.encryptionKey="$(openssl rand -hex 32)" \
  --set secrets.encryptionSalt="$(openssl rand -hex 32)"

kubectl port-forward svc/chouse-ui 5521:80
```

Sign in at `http://localhost:5521` as `admin@localhost` / `admin123!` and change the password right away ([First login](/docs/first-login/)).

> **Warning:** Keep the three secrets. `encryptionKey` and `encryptionSalt` protect every stored ClickHouse password; if they change, those credentials can't be recovered. For real installs, create a Secret with the keys `JWT_SECRET`, `RBAC_ENCRYPTION_KEY` and `RBAC_ENCRYPTION_SALT`, and pass `secrets.existingSecret`.

## Choose a topology

| | SQLite (default) | PostgreSQL |
| --- | --- | --- |
| Replicas | Exactly 1 — the chart refuses to render more | Any; the chart sets `CHOUSE_HA=true` when there is more than one |
| State | A PVC at `/app/data`, kept on uninstall | Your PostgreSQL; pods are stateless |
| Rollouts | `Recreate` (brief downtime) | `RollingUpdate`, autoscaling, PodDisruptionBudget, spread constraints |
| Good for | One team, evaluation | Production, high availability |

```yaml
# values-ha.yaml
replicaCount: 3
database:
  type: postgres
  postgres:
    existingSecret: chouse-postgres   # key RBAC_POSTGRES_URL
secrets:
  existingSecret: chouse-secrets
pdb:
  enabled: true
```

The chart deliberately bundles no PostgreSQL or ClickHouse for production — bring your own (a managed PostgreSQL or CloudNativePG, and your ClickHouse clusters). Migrations run when a pod starts and are safe when several replicas start at once.

## Try it with everything included

For evaluation only, the chart can also start a PostgreSQL and a single-node ClickHouse next to the app, so nothing external is needed. These have no backups or failover and don't persist by default. See *Trying it out with everything included* in the [chart README](https://github.com/daun-gatal/chouse-ui/blob/main/charts/chouse-ui/README.md).

## Configure the app

Everything the server reads — SSO, CORS, log level, collector settings, admin seeding — goes under the free-form `config:` value. The chart renders it to a `config.yaml` in a Secret, loaded through `CHOUSE_CONFIG_PATH`, so every key on [Environment variables](/docs/configuration-env/) and [YAML configuration](/docs/configuration-yaml/) works there:

```yaml
config:
  cors_origin: "https://chouse.example.com"
  auth:
    sso:
      enabled: true
      base_url: https://chouse.example.com
```

Keep secrets such as SSO client secrets out of `config:`; pass them through `secrets.*` or an existing Secret.

## Data observability, fixes and Slack

The collector needs no values. Optional values tune it and enable Slack approvals for [fixes](/docs/data-incidents/#approve-from-slack):

| Value | Sets |
| --- | --- |
| `observability.*` | Fleet interval, evidence retention, tracked query shapes and the scratch database (`OBSERVE_*`) |
| `remediation.maintenanceWindow` | `REMEDIATION_MAINTENANCE_WINDOW` |
| `remediation.slackChannel` | `REMEDIATION_SLACK_CHANNEL` |
| `slack.signingSecret`, `slack.botToken` (or `slack.existingSecret`) | `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN` |
| `publicBaseUrl` | `PUBLIC_BASE_URL` — links in Slack messages, and the default MCP address |

## MCP

There are no MCP values. The [MCP endpoint](/docs/mcp/) is served at `/mcp` on the same Service, Ingress and TLS as the UI; an administrator turns it on in **AI Governance › MCP**.

## Ingress

Set `ingress.enabled: true` and the `ingress.*` values (`className`, `annotations`, `hosts`, `tls`). Two things matter:

- AI chat and MCP stream responses (server-sent events). Raise the proxy read timeout and turn off response buffering:

  ```yaml
  ingress:
    annotations:
      nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
      nginx.ingress.kubernetes.io/proxy-buffering: "off"
  ```

- Sign-in rate limiting keys on `X-Forwarded-For`. The ingress must set it to the real client IP, or all users share one limit and spoofed headers bypass it.

## Upgrade

```bash
helm upgrade chouse-ui oci://ghcr.io/daun-gatal/charts/chouse-ui --reuse-values
kubectl logs deploy/chouse-ui | grep RBAC     # migrations
```

The startup probe allows five minutes so long migrations aren't killed. Read [What's new](/docs/whats-new/) before upgrading across a release.

> **Upgrading to chart 2.0:** the `mcp.*` values, port 8752, the `<release>-mcp` Service and the MCP Ingress are gone. Leftover `mcp:` values are ignored, with a warning in the install notes. Turn MCP on in **AI Governance › MCP** and point agents at `https://<host>/mcp`.

## Move from Docker Compose

Move to PostgreSQL *before* moving to Kubernetes, or copy your existing `data/` directory into the release's PVC: it holds your SQLite database and the legacy alert and Doctor schedule files that are imported once.

## Check it's healthy

```bash
kubectl get pods -l app.kubernetes.io/instance=chouse-ui
kubectl port-forward svc/chouse-ui 5521:80 & curl -s localhost:5521/api/health
```
