# 0012 — CHouse CLI: Safe Browserless Operations with Go Binary Distribution

- **Status:** Proposed
- **Date:** 2026-09-12
- **Builds on:** [0011](0011-personal-access-tokens.md) (PAT machine auth), [0010](0010-pod-local-state-and-multi-replica-correctness.md) (fail-closed, no silent substitution), [0008](0008-helm-chart-and-oci-distribution.md) (OCI distribution posture)

## Context

CHouse UI is operated through the browser today. ADR 0011 reserved a machine
credential (`ch_pat_…`, env `CH_HOUSE_PAT`) and made every data-plane and RBAC
route PAT-capable through a single `verifyBearer()` choke point, with a
privilege fence (PAT cannot mint/rotate tokens, change passwords, or touch
sessions). No CLI exists yet (`cli/` absent, no `bin` field, no binary
installer; releases are manual `workflow_dispatch` → Docker + Helm OCI only).

Forces shaping this decision:

1. **Agentic era:** shell scripts, CI jobs, and AI agents need non-interactive,
   pipeable access (`--output json`, stable exit codes, stdin) without browser
   session state or refresh dances.
2. **Safety:** the CLI must not become a privilege-escalation path. A leaked
   workstation PAT must not mint new tokens, rotate secrets, or silently
   substitute connections (ADR 0010).
3. **Distribution:** users asked for `curl | bash` installs of versioned
   binaries from GitHub Releases. CI today is `ubuntu-latest` only (Bun), with
   no Go toolchain and no binary signing for app artifacts (cosign exists only
   for Helm OCI).
4. **Scope control:** full API parity (~12 domains incl. SSO/AI-provider
   secrets, user/role grants, native ClickHouse DDL) is too large and too
   risky for v1. The CLI must cover daily operations without a browser while
   leaving break-glass admin in the UI.

## Decision

### 1. Go CLI in `cli/` (own `go.mod`), PAT-only auth

- New top-level `cli/` module (`github.com/daun-gatal/chouse-ui/cli`),
  `cobra + viper`-style flags, `yaml.v3` for profiles. Isolated from the Bun
  monorepo so app Docker/Helm builds are unaffected.
- Auth is PAT-only: `Authorization: Bearer ch_pat_…`. Precedence
  `--token > CH_HOUSE_PAT > ~/.config/chouse/credentials.yaml (0600) >
  --profile`. `--server`: flag > `CHOUSE_SERVER` > profile. `--connection`:
  flag > `CHOUSE_CONNECTION` > server default via `X-Connection-Id`.
- Initial PAT is minted once in the UI, then `chouse auth login --token …`
  stores it locally. The CLI never calls PAT-fenced endpoints
  (`/rbac/pats*`, `change-password`, `login/refresh`, `logout*`).
- No `X-Requested-With`, never send legacy `X-Session-ID` (always `409`).

### 2. Operator-complete scope, not full parity

IN v1: `status`, `auth whoami`, `connection list|get|test|use`,
`query` (typed `table/select` + `explain` first, `--raw` for explicit SQL),
`table list|schema|sample`, `saved-*`, `metrics/*`, `logs`, `live list|kill`,
`fleet snapshots|history|query`, `doctor scan|reports|schedule`,
`scheduled-*` (with `preview` + `recovery{execute:false}` first),
`data-health` (with `preview|backtest|diagnostics` first),
`alert channels|rules|events|test`, `ai optimize|capabilities|models`,
`upload preview|into`, `audit list|export`, `completion`, `version`.

OUT v1 (CLI errors with UI hint): SSO admin, AI provider/model secrets,
user/role mutating + role assignment, data-access policy writes,
ClickHouse native user/role writes (reads + `generate-ddl` preview allowed),
connection create/delete, fleet `alert-config` writes, `audit` prune.

### 3. Safe-by-default (confirmed)

- Read-only commands never prompt. Mutations require TTY confirm and `--yes`
  in non-TTY/CI. Destructive commands (`DROP/TRUNCATE`, `KILL`, `upload
  into`, `run-now/rerun`, deletes) require `--yes` plus a `--dry-run` preview
  where the server offers one (`explain`, `ddl/simulate`, `*/preview`,
  `generate-ddl`, `upload preview`, `recovery{execute:false}`).
- `doctor scan` warns about LLM cost. Every mutation prints action, target,
  required permission, and audit correlation. PAT display is `keyPrefix`
  only; `--debug` masks secrets.
- Machine contract: `--output table|json|yaml|csv`, `--quiet`, stdin
  (`-f -`), no spinners when piped, exit codes `0 ok / 2 usage / 3 auth /
  4 RBAC / 5 server / 6 network`, `429` backoff honoring `Retry-After`.

### 4. Distribution: independent version line, own `cli-vX` tags and flow

- The CLI versions independently from the app: `cli/VERSION`, fragments in
  `changelogs/cli/unreleased/`, tags `cli-vX`. The app release never touches
  these paths and vice versa — a release is cut only when `cli/` itself
  changed since the last `cli-v` tag (enforced in the workflow, mirroring the
  assemble code-change gate).
- `cli-release.yml` (manual dispatch, mirroring `helm-release.yml` +
  `auto-release.yml` conventions): `plan` resolves the branch (default
  `preview`, `main` forbidden), computes the version via
  `scripts/release-cli.ts` (fragment max-bump or manual override), and checks
  the change gate; `publish` (environment `cli-publish`) builds first via
  `scripts/build-cli.sh` — so a red tree never gets a version commit — then
  runs `release-cli.ts` for real (bumps `cli/VERSION`, writes
  `CLI_RELEASE_NOTES.md`, deletes fragments), commits to the branch, tags
  `cli-vX` (stable only; `-pre` prereleases carry no git tag), cosign
  `sign-blob`s each archive keyless, and creates the GitHub Release with
  archives + `checksums.txt` + signatures + `install-cli.sh`.
- `dry_run` plans without publishing; `prerelease: true` overwrites the
  `cli-vX-pre` prerelease (same delete-first pattern as the `-pre` image and
  chart). Non-`preview` branches plan only (throwaway).
- The single build definition is `scripts/build-cli.sh` (explicit `go build`
  matrix `linux/darwin/windows × amd64/arm64` + tar/zip + sha256, ldflags
  version/commit/date — auditable like the other release scripts). PR
  validation in `cli.yml` runs vet, `go test -race`, the same script as a
  snapshot, and installer lint/smoke.
- Installer `scripts/install-cli.sh` (`set -eu`): resolves `latest` against
  `cli-v*` releases (never `releases/latest`, which follows the app),
  honors `CHOUSE_VERSION`, verifies sha256, installs to `/usr/local/bin`
  with `~/.local/bin` fallback, warns when off `PATH`.
- DinD note (verified 2026-09-12): `DOCKER_HOST=tcp://opencode-dind:2375`
  works, but `opencode-dind-apps:5432/5521/5173` refuses from the agent pod —
  published ports live on the DinD host. CLI e2e must use a sidecar
  (`docker run --network <compose>_default`, `http://chouse-ui:5521`) like
  `scripts/e2e-pat.sh`, never `localhost` from the pod.

## Consequences

- Operators and agents get browserless daily workflows with one env var and
  pipeable JSON, inheriting the same live permissions, data-access policies,
  rate limits, and audit trail as the UI (with `patId` attribution).
- Leaked PATs cannot self-propagate (fence) and lose power on
  demotion/deactivation/revoke on the next request — no TTL lag.
- Break-glass admin (SSO keys, AI keys, grants, connection secrets, audit
  prune) stays in the browser, shrinking the CLI blast radius.
- New maintenance: Go module + Renovate `gomod`, `scripts/build-cli.sh`
  matrix, installer e2e on ubuntu/macos runners. App Docker/Helm flows keep
  their gates; the CLI only adds jobs that can never block them.

## Alternatives considered

- **`bun build --compile` TS CLI** — rejected: reuses API types but ships a
  80–150 MB runtime bundle with native-dep (`sqlite`) target risk; Go gives
  small static binaries ideal for `curl|bash`.
- **Full API parity v1** — rejected: doubles scope and ships secret/grant
  surfaces (`sso-admin`, `ai-providers`, `users/roles`, native DDL) that are
  safer behind UI review.
- **Read-only v1** — rejected: too weak; operators still need the browser for
  routine `run-now`, `kill`, `ack`, and `upload` tasks this ADR includes
  behind guards.
- **Same version/tags/gates as the app release** — rejected: it would cut
  CLI versions on app-only stretches (or strand CLI fixes until the next app
  release) and mix two cadences into one tag namespace. The CLI follows the
  *pattern* of `auto-release.yml` (fragments → plan → gated publish →
  `-pre` handling) on its own line instead.
- **npm `bin` / Docker-only distribution** — rejected as primary: npm still
  needs a runtime and Docker is heavy for shell/CI agents; kept as Phase 2
  options alongside brew tap and deb/rpm.
