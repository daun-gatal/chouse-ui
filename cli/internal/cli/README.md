# cli

## Overview

Package `cli` implements the `chouse` cobra command tree. Every command returns an error instead of exiting; `Run` maps errors to the exit-code contract in one place, so commands run in-process for tests and deferred cleanup always runs. Commands are thin wrappers that resolve config (`internal/config`), call the server (`internal/api`), gate mutations (`internal/safety`) and render results (`internal/output`).

## Interface

- `[app.go:Run]` - `Run(ctx, args, streams, version, commit, date) int`: builds the tree, executes, returns the exit code.
- `[root.go:NewRoot]` - builds the command tree on process streams (docs generation, tree-inspection tests).
- `[app.go:Streams]` / `[app.go:StdStreams]` - stdin/stdout/stderr plus `InTTY`/`OutTTY`.
- `[app.go:App]`, `[app.go:Session]`, `[app.go:ExitError]`, `[app.go:ExitInterrupted]` (130).
- Global flags `[root.go:App.newRoot]`: `--server`, `--token`, `--profile`, `-c/--connection`, `-o/--output`, `--no-headers`, `--wide`, `-q/--quiet`, `--timeout`, `--yes`, `--dry-run`, `--ca-cert`, `--insecure-skip-tls-verify`, `--debug`.
- Command groups `[root.go:App.newRoot]`:
  - Getting started: `status`, `auth`, `config`, `connection`, `version` (`status.go`, `auth.go`, `config_cmd.go`, `connection.go`).
  - Query and explore: `query`, `table`, `saved`, `upload` (`query.go`, `explorer.go`, `saved.go`, `upload_audit.go`).
  - Operate: `metrics`, `logs`, `live`, `fleet`, `perf`, `capacity`, `upgrades`, `collectors`, `dashboard`, `scheduled`, `alert`, `audit` (`metrics.go`, `fleet.go`, `governance.go`, `dashboard.go`, `scheduled.go`, `alert_ai.go`, `upload_audit.go`).
  - Data observability: `health`, `lineage`, `incidents`, `remediation`, `context`, `notebook` (`scheduled.go`, `observe.go`, `governance.go`).
  - AI and agents: `ai`, `action`, `doctor`, `agents`, `mcp` (`alert_ai.go`, `action.go`, `fleet.go`, `mcp.go`).

## Invariants

- Group commands with subcommands fail with a usage error on an unknown subcommand instead of printing help and exiting 0 `[root.go:strictGroups]`.
- Error mapping: `context.Canceled` -> 130, `*ExitError` -> its code, `*api.Error` -> `api.Error.ExitCode()` (with request id and hint on stderr), deadline -> network exit code `[app.go:App.report]`.
- Every server-bound action requires a server (else usage exit 2); authenticated actions also require a PAT (else auth exit 3) `[app.go:App.action]`.
- `-c` accepts a connection name: non-UUID values are resolved against `/api/rbac/connections/my`; zero or multiple matches are usage errors `[app.go:Session.resolveConnection]`.
- Mutations pass through `Session.confirm` (`--yes` or a typed `yes` on a TTY; fail closed otherwise) `[app.go:Session.confirm]`.
- Mutations without a server-side preview reject `--dry-run`, so `--dry-run --yes` never silently executes `[app.go:App.rejectDryRun]`.
- `query` runs only read-only SQL by default; non-read SQL needs `--raw` plus confirmation, and `--raw --dry-run` asks the server for an estimate without executing `[query.go:App.newQueryCmd]`.
- `saved run` and `metrics custom` refuse non-read SQL `[saved.go:App.newSavedCmd]`, `[metrics.go:App.newMetricsCmd]`.
- `auth login` accepts only `ch_pat_` tokens, validates them against the server before storing, and never persists `--insecure-skip-tls-verify` `[auth.go:App.newAuthCmd]`.
- `status` warns when the server is older than `minServerVersion` (3.14.0) `[status.go:minServerVersion]`.
- An empty table/CSV result prints `No results.` on stderr so empty stdout is never ambiguous `[app.go:Session.Print]`.

## Side Effects

- HTTP calls to the CHouse UI server through `internal/api` `[app.go:App.newClient]`.
- Writes credentials and profiles under `~/.config/chouse` via `internal/config` `[auth.go:App.newAuthCmd]`, `[config_cmd.go:App.newConfigCmd]`.
- Results on stdout; notes, prompts, the insecure-TLS warning and `action=… target=… permission=…` audit lines on stderr `[app.go:App.notef]`, `[app.go:Session.audit]`, `[app.go:App.newClient]`.
- Reads SQL, dashboard exports and upload files from disk or stdin, and writes `--out` result files `[common.go:App.readSQL]`, `[dashboard.go:App.readFile]`, `[query.go:Session.printResult]`.

## Verification

- Run: `cd cli && go test ./internal/cli/...`
- After changing the command tree, refresh the docs snapshot: `cd cli && UPDATE_CLI_REFERENCE=1 go test ./internal/cli -run TestCommandReference`
