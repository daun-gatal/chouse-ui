# Pre-PR Gate

The checklist every coding agent passes **before** running `gh pr create`. A PR is
only raised once every applicable step passes. If a step cannot be run, say so in
the PR's *Testing* section along with the reason; never mark it as passed.

Each step names the rule file that owns the details. This page decides the order
and says what "done" means.

---

## 1. Branch and scope

- [ ] The branch was cut from an up-to-date `preview` (`git fetch && git switch -c <type>/<slug> origin/preview`).
- [ ] The PR targets **`preview`** (`gh pr create --base preview`), never `main`.
- [ ] The branch name uses a prefix from [CONTRIBUTING.md](../CONTRIBUTING.md#getting-started) (`feat/`, `fix/`, `docs/`, `refactor/`, `chore/`, `test/`, `perf/`).
- [ ] Batched requests from one thread ship as **one PR**. Unrelated work goes in
      its own PR.
- [ ] `git status` is clean apart from the intended changes. Nothing from `.egm/`,
      no scratch files, no stray `bun.lock` rewrite (`git checkout bun.lock` unless
      a dependency changed on purpose), and no generated files edited by hand
      (`CHANGELOG.md`, the chart `README.md`, generated docs pages).

## 2. Obligations triggered by what changed

| If the diff touches… | Then, in this PR… | Rule |
|---|---|---|
| Anything user-visible | Add a fragment `changelogs/unreleased/<pr>-<slug>.md`, with `type:` and `### Added/Changed/Fixed/Removed` | [AGENTS.md](../AGENTS.md#versioning--releases) |
| A `minor` / `major` fragment | Update the release banner (`docs/portfolio/src/content/release.ts`) and *What's new* (`whats-new.md`) | [RELEASE_NOTES.md](RELEASE_NOTES.md) |
| `packages/server/src/rbac/db/migrations.ts` | Add a `VERSION_CHECKS` entry plus data-migration tests, then run `./scripts/test-migrations.sh` on SQLite **and** PostgreSQL | [AGENTS.md](../AGENTS.md#database-migrations--testing-is-mandatory) |
| `charts/`, env vars, config keys, ports, health endpoints, the Dockerfile, background services | Make the chart change and bump `Chart.yaml` `version` (never `appVersion`) | [HELM_CHART.md](HELM_CHART.md) |
| Auth, RBAC or data access, SQL building or parsing, CORS or redirects, outbound requests, secrets, AI tools, dependencies | Work through the security review checklist | [SECURITY.md](SECURITY.md) |
| A new env var or config key | Add it to `docs/portfolio/src/content/reference/config-keys.ts` (`gen-reference.ts --check` fails otherwise) | [RELEASE_NOTES.md](RELEASE_NOTES.md) |
| A big, multi-component decision | Have an `Accepted` ADR, or ship the ADR first | [ADR.md](ADR.md), [EGM.md](EGM.md) |
| Code in a directory with a `README.md` contract | Update the contract wherever exports, invariants, side effects or verification changed, and add a contract for each new code directory | [EGM.md](EGM.md#directory-contracts) |
| User-visible behaviour | Update the docs site pages under `docs/portfolio` | [CODE_CHANGES.md](CODE_CHANGES.md#documentation) |

Skip the changelog fragment only for changes that aren't user-visible: refactors,
CI, tests, and docs-only changes.

## 3. Tests for the change

- [ ] New or changed logic in `src/api`, `src/hooks`, `src/lib`, `src/helpers`,
      `src/stores`, `src/utils` and every server module has co-located tests
      ([CODE_CHANGES.md](CODE_CHANGES.md#testing)).
- [ ] Bug fixes come with a test that fails without the fix.
- [ ] Every test you added or changed has been seen to pass. Report any test that
      was skipped, and why.

## 4. The full gate

Run from the repository root and fix every failure before going on:

```bash
bun run lint
bun run typecheck && (cd packages/server && bun run typecheck)
bunx vitest run
./scripts/test-isolated-server.sh
bun run build
bun run check:contracts
```

All of these run together, in order, as `./scripts/verify-all.sh` (gates 1–6,
including migrations). Add `FULL=1` for the Docker e2e suites when the change
touches clusters, MCP, PATs, the CLI, observability or Helm.

Also run:

- **Docs site changes:** `cd docs/portfolio && bun scripts/gen-reference.ts --check && bun run build`
- **CLI changes:** `cd cli && go test ./...`
- **Chart changes:** `helm lint charts/chouse-ui --strict --values charts/chouse-ui/ci/default-values.yaml && helm unittest charts/chouse-ui`

## 5. Behaviour in the real app

- [ ] **UI changes:** use the change in a real browser against the dev stack
      (`bun run dev`) at desktop and narrow widths. Cover the empty, loading,
      error and permission-denied states, and long text. Attach screenshots to
      the PR.
- [ ] **API changes:** call the route as a user who has the permission and as one
      who doesn't, and confirm the denial status code and the audit entry.
- [ ] **ClickHouse-facing changes:** run against a real ClickHouse (see
      `docker-compose.yml`), not only mocks.

## 6. Edge cases

Write out the edge-case list for the change and check each item. At minimum,
cover the items that apply:

- [ ] Empty, null and maximum-size inputs, Unicode and quoting in identifiers and strings.
- [ ] Permission boundaries: no permission, read-only, admin, PAT/MCP caller,
      and SSO user.
- [ ] Multi-replica behaviour: no pod-local state, leases on a shared DB, SQLite vs
      PostgreSQL ([ADR 0010](../docs/adr/0010-pod-local-state-and-multi-replica-correctness.md)).
- [ ] Failure paths: ClickHouse unreachable, timeouts, partial failures, retries,
      and idempotency.
- [ ] Upgrade path: existing data and settings survive, and migrations re-run cleanly.

## 7. Self-review

- [ ] Review the full diff against [CODE_REVIEWER.md](CODE_REVIEWER.md) as if
      someone else wrote it.
- [ ] Remove dead code, unused imports and leftover exports
      ([DEAD_CODE.md](DEAD_CODE.md)).
- [ ] No secrets, tokens or PII appear in code, logs, fixtures or screenshots.
- [ ] Commit messages explain *why*. Use one commit per logical step.

## 8. The PR itself

- [ ] Use `.github/pull_request_template.md` as the body and fill in every
      section. In *Testing*, list the exact commands and results from steps 3–6,
      plus anything that could not be run and why.
- [ ] Link the ADR or issue, and list follow-ups you found but left out of scope.
- [ ] After pushing, watch CI and fix any red check before asking for review.
