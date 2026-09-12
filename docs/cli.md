# chouse CLI

Safe browserless operations for CHouse UI — query, explore, monitor the fleet,
run the AI doctor, and manage scheduled work without opening the browser.
Authenticated with a personal access token (`ch_pat_…`, ADR 0011). Safe by
default: destructive commands need `--yes` and offer `--dry-run` previews
(ADR 0012).

## Install

```bash
curl -sSL https://github.com/daun-gatal/chouse-ui/releases/latest/download/install-cli.sh | bash
# pin a version (independent CLI line, tags cli-vX):
CHOUSE_VERSION=cli-v0.2.0 curl -sSL …/install-cli.sh | bash
```

The installer verifies `sha256sum` (or `shasum` on stock macOS),
installs to `/usr/local/bin` (or `~/.chouse/bin` fallback — a dedicated
dir, predictable on Linux and macOS, never needs root), and wires the
fallback into your `PATH` via your shell rc file
(`~/.bashrc`+`~/.profile`, `~/.zshrc`, or fish `config.fish`) —
restart the shell or `source` the file afterwards. Opt out with
`CHOUSE_NO_MODIFY_PATH=1`, override the destination with `INSTALL_DIR`.

Or download `chouse-cli_<os>_<arch>.tar.gz` (+`.sig`/`.pem` cosign
signature) + `checksums.txt` from a `cli-v*` GitHub Release — cut only when
`cli/` changes, via `cli-release.yml` — verify
(`sha256sum -c checksums.txt`), and put `chouse` on `PATH`. Shell
completions: `chouse completion bash|zsh|fish|powershell`.

Requires Go 1.23+ to build from source (`cd cli && go build ./cmd/chouse`).
The server must be ≥ the 1.51.0 PAT backfill or PAT calls fail closed (401).

## Auth

Mint one PAT in the UI (Preferences → Personal access tokens), then:

```bash
chouse auth login --server https://chouse.corp:5521 --token ch_pat_…
chouse auth status        # masked token, profile, server
chouse auth whoami        # live user, roles, permissions
chouse auth logout
```

Precedence: `--token > CH_HOUSE_PAT > credentials file (0600) > --profile`.
`--server`: flag > `CHOUSE_SERVER` > profile. `--connection/-c`: flag >
`CHOUSE_CONNECTION` > server default. The CLI never calls PAT-fenced routes
(token CRUD, password change, session logout) — those stay in the browser.

## Everyday use

```bash
chouse status
chouse query "SELECT number FROM system.numbers LIMIT 5"
chouse query --explain plan "SELECT * FROM big_table WHERE day = today()"
chouse table list && chouse table sample analytics events --limit 20
chouse saved list && chouse metrics overview --interval 60
chouse live list
chouse fleet list
chouse doctor reports
chouse scheduled list && chouse health incidents
chouse alert rules && chouse audit list --limit 20
chouse ai optimize -f slow.sql
```

Machine use: `--output json|yaml|csv|table`, `--quiet`, `--stdin`/`-f -`,
exit codes `0/2/3/4/5/6`, no spinners when piped.

## Safety

Reads never prompt. Mutations need TTY confirm and `--yes` in CI:

```bash
chouse live kill <queryId> --yes
chouse query --raw --yes "ALTER TABLE t UPDATE x = 1 WHERE id = 2"
chouse scheduled run <id> --yes
chouse upload preview --file rows.csv
chouse metrics simulate "ALTER TABLE t UPDATE x = 1 WHERE id = 2"  # never executes
```

`doctor scan` warns about LLM cost. Every mutation prints
`action/target/permission`. UI-only in v1 (CLI errors with a UI hint): SSO
admin, AI provider keys, user/role grants, policy writes, ClickHouse native
user/role writes, connection create/delete, audit prune.

## DinD note

In this repo's DinD CI the `opencode-dind-apps` published ports live on the
DinD host, not the agent pod — e2e must use a sidecar
(`docker run --network <compose>_default http://chouse-ui:5521`), never
`localhost` from the pod. See `scripts/e2e-pat.sh` and ADR 0012 §4.

## End-to-end

`./scripts/e2e-cli.sh` builds the server + CLI from the working tree, brings
up the compose stack on DinD, and runs `scripts/e2e-cli-check.py` (provision
→ 14 live checks: reads, guarded writes, real `KILL`, exit codes) from inside
the compose network. Sequential runs only; the login route is rate-limited,
so don't loop it tightly.
