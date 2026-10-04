# CLI

`chouse` operates CHouse UI from the terminal, scripts and CI: query and explore, monitor the fleet, run the Doctor, manage scheduled work and data health, review fixes and agents. It authenticates with a [personal access token](/docs/personal-access-tokens/), so it can do exactly what its owner can and nothing more. Output is a table in a terminal and JSON when piped; anything that changes data asks first (or needs `--yes`), and `--dry-run` previews where the server can.

For AI agents, use the [MCP server](/docs/mcp/) instead; the CLI is for people, scripts and CI. Every command and flag is on the [CLI command reference](/docs/cli-reference/).

## Install

```bash
curl -sSL https://github.com/daun-gatal/chouse-ui/releases/latest/download/install-cli.sh | bash
# pin a version (independent CLI line, tags cli-vX):
CHOUSE_VERSION=cli-v1.0.0 curl -sSL …/install-cli.sh | bash
```

The installer verifies `sha256sum` (or `shasum` on stock macOS), installs to `/usr/local/bin` (or `~/.chouse/bin` fallback — a dedicated dir, predictable on Linux and macOS, never needs root), and wires the fallback into your `PATH` via your shell rc file (`~/.bashrc`+`~/.profile`, `~/.zshrc`, or fish `config.fish`) — restart the shell or `source` the file afterwards. Opt out with `CHOUSE_NO_MODIFY_PATH=1`, override the destination with `INSTALL_DIR`.

Or download `chouse-cli_<os>_<arch>.tar.gz` (+`.sig`/`.pem` cosign signature) + `checksums.txt` from a `cli-v*` GitHub Release — cut only when `cli/` changes, via `cli-release.yml` — verify (`sha256sum -c checksums.txt`), and put `chouse` on `PATH`. Shell completions: `chouse completion bash|zsh|fish|powershell`.

Requires Go 1.23+ to build from source (`cd cli && go build ./cmd/chouse`). CLI 1.0 targets servers 3.14.0 and later; `chouse status` reports the server version and whether this CLI supports it.

## Log in

Mint one PAT in the UI (**Preferences › Personal access tokens**), then:

```bash
chouse auth login --server https://chouse.corp            # prompts for the token (hidden)
echo "$TOKEN" | chouse auth login --server https://chouse.corp --token-stdin   # CI
chouse auth status        # profile, server, connection, masked token
chouse auth whoami        # the token's user, roles and permissions
chouse auth logout
```

The token never needs to be an argument: login reads it from a hidden prompt, `--token-stdin` or `CH_HOUSE_PAT`. `--token` still works but warns, because arguments end up in shell history and the process list. Login remembers `--server` and `--ca-cert` for the profile.

Servers behind an internal CA: pass `--ca-cert ca.pem` (or set `CHOUSE_CA_CERT`). `--insecure-skip-tls-verify` (`CHOUSE_INSECURE_SKIP_TLS_VERIFY=true`) is for debugging only: it warns and is never remembered.

## Profiles and settings

```bash
chouse config view                         # effective settings, token masked
chouse config set connection prod          # default connection (name or id)
chouse config set output json --profile ci
chouse config get server
chouse config unset connection
chouse config profiles                     # * marks the current one
chouse config use-profile staging
chouse config delete-profile old --yes
```

Settings resolve flag > environment > profile: `--server`/`CHOUSE_SERVER`, `--token`/`CH_HOUSE_PAT` (or the stored token), `-c`/`CHOUSE_CONNECTION`, `-o`/`CHOUSE_OUTPUT`, `--ca-cert`/`CHOUSE_CA_CERT`, `--profile`/`CHOUSE_PROFILE`. Profiles live in `~/.config/chouse/config.yaml`; tokens in `credentials.yaml` (0600).

## Everyday use

```bash
chouse status
chouse connection list
chouse table list -c prod                       # -c takes a connection name or id
chouse table schema analytics.events
chouse table sample analytics.events --limit 20
chouse query "SELECT name, engine FROM system.tables LIMIT 5"
chouse query -f report.sql --out report.csv     # format from the extension
chouse query "SELECT * FROM events LIMIT 1000" -o csv > events.csv
chouse query --explain plan "SELECT * FROM big WHERE day = today()"
chouse saved list && chouse saved run <id>
chouse metrics overview && chouse logs --limit 20
chouse live list
chouse fleet list && chouse doctor reports
chouse scheduled list && chouse health incidents
chouse alert rules && chouse audit list --limit 20
```

[Data observability](/docs/data-observability/):

```bash
chouse health dataset shop.orders            # trust state, freshness, open incidents
chouse lineage shop.orders --direction up    # sources, views, jobs, downstream
chouse lineage shop.orders --impact          # what a schema change would break
chouse incidents --all --limit 20            # data + pipeline incidents with root cause
chouse remediation list -c prod --status proposed
chouse remediation approve <actionId> --comment "reviewed" --yes
```

Approval rules are enforced server-side: a person may approve their own low-risk fix, high-risk fixes need two approvers other than the proposer, and a fix proposed by Chouse AI or an agent always needs someone else. The CLI never runs an action directly — the server runs it once approved (inside the maintenance window for window-only actions).

[AI agents](/docs/agents/) — read-only; an administrator changes MCP settings and agent policies in the UI:

```bash
chouse mcp status                     # on/off, endpoint (<server>/mcp), tools your token gets
chouse mcp tools                      # the tools an agent with your token sees
chouse mcp config claude-code | sh    # register this server with Claude Code
chouse mcp config cursor > .cursor/mcp.json   # also: codex, vscode, opencode
chouse mcp settings -o yaml           # Agents › MCP settings and every tool's state (agents:view)
chouse agents summary && chouse agents sessions --days 7
chouse agents session <sessionId>     # replay one session's tool calls
chouse agents policies
```

`mcp config` prints the raw snippet; every snippet reads the token from `CH_HOUSE_PAT` or a secret prompt, never inline.

## Output

| `-o` | What you get |
|---|---|
| `auto` (default) | `table` when stdout is a terminal, `json` when it is piped or redirected |
| `table` | Aligned columns; long cells are cut at 60 characters (`--wide` keeps them), `--no-headers` drops the header |
| `csv` | The same rows as CSV, cells never cut (`--no-headers` too) |
| `json`, `yaml` | The full result exactly as the server returned it |

Tables show the useful columns of a list; JSON and YAML always carry every field, so scripts should use them. Query results keep ClickHouse's column order, and `--out FILE` writes them to a file (`.csv`, `.json`, `.yaml`). Notes such as row counts and confirmations go to stderr, so stdout pipes cleanly; `-q` silences them. `audit export` always writes CSV and `mcp config` a raw snippet.

## Errors and exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 2 | Usage: bad flags or arguments, unknown command, refused without `--yes`, `--dry-run` not supported |
| 3 | Authentication: no token, or the token is invalid, expired or revoked |
| 4 | Permission: the token lacks the permission named in the message |
| 5 | Server error |
| 6 | Network: the server could not be reached, or the request timed out |
| 130 | Interrupted (Ctrl-C cancels the request in flight) |

Errors print the server's request id, so an operator can find the request in the server logs, plus a hint where one helps. `--debug` traces every request on stderr — method, path, status, time and request id — and never prints the token.

Reads (GET) retry up to three times within `--timeout` on network errors, `429` and `502/503/504`, honoring `Retry-After`, so a rolling restart does not fail a script. Writes are never retried.

## Global flags

`--server`, `--token`, `--profile`, `-c/--connection`, `-o/--output`, `--no-headers`, `--wide`, `-q/--quiet`, `--timeout` (seconds, 1-600), `--yes`, `--dry-run`, `--ca-cert`, `--insecure-skip-tls-verify`, `--debug`. Details on the [command reference](/docs/cli-reference/#global-flags).

## Safety

Reads never prompt. Anything that changes data, sends notifications or spends LLM budget asks for a typed `yes` on a terminal and needs `--yes` without one — it fails closed otherwise, before any request is sent:

```bash
chouse live kill <queryId> --yes
chouse query --raw --dry-run "ALTER TABLE t DELETE WHERE day < today() - 30"   # estimate only
chouse query --raw --yes "ALTER TABLE t DELETE WHERE day < today() - 30"
chouse scheduled run <id> --yes
chouse remediation reject <actionId> --yes
chouse ai optimize -f slow.sql --yes
```

`query` runs SELECT/WITH/SHOW/DESCRIBE/EXPLAIN directly; anything else needs `--raw`. Every change prints an `action=… target=… permission=…` line on stderr. Break-glass administration — creating or deleting connections, SSO, AI provider keys, users and roles, data-access policies, MCP settings, agent policies, audit pruning, importing files — stays in the UI.

## Upgrading from 0.x

CLI 1.0 changes some commands and the default output:

- Output in a terminal is now a table; piped output is still JSON. `CHOUSE_OUTPUT=json` (or `chouse config set output json`) restores JSON everywhere.
- `chouse table schema|sample` also accept `db.table` (`db table` still works), and `chouse table list [database]` lists one row per table.
- `chouse logs queries|patterns|tables|histogram` became `chouse logs` (the four views were the same request).
- `chouse saved create` takes the SQL as arguments, `-f FILE` or `--stdin` instead of `--query`; `chouse upload preview` takes the file as an argument; `chouse fleet query <metric>` uses `-c`.
- Removed: `auth login --pat` (use the prompt or `--token-stdin`), `connection create|delete|use`, `table create|drop`, `upload into`, and `logs` subviews — commands that only pointed at the UI or repeated another.
- Field names in JSON are the server's (`dryRun`, not `dry_run`).
