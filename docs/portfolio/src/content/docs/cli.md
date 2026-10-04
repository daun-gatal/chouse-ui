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
chouse auth login --server https://chouse.corp --token ch_pat_…
chouse auth status        # masked token, profile, server
chouse auth whoami        # live user, roles, permissions
```

`auth login` remembers the server for the profile. Behind an internal CA, add `--ca-cert ca.pem` (or set `CHOUSE_CA_CERT`) — it is remembered too. `--insecure-skip-tls-verify` is for debugging only: it warns and is never stored.

## Everyday use

```bash
# Query and explore
chouse status
chouse query "SELECT count() FROM analytics.events WHERE day = today()"
chouse query -c <connectionId> --explain plan "SELECT * FROM sales.orders WHERE day = today()"
chouse table list && chouse table sample analytics events --limit 20

# Monitor
chouse live list                    # running queries
chouse live kill <queryId> --yes    # destructive: needs --yes
chouse metrics overview --interval 60
chouse fleet list && chouse doctor reports

# Scheduled work and data health
chouse scheduled list && chouse scheduled run <id> --yes
chouse health incidents && chouse health dataset shop.orders
chouse lineage shop.orders --impact
```

## AI agents

```bash
chouse mcp status                     # MCP on/off, endpoint, tools your token gets
chouse mcp tools                      # the tools an agent with your token sees
chouse mcp config claude-code | sh    # also: codex, cursor, vscode, opencode
chouse agents sessions --days 7       # what agents read and whether it was blocked
```

These commands are read-only: an administrator turns MCP on and picks its tools in **Agents › MCP** ([MCP](/docs/mcp/)).

## Global flags

| Flag | Purpose |
| --- | --- |
| `--server` | Server URL (env `CHOUSE_SERVER`, else the profile) |
| `--token` | PAT (env `CH_HOUSE_PAT`, else the 0600 credentials file) |
| `--profile` | Config profile (env `CHOUSE_PROFILE`) |
| `-c, --connection` | ClickHouse connection id (env `CHOUSE_CONNECTION`) |
| `-o, --output` | `json` (default) or `yaml` |
| `-q, --quiet` | Machine mode: diagnostics stay on stderr |
| `--timeout` | Request timeout in seconds (1–600) |
| `--yes` | Confirm destructive actions (required without a TTY) |
| `--dry-run` | Preview where supported |
| `--ca-cert` | PEM CA bundle to trust (env `CHOUSE_CA_CERT`) |
| `--insecure-skip-tls-verify` | Skip certificate checks — debugging only |

## Output contract

stdout is always machine-parseable — `json` by default or `yaml` with `-o yaml`; human notes go to stderr. Exit codes: `0` ok, `2` usage, `3` auth, `4` permission, `5` server, `6` network. Reads retry up to three times on network errors, `429` and `502/503/504` (honoring `Retry-After`), so a rolling restart does not fail a script; writes are never retried.

## Safety

- Destructive verbs (kill, delete, raw SQL execution) require explicit `--yes`
- `--dry-run` previews where supported and fails fast where it is not, instead of executing
- Every call is verified live against your RBAC permissions — the CLI is never a backdoor
- Break-glass admin (SSO, AI provider keys, user/role grants, policy and MCP settings) stays in the UI

Full command reference: [`docs/cli.md`](https://github.com/daun-gatal/chouse-ui/blob/main/docs/cli.md) and [ADR 0012](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0012-chouse-cli.md).
