# safety

## Overview

Package `safety` enforces the CLI's safe-by-default contract: read-only SQL runs freely, while mutating or unrecognised statements and other destructive actions need explicit confirmation. It has no dependencies on the rest of the CLI and performs no I/O beyond the confirmation prompt.

## Interface

- `[safety.go:Intent]` - SQL intent enum: `IntentRead`, `IntentWrite`, `IntentUnknown`.
- `[safety.go:Classify]` - `Classify(sql string) Intent` classifies one statement by its leading verb.
- `[safety.go:ConfirmOptions]` - `Yes`, `Action`, `Target`, `In`, `Prompt`, `TTY` inputs for the gate.
- `[safety.go:RequireConfirm]` - `RequireConfirm(opts ConfirmOptions) error` returns nil only on `--yes` or a typed `yes` on a terminal.

## Invariants

- Empty input classifies as `IntentUnknown`, which callers treat as a write (fail closed) `[safety.go:Classify]`.
- Multi-statement input (more than one `;`, or a `;` that is not trailing) is always `IntentWrite` `[safety.go:Classify]`.
- Only `SELECT|WITH|SHOW|DESCRIBE|DESC|EXPLAIN` prefixes count as reads `[safety.go:selectOnly]`.
- Without `Yes` and without an interactive TTY (or with a nil reader), `RequireConfirm` refuses instead of prompting, so scripts and agents cannot mutate by accident `[safety.go:RequireConfirm]`.
- Any answer other than `yes` (case-insensitive, trimmed) aborts `[safety.go:RequireConfirm]`.

## Side Effects

- Writes the confirmation question to `ConfirmOptions.Prompt` (stderr in the CLI) and reads one line from `ConfirmOptions.In` `[safety.go:RequireConfirm]`.

## Verification

- Run: `cd cli && go test ./internal/safety/...`
