# 0009 — Bundled Evaluation Databases in the Helm Chart

- **Status:** Accepted
- **Date:** 2026-07-30
- **Amends:** [0008](0008-helm-chart-and-oci-distribution.md) — replaces its
  "no bundled PostgreSQL or ClickHouse subcharts" non-goal. Everything else in
  0008 (topology guards, secret policy, OCI distribution, CI shape) stands.

## Context

ADR 0008 deliberately shipped no databases: operators bring their own
PostgreSQL, and ClickHouse belongs to the Altinity/ClickHouse operators. That
holds for production, but it leaves two real gaps:

- **Evaluation.** The SQLite default gets the UI running in one command, but
  CHouse UI is a ClickHouse client — with no ClickHouse to point at, a fresh
  install is a login screen and nothing else. Anyone demoing the product must
  first provision ClickHouse out-of-band. Likewise, evaluating the *HA* shape
  (PostgreSQL, multi-replica, leases) requires standing up PostgreSQL first.
- **Testing.** The kind jobs prove the chart installs and that
  `/api/rbac/health` turns green. They prove nothing about the app actually
  talking to ClickHouse, because no health endpoint touches it. The CI
  PostgreSQL is a slab of inline YAML in the workflow — real infrastructure
  the chart itself never exercises.

The counter-argument against bundling is not that it's useless, it's that the
usual *implementation* is a liability: a `dependencies:` entry on a
third-party chart (in practice Bitnami's) imports someone else's release
cadence, licensing decisions, and breaking changes into our pipeline. During
2025 the Bitnami catalog moved its maintained images behind a commercial
offering, leaving the free path on a frozen, unpatched repository and breaking
charts that depended on it. That is precisely the failure mode worth avoiding.

The other risk is social, not technical: a bundled database that *looks*
production-ready gets used in production, and then its data loss becomes the
chart's problem.

## Decision

Ship optional PostgreSQL and ClickHouse **as in-repo templates**, both
disabled by default, explicitly scoped to evaluation and CI.

### In-repo templates, never subchart dependencies

No `dependencies:` block, no external chart repository, no Bitnami. Two small
StatefulSets we own outright, pinned to upstream official images
(`postgres`, `clickhouse/clickhouse-server`). The cost is that we maintain
~120 lines of YAML; the benefit is that no third party can break, relicense,
or restructure our release pipeline. The chart stays dependency-free and
`helm install` needs no repo other than ours.

### Evaluation-scoped by construction, not just by documentation

- Both default to `enabled: false`.
- Persistence defaults **off** — a restart loses the data, which is the honest
  behaviour for a demo and makes silent production use uncomfortable rather
  than merely inadvisable.
- `NOTES.txt` prints a warning naming what is missing (backups, failover,
  upgrades) whenever either is enabled.
- Passwords are **required, never generated** — same rule as ADR 0008's
  application secrets. The chart refuses to render rather than inventing a
  credential.

### Wired, not merely present

Enabling bundled PostgreSQL sets `RBAC_POSTGRES_URL` from the generated
Secret; enabling bundled ClickHouse pre-fills `CLICKHOUSE_DEFAULT_URL` so the
connection form opens pointing at it. A user-supplied `config.clickhouse.*`
still wins, because config-file values override the pod environment by design.

### Guards, in the spirit of 0008

Render fails on the combinations that cannot work or that silently mean
something other than intended:

- `postgresql.enabled` with `database.type: sqlite` — the bundled database
  would run unused.
- `postgresql.enabled` together with `database.postgres.url` or
  `existingSecret` — two sources of truth for the same connection.
- Either bundled database with `persistence.enabled` and a `replicaCount`
  implying HA is *allowed* but warned about, since one pod is still one pod.

### CI is the primary consumer

The kind matrix drops its inline PostgreSQL YAML and uses the chart's own
bundled database, so the templates are exercised on every chart PR rather
than being untested surface area. A new end-to-end scenario enables both
databases and drives the real path — log in, create a connection, run a
query, assert the result — closing the gap where nothing verified ClickHouse
connectivity.

## Consequences

**Easier:** one-command demos including a working ClickHouse; HA evaluation
without provisioning PostgreSQL; genuine end-to-end coverage in CI; the CI
fixture and the shipped code are the same code.

**Accepted costs:** ~120 lines of database YAML to maintain and image tags to
keep current (Renovate-able); a larger values surface; and the standing risk
that someone runs an evaluation database in production despite defaults,
warnings, and disabled persistence — mitigated as far as a chart reasonably
can, and explicitly not supported.

**Unchanged:** production guidance still points at managed PostgreSQL or
CloudNativePG and at the ClickHouse operators. The bundled databases are a
convenience, not a recommendation.

## Alternatives considered

- **Bitnami subchart dependencies** — the conventional path; rejected over
  the 2025 catalog restructuring and the general principle of not importing a
  third party's release politics into our pipeline.
- **Keep 0008's non-goal; ship an `examples/` manifest instead** — zero
  maintenance, but leaves CI's ClickHouse gap open and keeps the demo path a
  copy-paste exercise. This was the prior recommendation; overridden in favour
  of the tested, wired-in version.
- **A separate `chouse-ui-demo` umbrella chart** — cleanly isolates demo
  concerns, but doubles the artifacts to publish, version, and sign for a
  feature two `enabled` flags express adequately.
- **Bundled databases enabled by default** — rejected outright; the
  production default must never be a database we don't stand behind.
