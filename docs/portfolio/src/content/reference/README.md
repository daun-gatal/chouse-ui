# content/reference

## Overview

Source data for the generated docs reference pages. `config-keys.ts` is hand-maintained; `cli.json` and `permissions.json` are generated snapshots. All three are consumed by `docs/portfolio/scripts/gen-reference.ts`, and `permissions.json` also by `build-docs.ts`.

## Interface

- `[config-keys.ts:ConfigKey]` - `name`, `section`, optional `default`, `description`, `required: "production"`, `secret`, `status: "deprecated" | "removed"`.
- `[config-keys.ts:CONFIG_SECTIONS]` - section order of the Environment variables page.
- `[config-keys.ts:CONFIG_KEYS]` - every server configuration variable.
- `[config-keys.ts:IGNORED_ENV]` - variables the server reads that are not user configuration (test harness and runtime values).
- `cli.json` - snapshot of the `chouse` command tree (`globalFlags`, `groups`, `commands`), written by the CLI test `TestCommandReference` in `cli/internal/cli`.
- `permissions.json` - permission id -> `{ name, category, anchor }`, written by `gen-reference.ts`.

## Invariants

- Every environment variable the server reads must have a `CONFIG_KEYS` entry, and every entry must still be read unless its `status` is `removed` or its name is a placeholder containing `<` (a `deprecated` key that is no longer read still fails, although the `config-keys.ts` header says otherwise); `gen-reference.ts --check` fails otherwise `[config-keys.ts:CONFIG_KEYS]`, `[../../../scripts/gen-reference.ts:checkEnvCoverage]`.
- `cli.json` and `permissions.json` are generated: never edit them by hand. `cli.json` is written by `UPDATE_CLI_REFERENCE=1 go test ./internal/cli -run TestCommandReference` and only read by `gen-reference.ts` `[../../../../../cli/internal/cli/reference_test.go:TestCommandReference]`, `[../../../scripts/gen-reference.ts:cliPage]`; `permissions.json` is written by `[../../../scripts/gen-reference.ts:main]`.

## Side Effects

- None. Static data modules.

## Verification

- Run: `cd docs/portfolio && bun scripts/gen-reference.ts --check` (needs `bun install` in `packages/server`)
