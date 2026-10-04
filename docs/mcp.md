# CHouse MCP Server

AI agents (Cursor, VS Code Copilot, OpenCode, Claude Code, Codex, CI
pipelines) can operate CHouse UI without the browser through a **Model
Context Protocol** endpoint served at **`/mcp` on the same address as the
UI**. Authentication is a personal access token (`ch_pat_…`,
[ADR 0011](adr/0011-personal-access-tokens.md)); the transport is
**Streamable HTTP** ([ADR 0013](adr/0013-chouse-mcp.md)). An administrator
turns it on and picks the tools in **Agents › MCP**
([ADR 0017](adr/0017-mcp-managed-in-the-ui.md)). Safe by default: read-only
tools only until an administrator turns on anything that changes or deletes
things, and destructive tools are approved by a human through your client's
permission prompt before they run (see
[Human approval per client](#human-approval-per-client)).

## Turn it on

There is nothing to deploy or configure in env, Compose or Helm: the
endpoint shares the web port (`5521`) and therefore the UI's Service,
Ingress and TLS. It answers `404 MCP_DISABLED` until it is turned on.

1. Sign in as someone with `agents:manage` (Admin and Super Admin by
   default) and open **Agents › MCP**.
2. Switch **MCP server** on. The page shows the endpoint URL agents use —
   `https://<your-chouse-host>/mcp` (the server's `PUBLIC_BASE_URL` when
   set, otherwise the address you opened the UI on).
3. Optionally list **allowed origins** (only browser-based agent hosts send
   one) and change the **tool call timeout** (1–600 s, default 60).
4. Review the **Tools** list (below) and turn on what your agents need.

Changes apply on every replica within a few seconds, without a restart, and
are recorded in the audit log as `agent.mcp_update`. Anyone with
`agents:view` can see the settings and the tool list; `chouse mcp settings`
shows the same from the CLI.

**Upgrading from 3.13.** The dedicated port 8752, the `MCP_*` environment
variables, the `mcp.*` YAML keys and the Helm chart's `mcp.*` values
(`<release>-mcp` Service and MCP Ingress) are gone. The server logs a
warning when an old `MCP_*` key is still set and the chart's install notes
warn about leftover `mcp:` values. Point agents at `https://<host>/mcp`
instead of `:8752/mcp`, then turn MCP on in Agents › MCP — it starts off
after the upgrade, whatever `MCP_ENABLED` was.

**Reverse proxies.** MCP responses stream over SSE, like AI chat. If your
proxy buffers responses, disable buffering and raise the read timeout for
the UI host (nginx: `proxy-buffering: "off"`,
`proxy-read-timeout: "300"`).

## Mint a token

Preferences → Personal access tokens → create. The token can be scoped: a
token with only `table:select, metrics:view` caps the agent regardless of
which tools are on — and `tools/list` only shows the tools a token's
permissions allow. Every call re-checks live roles ∩ token scopes — revoke,
demotion, or deactivation take effect on the **next** tool call.

## Try the hosted lab

**https://mcp.chouse-ui.com/mcp** is a live, hosted instance of this server.
Mint a personal access token in the lab UI (same Preferences flow, same
`ch_pat_…` format), point any MCP client below at the endpoint, and evaluate
the tools without deploying anything. The lab runs the default-safe policy
(read-only; writes and destructive tools off), so it is safe to experiment
with — self-host when you need the write or destructive tools. Smoke test:

```bash
curl -s https://mcp.chouse-ui.com/mcp \
  -H "Authorization: Bearer ch_pat_…" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Client configuration

Agents › MCP has copy-ready setup for every client below with your endpoint
filled in, and `chouse mcp config <claude-code|codex|cursor|vscode|opencode>`
prints the same for your CLI profile. Every snippet reads the token from
`CH_HOUSE_PAT` (or a secret prompt) so it never lands in a config file.

### OpenCode (TUI + Web)

OpenCode loads MCP servers from one config for both surfaces — the TUI
(`opencode`) and the browser app (`opencode web`, attachable from the TUI
with `opencode attach http://localhost:<port>`). Put the server in the
global config (`~/.config/opencode/opencode.json`) for all projects, or in
a project-level `opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "chouse": {
      "type": "remote",
      "url": "https://chouse.corp/mcp",
      "enabled": true,
      "oauth": false,   // PAT auth — prevents OpenCode's auto-OAuth flow on 401
      "headers": {
        "Authorization": "Bearer {env:CH_HOUSE_PAT}",
        "X-Connection-Id": "{env:CHOUSE_CONNECTION}"
      },
      "timeout": 60000  // default 5000 ms is tight for the initial tools/list
    }
  }
}
```

Then export the token and start either surface — both pick up the same
server:

```bash
export CH_HOUSE_PAT="ch_pat_…"    # {env:...} substitutes; unset → empty
opencode                          # TUI
opencode web                      # browser (same config, same tools)
```

Tools appear as `chouse_<name>` (`chouse_whoami`, `chouse_query`, …). Verify
with `opencode mcp list` / `opencode mcp debug chouse`; note that prompts use
the server name ("use chouse to investigate the slow query"). To gate the
tools per agent instead of globally, deny the prefix globally and allow it in
an agent block (OpenCode v1.1.1+ `permission` syntax — the legacy `tools`
boolean map is deprecated):

```jsonc
{
  "permission": { "chouse*": "deny" },
  "agent": {
    "dba": { "permission": { "chouse*": "allow" } }
  }
}
```

**VS Code / Copilot Chat** (`.vscode/mcp.json`; secret prompt input — the PAT
never lands on disk):

```jsonc
{
  "servers": {
    "chouse": {
      "type": "http",
      "url": "https://chouse.corp/mcp",
      "headers": { "Authorization": "Bearer ${input:chouse_pat}" }
    }
  },
  "inputs": [
    {
      "id": "chouse_pat",
      "type": "promptString",
      "description": "CHouse UI personal access token (ch_pat_…)",
      "password": true
    }
  ]
}
```

**Cursor** (`.cursor/mcp.json`):

```jsonc
{
  "mcpServers": {
    "chouse": {
      "url": "https://chouse.corp/mcp",
      "headers": { "Authorization": "Bearer ${env:CH_HOUSE_PAT}" }
    }
  }
}
```

**Claude Code** — one command, static Bearer header (chouse advertises no
OAuth, so the header is honored cleanly; add `--scope user` to register it
once for all projects):

```bash
claude mcp add --transport http chouse https://mcp.chouse-ui.com/mcp \
  --header "Authorization: Bearer ch_pat_…"
```

Or the `.mcp.json` equivalent (project scope, `streamable-http` also
accepted as the type alias):

```jsonc
{
  "mcpServers": {
    "chouse": {
      "type": "http",
      "url": "https://mcp.chouse-ui.com/mcp",
      "headers": { "Authorization": "Bearer ch_pat_…" }
    }
  }
}
```

**Codex CLI** — `~/.codex/config.toml` uses snake_case `mcp_servers` (not
`mcpServers`); keep the PAT in an environment variable, not on disk:

```bash
codex mcp add chouse --url https://mcp.chouse-ui.com/mcp \
  --bearer-token-env-var CH_HOUSE_PAT
```

Or edit `~/.codex/config.toml` directly:

```toml
[mcp_servers.chouse]
url = "https://mcp.chouse-ui.com/mcp"
bearer_token_env_var = "CH_HOUSE_PAT"
```

Then `export CH_HOUSE_PAT="ch_pat_…"` before starting Codex. For a static
header instead of the env var, use `http_headers = { Authorization =
"Bearer ch_pat_…" }` in the same table.

**CI / scripts** — plain JSON-RPC POSTs:

```bash
curl -s https://chouse.corp/mcp \
  -H "Authorization: Bearer $CH_HOUSE_PAT" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Note on `Origin`: requests carrying an `Origin` header are rejected unless the
origin is in the allowed origins in Agents › MCP (DNS-rebinding protection).
Headerless clients (curl, CLI and desktop agents) always pass.

## Tools

Every tool has a title, a description, an access level and the permissions
it needs, all shown in Agents › MCP with its parameters. Each tool is
switched on or off on its own (or a whole category at once):

- **Read** tools are on by default.
- **Write** and **destructive** tools, and tools that **spend LLM budget**,
  are off until an administrator turns them on. Turning on a tool that
  changes or deletes things asks for confirmation first.
- A tool added in a later release arrives in its default state; **Reset to
  defaults** puts every tool back.

`tools/list` shows a token only the tools that are on **and** that its
permissions allow (it needs at least one of the listed permissions), so an
agent's context never carries a tool it would be refused. The route behind
each tool still checks permissions and data access on every call. Tool
annotations follow the access level (`readOnlyHint`, `destructiveHint`), so
clients prompt for the right calls.

| Category | Read (on by default) | Write / destructive / LLM (off by default) |
|---|---|---|
| Identity & connections | `whoami`, `list_connections`, `use_connection` | |
| Explore | `list_databases`, `list_tables`, `describe_table`, `sample_table` (≤20 rows) | |
| Query | `query` (SELECT-only), `explain_query`, `list_saved_queries`, `get_saved_query`, `run_saved_query` (write definitions refused) | `create_saved_query` (write), `query_raw`, `delete_saved_query` (destructive) |
| Data observability | `get_dataset_health`, `get_lineage`, `get_table_context`, `get_metric`, `get_pipeline_status`, `list_incidents` | `propose_remediation` (write — files a proposal only; a human approves it, never the proposer) |
| Data health | `list_health_checks`, `get_health_check`, `health_timeline` | `run_health_check`, `acknowledge_incident` (write) |
| Monitoring | `metrics_overview`, `live_queries`, `fleet_snapshots`, `list_alerts`, `audit_list` | `test_alert_channel` (write), `kill_query` (destructive) |
| Scheduled queries | `list_scheduled_jobs`, `get_scheduled_job`, `list_scheduled_runs` | `run_scheduled_job` (write), `delete_scheduled_job` (destructive) |
| Chouse AI | `doctor_reports`, `get_doctor_report` | `ai_optimize`, `doctor_scan` (LLM spend) |

Resources: `chouse://connection/{id}`, `chouse://database/{name}`,
`chouse://table/{db}/{table}`, `chouse://saved-query/{id}`,
`chouse://scheduled-job/{id}`, `chouse://health-check/{id}`,
`chouse://doctor-report/{id}`.

Prompts: `investigate-slow-query`, `diagnose-incident`, `review-schema`,
`plan-schema-migration`.

Every tool call is attributed in the audit log (`mcp.tool_call`) to the PAT's
user, alongside the route-level audit entries the projected API already writes.

## Human approval per client

Destructive tools run once an administrator turns them on, under the
token's scopes — approval by a human happens in the **client**, via each host's native
permission system. Tool names below assume the server is configured under the
name `chouse`; adjust the prefix if you named it differently.

| Client | Default behavior | Make the destructive tools ask |
|---|---|---|
| OpenCode | allowed | `permission` ask rules (below) |
| Claude Code | prompts on first use (Manual mode) | `permissions.ask: ["mcp__chouse__*"]` |
| Codex CLI | per approval policy | `default_tools_approval_mode = "prompt"` (or `"writes"`) |
| VS Code Copilot | confirms each invocation | keep per-tool auto-approve toggles off |
| Cursor | asks per tool call | leave "Always allow" off for these tools |
| Claude Desktop | asks per tool call | don't choose "Always allow" for these tools |
| CI / headless | no human present | none — tool switches + scoped PATs are the only layer |

**OpenCode** (v1.1.1+; the legacy `tools` boolean map is deprecated):

```jsonc
{
  "permission": {
    "chouse_kill_query": "ask",
    "chouse_query_raw": "ask",
    "chouse_delete_saved_query": "ask",
    "chouse_delete_scheduled_job": "ask"
  }
}
```

Keys are the tool ids OpenCode sees (`<server-key>_<tool>`); adjust the
prefix if you named the server something else.

**Claude Code** — Manual mode already prompts on first use of each MCP tool;
to make it explicit, add an ask rule (rules evaluate deny → ask → allow):

```jsonc
{
  "permissions": {
    "ask": ["mcp__chouse__*"]
  }
}
```

**Codex CLI** — set the approval policy per server or per tool
(`writes` prompts any tool not marked read-only, which covers all four):

```toml
[mcp_servers.chouse]
default_tools_approval_mode = "prompt"   # or "writes"

[mcp_servers.chouse.tools.kill_query]
approval_mode = "prompt"
```

**VS Code Copilot / Cursor / Claude Desktop** — tool calls are confirmed per
invocation by default; keep the per-tool "always allow" toggles off for
`kill_query`, `query_raw`, `delete_saved_query`, and `delete_scheduled_job`.

**CI / headless agents** (OpenCode `--auto`, `claude -p`, `codex exec`, CI
pipelines) have no human to ask — the tool switches in Agents › MCP and a
narrowly scoped PAT are the only guardrails there. Never mint a destructive-capable PAT for
unattended use unless the operator explicitly accepts that trade-off.

## Safety model

1. **Read-only by default.** Write, destructive and LLM-spending tools are
   not listed until an administrator turns them on in Agents › MCP — an agent
   cannot opt in, and a token never sees a tool its permissions do not allow.
2. **SQL classification** reuses the AST-based parser that guards the API:
   `query` accepts a single SELECT/WITH/SHOW/DESCRIBE/EXPLAIN; anything else
   (including multi-statement input) fails closed.
3. **Human approval happens in the client** ([ADR 0014](adr/0014-mcp-destructive-client-approval.md)):
   destructive tools execute once an administrator turns them on, under the PAT's scopes,
   and the human approves them through the host's permission prompt —
   configured per client above.
4. **Result caps:** 100 rows / 200 KB / 2 KB per cell, plus secret redaction
   (`ch_pat_…`, password-shaped fields) before anything reaches the model.
5. **Live authorization:** every call verifies the PAT against the RBAC
   database (roles ∩ scopes), data-access policies apply, and rate limits are
   shared with the UI. `patId` distinguishes machine actions in the audit trail.
6. **Privilege fence:** PAT CRUD, password change, login/refresh/logout, SSO
   admin, AI provider/model secrets, user/role grants, policy writes, native
   ClickHouse user/role writes, connection create/delete, audit prune/export,
   and uploads are never exposed as tools — they stay in the browser.
   Remediation approval and execution are never tools either.
7. **Agent governance** ([ADR 0016](adr/0016-data-observability-platform.md) §10):
   every MCP and PAT call is recorded on an agent session (Agents page).
   Queries run through `EXPLAIN ESTIMATE` against the per-token, per-role or
   default budget policy, results carry health notices for stale or
   incident-affected tables, and an administrator can pause all agent access
   at once (`AGENT_ACCESS_PAUSED` / `AGENT_POLICY_BLOCKED`).

Connection scoping: pass `X-Connection-Id` as a request header or a
`connection_id` tool argument; otherwise the caller's default connection is
used (same resolution as the CLI). Nothing is pinned server-side — the
protocol is stateless and multi-replica safe.

## End-to-end

`./scripts/e2e-mcp.sh` builds the server from the working tree, boots the
compose stack on DinD, and runs `scripts/e2e-mcp-check.py` inside the
compose network: off by default (404), turned on through the Agents › MCP
API, PAT auth, read-only tools by default, a per-tool switch, SELECT through
ClickHouse, write refusal, Origin/JWT rejection, and PAT-revocation taking
effect on the next call. Sequential runs only.
