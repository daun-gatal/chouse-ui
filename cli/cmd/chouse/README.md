# chouse (main)

## Overview

Entry point of the `chouse` binary. It wires OS signals to a cancellable context, delegates the whole command tree to [`internal/cli`](../../internal/cli/README.md), and exits with the code it returns.

## Interface

- `[main.go:main]` - calls `cli.Run(ctx, os.Args[1:], cli.StdStreams(), version, commit, date)` and `os.Exit`s with its result.
- `[main.go:version]`, `[main.go:commit]`, `[main.go:date]` - build metadata, defaulting to `dev`/`none`/`unknown`; release builds override them with `-ldflags "-X main.version=…"` (see `scripts/build-cli.sh`).

## Invariants

- `SIGINT` and `SIGTERM` cancel the running request through the context instead of killing the process mid-write `[main.go:main]`.
- The process exit code is exactly the value returned by `cli.Run` `[main.go:main]`.

## Side Effects

- Installs signal handlers for `os.Interrupt` and `syscall.SIGTERM` `[main.go:main]`.
- Terminates the process via `os.Exit` `[main.go:main]`.

## Verification

- Run: `cd cli && go build ./cmd/chouse && go test ./...`
