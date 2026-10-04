# CLI

The `chouse` CLI operates CHouse UI from the terminal, scripts and CI — query and explore, monitor the fleet, run the AI doctor, manage scheduled work and data health, and govern AI agents. Authenticated with a [personal access token](/docs/personal-access-tokens/). Output is a table in a terminal and JSON when piped; anything that changes data asks first (or needs `--yes`).

> For AI agents, prefer the [MCP server](/docs/mcp/) — the CLI is the human, script and CI surface.

## Install

```bash
curl -sSL https://github.com/daun-gatal/chouse-ui/releases/latest/download/install-cli.sh | bash

# Pin a version (independent CLI line, tags cli-vX):
CHOUSE_VERSION=cli-v1.0.0 curl -sSL https://github.com/daun-gatal/chouse-ui/releases/latest/download/install-cli.sh | bash
```

The installer verifies `sha256sum` (or `shasum` on stock macOS), installs to `/usr/local/bin` (or a `~/.chouse/bin` fallback) and wires the fallback into your shell rc. Opt out with `CHOUSE_NO_MODIFY_PATH=1`; override the destination with `INSTALL_DIR`.

Manual install: download `chouse-cli_<os>_<arch>.tar.gz` (+ `.sig`/`.pem` cosign signature) and `checksums.txt` from a `cli-v*` GitHub Release; verify with `sha256sum -c checksums.txt`.

Build from source: Go 1.23+ (`cd cli && go build ./cmd/chouse`).

Shell completions: `chouse completion bash|zsh|fish|powershell`.

> CLI 1.0 targets servers 3.14.0 and later — `chouse status` says whether yours is supported.

## Log in

Mint one PAT in the UI (Preferences → Personal access tokens), then:

```bash
chouse auth login --server https://chouse.corp      # prompts for the token (hidden)
echo "$TOKEN" | chouse auth login --server https://chouse.corp --token-stdin   # CI
chouse auth status
```

The token never goes on the command line. Behind an internal CA, add `--ca-cert ca.pem` (remembered for the profile). Switch between servers with profiles: `chouse config set connection prod`, `chouse config use-profile staging`, `chouse config profiles`.

## Everyday use

```bash
chouse status
chouse table list -c prod                         # -c takes a connection name or id
chouse table schema analytics.events
chouse query "SELECT name, engine FROM system.tables LIMIT 5"
chouse query -f report.sql --out report.csv
chouse live list && chouse live kill <queryId> --yes
chouse logs --limit 20
chouse fleet list && chouse doctor reports
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

## Output

| `-o` | What you get |
| --- | --- |
| `auto` (default) | A table in a terminal, JSON when piped |
| `table` | Aligned columns (`--wide` keeps long cells, `--no-headers` drops the header) |
| `csv` | The same rows as CSV |
| `json`, `yaml` | The full result as the server returned it — use these in scripts |

Exit codes: `0` ok, `2` usage (including refusals without `--yes`), `3` auth, `4` permission, `5` server, `6` network or timeout, `130` interrupted. Errors include the server's request id; `--debug` traces every request without printing the token. Reads retry on `429` and `502/503/504`; writes never retry.

## Global flags

| Flag | Purpose |
| --- | --- |
| `--server` | Server URL (env `CHOUSE_SERVER`, else the profile) |
| `--profile` | Config profile (env `CHOUSE_PROFILE`) |
| `-c, --connection` | Connection name or id (env `CHOUSE_CONNECTION`) |
| `-o, --output` | `auto`, `table`, `csv`, `json` or `yaml` |
| `-q, --quiet` | No notes on stderr |
| `--timeout` | Request timeout in seconds (1–600) |
| `--yes` | Approve a change without a prompt (required in scripts) |
| `--dry-run` | Preview where supported |
| `--ca-cert` | PEM CA bundle to trust (env `CHOUSE_CA_CERT`) |
| `--insecure-skip-tls-verify` | Skip certificate checks — debugging only |
| `--debug` | Trace requests on stderr |

## Safety

- Changes, notifications and LLM calls ask for a typed `yes` in a terminal and need `--yes` in scripts — without either they fail before any request is sent
- `query` runs read-only SQL directly; anything else needs `--raw`, and `--raw --dry-run` estimates it without running it
- Every call is verified live against your RBAC permissions — the CLI is never a backdoor
- Break-glass administration (connections, SSO, AI keys, users and roles, policies, MCP settings) stays in the UI

Full reference: [`docs/cli.md`](https://github.com/daun-gatal/chouse-ui/blob/main/docs/cli.md), [ADR 0012](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0012-chouse-cli.md) and [ADR 0018](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0018-cli-1-0.md).
