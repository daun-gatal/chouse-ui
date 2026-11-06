# internal

## Overview

Private Go packages of the `chouse` CLI module (`github.com/daun-gatal/chouse-ui/cli`). `cli` is the command layer and imports the other four; `api`, `config`, `output` and `safety` import no other internal package.

## Subdirectories & Boundaries

- api: [./api/README.md](./api/README.md) - PAT-authenticated HTTP client for the CHouse UI `/api` envelope and the `/mcp` JSON-RPC endpoint; exit-code mapping, idempotent-only retries, TLS options, token-safe debug tracing.
- cli: [./cli/README.md](./cli/README.md) - cobra command tree and `Run`; central error-to-exit-code mapping, confirmation and `--dry-run` gating of mutations, connection-name resolution.
- config: [./config/README.md](./config/README.md) - flag > env > file precedence, profiles in `~/.config/chouse/config.yaml`, PATs only in env or the `0600` `credentials.yaml`.
- output: [./output/README.md](./output/README.md) - `table`/`csv`/`json`/`yaml` rendering with `auto` choosing table on a TTY and JSON when piped.
- safety: [./safety/README.md](./safety/README.md) - SQL intent classification (unknown fails closed as a write) and the `--yes`/typed-`yes` confirmation gate.
