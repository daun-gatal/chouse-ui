# cli

## Overview

The `chouse` command-line client for CHouse UI: a standalone Go module (`github.com/daun-gatal/chouse-ui/cli`, Go 1.23, cobra) that operates a CHouse UI server from terminals, scripts, CI and AI agents using a personal access token (`ch_pat_…`). It versions and releases independently of the app: the version line lives in [`VERSION`](./VERSION) (tags `cli-vX`, fragments in `changelogs/cli/unreleased/`). User-facing docs: [`docs/cli.md`](../docs/cli.md).

## Subdirectories & Boundaries

- cmd: [./cmd/README.md](./cmd/README.md) - executable entry point (`cmd/chouse`): signal-aware context and `-ldflags` build metadata.
- internal: [./internal/README.md](./internal/README.md) - the command tree (`cli`) and its support packages `api`, `config`, `output`, `safety`.

## Cross-Package Contracts

- Exit codes for scripts and agents: 0 ok, 2 usage, 3 auth, 4 RBAC, 5 server, 6 network, 130 interrupted `[internal/api/client.go:ExitOK]`, `[internal/cli/app.go:ExitInterrupted]`.
- Safe by default: reads never prompt; mutations need `--yes` or a typed `yes` on a terminal and fail closed otherwise `[internal/safety/safety.go:RequireConfirm]`, `[internal/cli/app.go:Session.confirm]`.
- PATs come only from `--token`, `CH_HOUSE_PAT` or the `0600` credentials file, and are never printed by debug tracing `[internal/config/config.go:Resolve]`, `[internal/api/transport.go:debugTransport.RoundTrip]`.
- The command tree snapshot `docs/portfolio/src/content/reference/cli.json` feeds the generated CLI reference page and must be refreshed when commands or flags change.

## Verification

- Run: `cd cli && go test ./...`
- Release archives: `./scripts/build-cli.sh [version]` (from the repository root).
