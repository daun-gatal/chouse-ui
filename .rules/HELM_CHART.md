# Helm Chart Rules

When and how to update `charts/chouse-ui/` — the production Helm chart
(ADR 0008). The chart is a public, versioned artifact on
`oci://ghcr.io/daun-gatal/charts/chouse-ui`; published versions are immutable.

---

## When a code change requires a chart change (same PR)

If your change touches any of these, the chart **must** be updated in the same
PR — the chart is how Kubernetes users consume the change:

| Code change | Chart impact |
|---|---|
| New / renamed / removed env var or config key (you touched `.env.example` or `.config.example.yaml`) | `values.yaml` (+ comment), `values.schema.json`, env wiring in `templates/_helpers.tpl` or deployment templates if chart-managed; README regen. If the key is app-level and flows through `config:`, usually only docs — but check the managed-keys guard in `templates/_validate.tpl`. |
| Server port, health endpoint paths, or startup/readiness semantics (`packages/server/src/index.ts`, `packages/server/src/routes/index.ts`) | `probes` defaults, Service `targetPort`, helm test (`templates/tests/test-connection.yaml`). |
| New background service, scheduler, or lease | Assess HA: does it lease correctly across pods on PostgreSQL? Update `CHOUSE_HA` handling, `_validate.tpl` guards, or the dedicated-scheduler split. |
| New required production secret, or changed validation in `validateEnvironmentVariables()` | `secrets.*` values, `templates/secret.yaml`, matching render-time checks in `_validate.tpl` (chart guards mirror server guards). |
| `Dockerfile` changes: user/uid, port, `/app/data` layout, writable paths | `podSecurityContext` (uid/fsGroup), PVC mount, `readOnlyRootFilesystem` + `/tmp` emptyDir assumptions. |
| SQLite/PostgreSQL behavior or migration-locking changes | Topology guards in `_validate.tpl`, `Recreate`/`RollingUpdate` switch, startup probe budget. |

Not chart-relevant: pure frontend changes, refactors, anything that doesn't
alter the container's runtime contract.

## How to ship a chart change

1. **Bump `version` in `Chart.yaml`** — always, in the same PR (CI's
   version-guard blocks the merge otherwise). Semver: breaking values changes
   (renamed/removed keys, changed defaults that alter behavior) bump
   **major**; new values/features bump **minor**; fixes bump **patch**.
2. **Never edit `appVersion`** — `auto-release.yml` owns it.
3. **Never edit `charts/chouse-ui/README.md` directly** — it is generated.
   Edit `README.md.gotmpl` or the `# --` comments in `values.yaml`, then run
   `helm-docs --chart-search-root charts/chouse-ui`.
4. **Keep `values.schema.json` in sync** with any values change.
5. **Add/adjust a helm-unittest case** (`charts/chouse-ui/tests/`) for any
   template logic with branches — guards, mode switches, secret wiring. Run:
   `helm unittest charts/chouse-ui`.
6. New topology or mode? Add a `ci/<scenario>-values.yaml` and extend the
   kind matrix in `.github/workflows/helm.yml`.
7. **Update `artifacthub.io/changes`** in `Chart.yaml`'s annotations — it is
   rendered per version on artifacthub.io. Don't touch
   `artifacthub.io/images` (auto-synced with `appVersion` by
   `auto-release.yml`) or `artifacthub-repo.yml` (the `repositoryID` is the
   ArtifactHub ownership claim; pushed automatically on publish).
7. Verify locally before pushing:
   `helm lint charts/chouse-ui --strict --values charts/chouse-ui/ci/default-values.yaml`
   and `helm unittest charts/chouse-ui`.

## Publishing (for context — you don't do this in a PR)

- App releases publish the chart automatically (`helm` job in
  `auto-release.yml`; `assemble` syncs `appVersion` and auto-bumps the chart
  patch version only when the current version is already published).
- Chart-only fixes ship via the `Helm Release` workflow
  (`helm-release.yml`, workflow_dispatch from `preview`; supports `dry_run`
  and `prerelease`).
- Publish logic lives once, in `.github/actions/helm-publish/action.yml`.

## Hard don'ts

- **Never auto-generate secrets** in templates (no `lookup`/`randAlphaNum`
  for `JWT_SECRET` / `RBAC_ENCRYPTION_KEY` / `RBAC_ENCRYPTION_SALT`) — a
  regenerated encryption key makes every stored ClickHouse password
  unrecoverable. Render-time `fail` with generation instructions is the
  policy.
- **Never weaken the topology guards** in `_validate.tpl` (sqlite ×
  replicas>1 / HPA / dedicated scheduler) — they exist because the server
  only warns at runtime while data silently diverges per pod.
- **No bundled database subcharts** (PostgreSQL, ClickHouse) — ADR 0008
  non-goal.
- **Don't add anything to `selectorLabels`** — selectors are immutable on
  Deployments; changing them breaks every existing install's upgrade.
- A chart change is user-visible: add a `changelogs/unreleased/` fragment
  like any other feature/fix.
