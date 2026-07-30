# 0008 — Production Helm Chart and OCI Distribution

- **Status:** Accepted
- **Date:** 2026-07-30
- **Implementation:** same PR as this ADR (deliberate deviation from the usual
  two-PR flow — the chart is additive and touches no application code, so the
  spec and its implementation are reviewed together)

## Context

CHouse UI ships as a single container image (`ghcr.io/daun-gatal/chouse-ui`,
multi-arch, published by `auto-release.yml`), but the repo offers no supported
path onto Kubernetes: the only manifest in-tree deploys the marketing site, and
users hand-roll Deployments against an app whose topology rules are non-obvious
and easy to get wrong:

- **Two persistence modes.** RBAC state lives in SQLite (default,
  `/app/data/rbac.db`) or external PostgreSQL (`RBAC_POSTGRES_URL`). SQLite
  cannot span pods — every HA mechanism in the server (fleet-poller lease,
  scheduled-query per-job leases, DB-backed login rate limits) assumes a
  *shared* database. The server only logs an error for the broken
  SQLite-multi-replica combination; it does not refuse to start.
- **`CHOUSE_HA=true` is a chart contract.** `.env.example` and ADRs 0001/0002
  explicitly reserve this env var for "the Helm chart sets it when
  `replicas > 1`". Nothing sets it today.
- **Production hard-fails without three secrets** (`JWT_SECRET` ≥ 32 chars,
  `RBAC_ENCRYPTION_KEY` ≥ 32 chars, `RBAC_ENCRYPTION_SALT` exactly 64 hex
  chars). `RBAC_ENCRYPTION_KEY`/`SALT` protect stored ClickHouse connection
  passwords — losing them is unrecoverable data loss.
- **Health endpoints are already probe-shaped**: `/api/health` is
  dependency-free; `/api/rbac/health` returns 503 until the RBAC DB is healthy
  and migrations have applied (the server listens before RBAC init completes,
  so readiness on this endpoint correctly gates traffic during migrations).
  On PostgreSQL, boot-time migrations are serialized with `pg_advisory_lock`,
  so concurrent replica startup is safe.
- **Config is env vars or one YAML file** (`CHOUSE_CONFIG_PATH` → flattened
  into env by `configLoader.ts`), which a chart can exploit to avoid
  per-feature template sprawl.
- Operational sharp edges a chart must document or absorb: login rate limiting
  keys on `X-Forwarded-For` (ingress must overwrite it), AI chat uses
  long-lived SSE (default nginx-ingress 60s read timeout kills it), SSO needs
  the public base URL, and migrations 1.36/1.37 import legacy JSON files from
  `/app/data` exactly once.

We also want the chart distributed from the same place as the image, with the
same release ergonomics as the existing fragment-driven, approval-gated
`auto-release.yml` pipeline — and without introducing external services
(ArtifactHub, dedicated chart hosting) to operate.

## Decision

### One chart, `charts/chouse-ui/`, distributed as an OCI artifact on GHCR

`helm install chouse-ui oci://ghcr.io/daun-gatal/charts/chouse-ui --version <v>`.
No GitHub Pages Helm repo, no `index.yaml`, no ArtifactHub. Charts are pushed
signed (cosign keyless via GitHub OIDC) to the same registry namespace as the
app image. One one-time manual step after the first publish: set the
`charts/chouse-ui` GHCR package public and link it to the repo.

### Two topologies, enforced at render time

| | `database.type: sqlite` (default) | `database.type: postgres` |
|---|---|---|
| Replicas | exactly 1 (render **fails** if >1) | any; `CHOUSE_HA=true` injected when >1 |
| Storage | PVC at `/app/data`, `fsGroup: 1001` | none (stateless pods) |
| Strategy | `Recreate` | `RollingUpdate` |
| HPA / topologySpread | render fails / n.a. | allowed |

Failing the render is deliberate: the server's own runtime warning for
SQLite-multi-replica is easy to miss, and the resulting duplicate scheduled-job
runs and per-pod user databases are silent data corruption from the operator's
point of view.

### Secrets are never auto-generated

`JWT_SECRET`, `RBAC_ENCRYPTION_KEY`, `RBAC_ENCRYPTION_SALT` come from
`secrets.existingSecret` (recommended) or inline values; if absent, render
fails with the `openssl rand` generation commands in the error message. A
`lookup`-based auto-generate was rejected: silently minting the encryption key
that protects stored ClickHouse passwords turns a `helm uninstall`/reinstall
into unrecoverable loss of every stored connection credential.

### App config flows through one rendered YAML

A freeform `config:` values block renders into a Secret mounted at
`/etc/chouse/config.yaml` with `CHOUSE_CONFIG_PATH` pointing at it, riding the
existing config loader. SSO, fleet poller, doctor, admin seeding, CORS — all
express as values under `config:` without dedicated templates.
`extraEnv`/`extraEnvFrom` cover secret interpolation (e.g. SSO client
secrets). The chart renders this into a Secret (not a ConfigMap) because the
block routinely carries credentials.

### Probes and lifecycle

Liveness `GET /api/health`; readiness **and** startup `GET /api/rbac/health`
(startup probe with generous `failureThreshold` to absorb long upgrade
migrations); `terminationGracePeriodSeconds: 60` so the SIGTERM handler can
release poller leases and drain scheduled-query slots.

### Security defaults on

`runAsNonRoot` uid/gid 1001, seccomp `RuntimeDefault`, all capabilities
dropped, `readOnlyRootFilesystem: true` with an `emptyDir` on `/tmp`.

### Optional dedicated scheduler

`dedicatedScheduler.enabled` (postgres mode only) adds a 1-replica Deployment
with `SCHEDULED_QUERIES_ENABLED=true` while web pods get `false` — the exact
split `.env.example` describes.

### Non-goals

- No bundled PostgreSQL or ClickHouse subcharts. Operators bring their own
  (CloudNativePG / managed Postgres; Altinity or ClickHouse operator).
  Bundled-DB subcharts are a maintenance liability and contradict the README's
  own "external HA PostgreSQL" guidance.
- No ServiceMonitor — the app exposes no Prometheus endpoint today.

### CI: validation on PR, publishing on release — one implementation

- **`helm.yml` (PR gate):** `helm lint`, kubeconform against pinned K8s
  versions, helm-unittest for the guard/wiring logic, chart-testing installs
  on kind (SQLite default + HA-Postgres values), upgrade-from-latest-release
  test, `helm-docs --validate`, and a **chart-version-bump guard** (chart
  changes cannot merge without bumping `Chart.yaml` `version`).
- **Composite action `.github/actions/helm-publish`:** immutability guard
  (a published chart version is never overwritten; re-runs no-op when digests
  match), `helm package` + `helm push`, cosign keyless sign, pull-and-render
  smoke check, step summary.
- **`auto-release.yml` (primary path):** during `assemble`, `Chart.yaml`
  `appVersion` is synced to the new app version and the chart `version` patch
  is bumped *only if* the current chart version is already published (a
  pending manual bump is respected, never double-bumped). A new `helm` job
  runs after `docker` (image must exist before the chart referencing it),
  reuses the existing `docker-publish` environment gate, and publishes via the
  composite action. The release announcement gains a `helm install` snippet.
  The `helm` job is additive — `docker`/`publish` do not depend on it, so its
  failure cannot break an app release.
- **`helm-release.yml` (chart-only path):** `workflow_dispatch` from `main`
  with `dry_run` and `prerelease` (`<version>-pre` tag, previous `-pre`
  cleaned up) inputs, gated by a `helm-publish` environment, version read from
  `Chart.yaml` (the merged PR already declared it), finished with a
  `chart-v<version>` git tag.

### Versioning

Chart `version` is its own semver, bumped manually in the PR that changes the
chart (breaking values changes = major). `appVersion` is owned by
`auto-release.yml` and never edited by hand. `image.tag` defaults to
`v{{ .Chart.AppVersion }}`.

## Consequences

**Easier:** supported one-command Kubernetes install; broken topologies caught
at render time instead of as silent duplicate jobs; chart freshness guaranteed
by riding the app release train; agents know when to touch the chart via
`.rules/HELM_CHART.md`.

**Accepted costs:** chart maintenance is coupled to config-surface changes
(every new env var / config key is a chart PR too — enforced by rules + CI);
kind-based CI adds minutes to PRs touching `charts/**`; `auto-release.yml`
gains one step and one job in a live pipeline (mitigated by the additive
design and a post-merge dry-run dispatch); Helm 3.8+ is required of users
(OCI support).

## Alternatives considered

- **ArtifactHub + GitHub Pages Helm repo (chart-releaser):** more
  discoverability, but adds a `gh-pages` publishing branch, an external
  service to claim/maintain, and a second index to keep consistent. GHCR OCI
  reuses infrastructure the project already operates. Revisitable later —
  ArtifactHub can index an OCI repo without changing this design.
- **StatefulSet for SQLite mode:** semantically "stateful", but a
  single-replica Deployment with `Recreate` + PVC has identical behaviour with
  less machinery; volumeClaimTemplates only pay off at >1 replica, which
  SQLite forbids anyway.
- **Auto-generated secrets via `lookup`:** rejected (data-loss trap, see
  Decision).
- **Bundled Postgres subchart:** rejected (see Non-goals).
- **Raw manifests / Kustomize in-repo:** no values validation, no render-time
  guards, no versioned distribution — the guard rails are the point.
