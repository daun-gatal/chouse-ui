# CLI

The `chouse` CLI provides safe browserless operations — query, explore, monitor the fleet, run the AI doctor, and manage scheduled work — from scripts and CI. Authenticated with a [personal access token](/docs/personal-access-tokens/); destructive commands need `--yes` and offer `--dry-run` previews.

> For AI agents, prefer the [MCP server](/docs/mcp/) — the CLI is the script/CI surface.

## Install

```bash
curl -sSL https://github.com/daun-gatal/chouse-ui/releases/latest/download/install-cli.sh | bash

# Pin a version (independent CLI line, tags cli-vX):
CHOUSE_VERSION=cli-v0.2.0 curl -sSL https://github.com/daun-gatal/chouse-ui/releases/latest/download/install-cli.sh | bash
```

The installer verifies `sha256sum` (or `shasum` on stock macOS), installs to `/usr/local/bin` (or a `~/.chouse/bin` fallback) and wires the fallback into your shell rc. Opt out with `CHOUSE_NO_MODIFY_PATH=1`; override the destination with `INSTALL_DIR`.

Manual install: download `chouse-cli_<os>_<arch>.tar.gz` (+ `.sig`/`.pem` cosign signature) and `checksums.txt` from a `cli-v*` GitHub Release; verify with `sha256sum -c checksums.txt`.

Build from source: Go 1.23+ (`cd cli && go build ./cmd/chouse`).

Shell completions: `chouse completion bash|zsh|fish|powershell`.

> The server must be ≥ the 1.51.0 PAT backfill — older servers fail closed with `401`.

## Auth

Mint one PAT in the UI (Preferences → Personal access tokens), then:

```bash
chouse auth login --server https://chouse.corp:5521 --token ch_pat_…
chouse auth status
```

## Everyday use

```bash
# Query
chouse query "SELECT count() FROM analytics.events WHERE day = today()"
chouse query --connection prod "SELECT * FROM sales.orders LIMIT 10"

# Explore
chouse db list
chouse table list analytics
chouse table schema analytics.events

# Monitor
chouse live list                    # running queries
chouse live kill <query_id>         # destructive: needs --yes
chouse logs --last 1h --sort duration

# Fleet & doctor
chouse fleet status
chouse doctor run --server prod
chouse doctor report latest

# Scheduled queries
chouse schedule list
chouse schedule run <job>
chouse schedule history <job>
```

## Global flags

| Flag | Purpose |
| --- | --- |
| `--server` | Override the stored server URL |
| `--connection` | Target connection by name |
| `--json` | Machine-readable output |
| `--yes` | Confirm destructive actions |
| `--dry-run` | Preview a destructive action |

## Output contract

Commands print human-friendly output by default and stable JSON with `--json` — CI can parse without scraping text. Exit codes: `0` success, non-zero failure.

## Safety

- Destructive verbs (kill, drop, delete, raw SQL execution) require explicit `--yes`
- `--dry-run` prints exactly what would run, then exits without side effects
- Every call is verified live against your RBAC permissions — the CLI is never a backdoor
- DinD (Docker-in-Docker) note: pass the server URL explicitly when the CLI runs inside a container network that can't resolve your hostname

Full command reference: [`docs/cli.md`](https://github.com/daun-gatal/chouse-ui/blob/main/docs/cli.md) and [ADR 0012](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0012-chouse-cli.md).
