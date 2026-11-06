# scripts

## Overview

Repository automation run from the repository root: release helpers for the app and the CLI, CLI build and install, isolated test runners, Docker-backed end-to-end suites, the docs screenshot capture, and the all-gates verifier. The scripts are standalone entry points (bash, Bun/TypeScript, Python, Node) that import nothing from each other except where a `.sh` runs its `-check.py` or `.mjs` companion, a compose override, or the CLI runner Dockerfile.

## Interface

- Releases:
  - `[release.ts]` - app release: assembles `changelogs/unreleased/*.md` into `CHANGELOG.md`, bumps `version` in the root, `packages/server` and `docs/portfolio` `package.json` files, deletes the fragments. Bump type is the highest `major|minor|patch` among fragments, or an explicit version argument.
  - `[release-cli.ts]` - CLI release: `bun run scripts/release-cli.ts [overrideVersion] [--dry-run]`; bumps `cli/VERSION`, writes `CLI_RELEASE_NOTES.md`, deletes `changelogs/cli/unreleased/` fragments. `--dry-run` only prints the computed version.
- CLI distribution:
  - `[build-cli.sh]` - `./scripts/build-cli.sh [version]` cross-compiles `./cmd/chouse` (`CGO_ENABLED=0`, `-trimpath`) into `cli/dist/chouse-cli_<os>_<arch>.{tar.gz,zip}` plus `cli/dist/checksums.txt` (it `cd`s into `cli/` first), embedding version/commit/date via `-ldflags -X main.*`.
  - `[install-cli.sh]` - `curl … | bash` installer: resolves the latest `cli-v*` GitHub release (or `CHOUSE_VERSION`), verifies the SHA-256 checksum, installs to `INSTALL_DIR` (default `/usr/local/bin` or `~/.chouse/bin`) and, unless `CHOUSE_NO_MODIFY_PATH=1`, adds it to `PATH` in shell rc files.
- Tests:
  - `[test-isolated-server.sh]` - runs each server test file in its own `bun test` process so mocks cannot leak between files.
  - `[test-migrations.sh]` - runs `packages/server/src/rbac/db/migrations.test.ts` on SQLite and PostgreSQL (throwaway Docker container; Docker required).
  - `[verify-all.sh]` - ADR 0016 gates in order, stopping at the first failure: install, lint, types and contracts, frontend tests, and more; `FULL=1` adds the Docker e2e gates.
  - `[check-contracts.ts:checkContracts]` - `bun run check:contracts`: validates the directory contracts (every code directory outside `.egmignore` has a `README.md`; required sections; relative links; every cited `[file:symbol]` exists; verification commands target paths that have tests) and `ARCHITECTURE.md`. Exits 1 on any problem. Pure helpers (`parseIgnore`, `extractLinks`, `extractCitations`, `extractTestTargets`) are covered by `check-contracts.test.ts`.
- Docker e2e suites (each a `.sh` driver plus an in-network checker):
  - `[e2e-pat.sh]` + `e2e-pat-check.py` + `e2e-pat.override.yml` - personal access tokens (ADR 0011).
  - `[e2e-cli.sh]` + `e2e-cli-check.py` + `e2e-cli-output-check.py` + `e2e-cli-runner.Dockerfile` - the real `chouse` binary against a server and ClickHouse (ADR 0012), plus the output-style matrix (ADR 0018).
  - `[e2e-mcp.sh]` + `e2e-mcp-check.py` + `e2e-mcp.override.yml` - the MCP server (ADR 0013 / ADR 0017).
  - `[e2e-observe.sh]` - data observability platform suites (ADR 0016); `KEEP=1` leaves the testbed up.
  - `[e2e-scheduled-cluster.sh]` - cluster-aware scheduled-query materialize (ADR 0015).
  - `[e2e-oncluster-ddl.sh]` - `ON CLUSTER` DDL regression (issue #336).
- Docs and demos:
  - `[docs-screenshots.sh]` + `docs-screenshots.mjs` - builds the server image from the working tree, seeds a demo workload, and captures the docs screenshots with Playwright inside the compose network into `docs/portfolio/public/docs/img/app/`.
  - `[demo-parts-pressure.sh]` - generates a "too many parts" scenario in a local ClickHouse dev container for the Parts Pressure tab.

## Invariants

- Never run `release.ts` or `release-cli.ts` by hand except in an emergency: releases are driven by `auto-release.yml` and `cli-release.yml` (see `AGENTS.md`). `release.ts` skips `.gitkeep` and `README.md` in the fragments directory `[release.ts:SKIP_FILES]`.
- `release.ts` keeps all three `package.json` versions in lockstep `[release.ts:PACKAGE_JSON_PATHS]`.
- The release-cli dry run writes no files `[release-cli.ts]`.
- DinD-aware suites never talk to `localhost`: checkers run inside the compose network via `docker run --network <project>_default`, and the override files drop host bind mounts that would resolve on the Docker host `[e2e-pat.sh]`, `[e2e-pat.override.yml]`.
- Compose-based suites and the screenshot capture tear their stack down with `down -v` on exit `[e2e-cli.sh:cleanup]`, `[e2e-pat.sh:cleanup]`, `[docs-screenshots.sh:cleanup]`; `e2e-scheduled-cluster.sh` only creates and removes `sqe2e-*` containers and `sqe2e-net` `[e2e-scheduled-cluster.sh:cleanup]`.
- `install-cli.sh` refuses to install when the checksum does not verify or no `sha256sum`/`shasum` exists `[install-cli.sh]`.

## Side Effects

- `release.ts` writes `CHANGELOG.md` and three `package.json` files and deletes fragments; `release-cli.ts` writes `cli/VERSION` and `CLI_RELEASE_NOTES.md` and deletes CLI fragments.
- `build-cli.sh` deletes `$OUTDIR` (`rm -rf`, default `dist`, relative to `cli/`, so `cli/dist`) and then writes archives and checksums into it.
- `install-cli.sh` downloads from GitHub, writes the binary into the install directory, and may edit shell rc files.
- e2e suites, `test-migrations.sh`, `docs-screenshots.sh` and `demo-parts-pressure.sh` create and remove Docker containers, networks and volumes (honouring `DOCKER_HOST`); `docs-screenshots.sh` overwrites the JPEGs in `docs/portfolio/public/docs/img/app/`.

## Verification

- Run: `bunx vitest run scripts` (unit tests for `check-contracts.ts`), then `bun run check:contracts`.
- The other scripts have no unit tests. Exercise them through their entry points:
  - `./scripts/test-isolated-server.sh` (server tests), `./scripts/test-migrations.sh` (needs Docker)
  - `./scripts/verify-all.sh` (gates 1-6) or `FULL=1 ./scripts/verify-all.sh`
  - `bun run scripts/release-cli.ts --dry-run`
