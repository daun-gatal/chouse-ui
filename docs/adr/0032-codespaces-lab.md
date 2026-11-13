# 0032 — A Private Lab in the Visitor's Own GitHub Codespace

- **Status:** Accepted
- **Date:** 2026-11-13
- **Scope:** `.devcontainer/lab/` (new), `.github/workflows/lab.yml` (new), one job in `.github/workflows/auto-release.yml`, the README, the landing hero (`docs/portfolio/src/components/Hero.tsx`, `docs/portfolio/src/content/lab.ts`), the docs page *Try the lab*. No app code, env vars, config keys, Helm values or migrations. One PR, no release.

## Context

Until 2026-11-13 CHouse UI had a hosted, shared, read-only lab at
`lab.chouse-ui.com` (it never had an ADR). It was removed to stop paying for
and exposing hosted infrastructure. That left visitors no way to try the
product before installing it.

The owner asked for a button in the README that lets a visitor deploy CHouse
UI and "feel the journey completely", without anything hosted by the project.
Later in the same thread they added two requirements: the lab should be
filled across every part of CHouse UI so it looks realistic, and the change
must ship without a release.

### Goals

- One click from the README, the landing page or the docs gives a visitor a
  working CHouse UI with real ClickHouse data, where they are admin.
- Every area has something in it: Fleet, SQL workspace, Monitoring,
  Dashboards, Data, Alerts, Scheduled queries, Admin and Context.
- The in-app Getting Started guide is the journey. The visitor never has to
  change a bootstrap password or connect ClickHouse by hand.
- AI works with the visitor's own key, and the lab works fully without one.
- Nothing is hosted or paid for by the project. A broken lab is caught by CI
  before visitors see it.

### Non-goals

- A public, always-on URL, and any telemetry about visitors.
- Changing app code, which would need a changelog fragment and therefore a
  release.
- Several ClickHouse nodes, Helm or Kubernetes, and data that outlives the
  codespace.

## Decision

1. **The lab runs in the visitor's GitHub Codespace.** A badge in the README, a
   "Run your own lab" button in the landing hero and the *Try the lab* page
   link to
   `https://codespaces.new/daun-gatal/chouse-ui?devcontainer_path=.devcontainer%2Flab%2Fdevcontainer.json&quickstart=1`.
   The codespace is billed to the visitor's free quota. There are no prebuilds,
   so the owner pays nothing. GitHub stops an idle codespace and deletes it
   after the visitor's retention period. The link lives once in
   `docs/portfolio/src/content/lab.ts`, and a test fails if the README, the
   docs page or the devcontainer link anything else.

2. **One Compose stack runs everywhere.** `.devcontainer/lab/devcontainer.json`
   is an Ubuntu base image with docker-in-docker on a 2-CPU / 8 GB machine.
   It runs `up.sh` on every start and forwards port 5521 into the browser.
   `up.sh` starts `compose.yml`:
   - the **published** CHouse UI image (`CHOUSE_IMAGE`, default `:latest`);
   - ClickHouse `26.5-alpine`, memory-capped, with `part_log` on;
   - a `load` loop;
   - a one-shot `seed` service.

   The same script runs in CI and on any machine with Docker. `LAB_URL` covers
   a browser on another host.

3. **No fixed secrets.** On the first run `up.sh` writes a gitignored `.env`
   (mode 600) with random `JWT_SECRET`, `RBAC_ENCRYPTION_KEY`,
   `RBAC_ENCRYPTION_SALT`, admin password and ClickHouse password.
   - `compose.yml` has no defaults (`${VAR:?}`).
   - A random admin password also avoids the forced password change that
     `admin123!` triggers.
   - CORS is set to the lab's own origins, never `*`.
   - If a visitor makes the port public, nothing well-known is exposed.

4. **The loader drives the public HTTP API.** It runs on the Bun inside the
   CHouse UI image, so the lab pulls no extra image. It creates sample data in
   ClickHouse, logs in once, and registers the default connection. It
   completes first-run setup with the existing onboarding API, so the
   Getting Started guide opens on its chapters. It then adds example content
   for every area:
   - three teammates with built-in roles;
   - a data access policy that limits analysts to the sample databases;
   - saved queries;
   - three dashboard templates and a custom *Shop sales* dashboard;
   - a fleet alert rule;
   - a scheduled report, run once;
   - two data-health promises, one of which breaks on purpose (USD orders in
     an EUR shop) so there is an incident;
   - table context and a metric.

   Each step looks for its result by name first, so re-runs change nothing.
   Context the visitor has edited is never overwritten. AI and example-content
   steps are optional: a failure is shown as `WARN` and the lab still starts.

5. **AI uses the visitor's key.** `devcontainer.json` declares optional
   `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` Codespaces secrets. When one is
   present, the loader registers the provider, a base model (with an explicit
   context window) and a default model config. If a later call fails, the
   provider is deleted again. Keys go to the loader's environment only, never
   to `.env`.

6. **The load talks to ClickHouse directly.**
   - A cheap query every 5 s.
   - About 500 new orders every 30 s.
   - A planted slow query every 2 min.
   - A failing query every 10 min.

   All of it carries `lab:` log comments. It never goes through `/api/query`,
   which is rate limited and audited.

7. **CI starts the same stack and checks it** (`.github/workflows/lab.yml`). It
   runs:
   - on PRs that touch the lab, the Dockerfile or `packages/server/`, building
     the image from the PR when server code changed;
   - nightly against `:latest`;
   - from `auto-release.yml` against `v<version>-pre`, in parallel with the
     approval gate.

   It runs the loader's unit tests and type check, requires every loader step
   to pass, and runs the loader again, which must change nothing. Then the
   smoke check verifies:
   - login works, with no password change;
   - setup is complete;
   - exactly one connection exists;
   - a query through the API reads the sample rows;
   - analyst `maya` is refused `finance.payouts`;
   - the AI flag matches whether a key was given;
   - the example content exists;
   - the planted slow query reached `system.query_log`.

   The release job is informational: no job waits on it.

## Consequences

- Visitors get a full, private, admin copy in about 3 minutes, at no cost to
  the project. The trade-off is a GitHub account, a cold start, and an editor
  window around the app; `WELCOME.md` says the editor is only the host.
- The loader depends on the shapes of several internal API routes (auth,
  connections, onboarding, users, policies, saved queries, dashboards,
  alerting, scheduled queries, data health, context, AI providers). A server
  PR that breaks one fails the lab check on that PR, because the image is
  built from it.
- The owner gets no usage numbers. Problems come from the issue link printed
  on a failed start and from CI.
- The Codespaces path itself (port forwarding, the `app.github.dev` origin,
  the secrets prompt) can't run in CI. It needs a manual check when the lab
  changes.
- `.devcontainer/` is a hidden directory, which `check:contracts` skips. The
  lab's contracts are kept by hand.

### Follow-ups

- A product feature that provisions a connection (and optionally an AI
  provider) from config would replace most of the loader. It needs its own
  change and a release.
- Two app bugs were seen while validating, both outside this change:
  - The SPA requests `GET /api/rbac/connections?limit=1000` and gets a 400
    (the route allows at most 100).
  - The CSP blocks the Google Fonts stylesheet.

## Alternatives considered

- **Bring the hosted lab back.** Rejected: its hosting cost and exposure are
  why it was removed.
- **Google Cloud Shell, Killercoda, Gitpod/Ona, Play with Docker.** Rejected:
  Codespaces is the one every GitHub visitor already has, and the repo
  configures it. The others add accounts, tighter resources or an unstable
  free tier.
- **One-click cloud deploy buttons (Railway, Render).** Rejected as a lab: they
  bill the visitor and leave a real deployment to clean up.
- **A static demo with a mocked API, or a recorded tour.** Rejected: nothing
  real runs, and mocks drift from the app.
- **Provision connections from config instead of a loader.** Deferred: it is an
  app change, so it needs a release, and this change must ship without one.
- **Pin the image tag and bump it in the release workflow.** Rejected: the
  pre-release smoke run tests the image before it becomes `latest`, without
  adding a commit step to the release. `CHOUSE_IMAGE` overrides the tag.
- **A separate loader image.** Rejected: it adds an image pull to every cold
  start. The CHouse UI image already has Bun.
