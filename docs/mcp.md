# CHouse MCP Server

AI agents (Cursor, VS Code Copilot, OpenCode, Claude Desktop, CI pipelines) can
operate CHouse UI without the browser through a **Model Context Protocol**
endpoint on a dedicated port. Authentication is a personal access token
(`ch_pat_…`, [ADR 0011](adr/0011-personal-access-tokens.md)); the transport is
**Streamable HTTP** ([ADR 0013](adr/0013-chouse-mcp.md)). Safe by default:
read-only unless the operator enables writes, and destructive tools are
approved by a human through your client's permission prompt before they run
(see [Human approval per client](#human-approval-per-client)).

## Enable

**Docker:**

```yaml
# docker-compose.yml
services:
  chouse-ui:
    ports:
      - "8752:8752"   # or "80:8752" / "443:8752" for https://<host>/mcp
    environment:
      MCP_ENABLED: "true"
      # Optional, default off:
      # MCP_ALLOW_WRITES: "true"        # create/run/ack actions
      # MCP_ALLOW_DESTRUCTIVE: "true"   # KILL / raw SQL / deletes (needs writes)
      # MCP_TOOLSETS: "core,explore,query,observe,ops"
      # MCP_ALLOWED_ORIGINS: "https://your-agent-host.example"
```

**Kubernetes (Helm):**

```yaml
mcp:
  enabled: true          # dedicated port 8752 + <release>-mcp Service
  # allowWrites: false   # server-side policy — agents cannot opt in
  # allowDestructive: false
  # toolsets: [core, explore, query, observe, ops]
  # allowedOrigins: []
  service:
    type: ClusterIP      # NodePort/LoadBalancer expose MCP directly (no Ingress)
  ingress:
    # Optional: expose the endpoint at https://<host>/mcp through the ingress.
    # Mirrors the UI ingress — className/annotations/tls rendered verbatim.
    enabled: true
    hosts:
      - host: chouse.corp
    annotations:         # MCP streams over SSE: raise the read timeout, disable buffering
      nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
      nginx.ingress.kubernetes.io/proxy-buffering: "off"
    # tls:                # same shape as ingress.tls; not needed on
    #   - hosts: [chouse.corp]     # TLS-terminating controllers
    #     secretName: chouse-tls     # (e.g. Tailscale Funnel)
```

Three exposure options for the MCP endpoint: the dedicated **Service**
(in-cluster; `type: LoadBalancer`/`NodePort` for direct access), the
**ingress path** (`https://<host>/mcp` — TLS on 80/443, no non-standard
port), or both.

MCP is **disabled by default** everywhere. In development it is on, bound to
`localhost`. The chart renders the `mcp:` block into the pod environment and
creates the dedicated Service plus a NetworkPolicy port rule, so agent
traffic can be scoped separately from the public UI origin. `helm` refuses
renders where `allowWrites`/`allowDestructive` are set without `enabled`,
or where `mcp.ingress.enabled` is set without the listener or any host.
The MCP ingress follows the UI ingress pattern exactly: `className`,
`annotations`, and `tls` are rendered verbatim from `mcp.ingress.*` — no
inheritance, no merging (copy what the UI ingress has when you want the
same certificate or issuer). The container keeps listening on 8752 and the
ingress routes the path to the dedicated Service.

## Mint a token

Preferences → Personal access tokens → create. The token can be scoped: a
token with only `table:select, metrics:view` caps the agent regardless of the
server toolsets. Every call re-checks live roles ∩ token scopes — revoke,
demotion, or deactivation take effect on the **next** tool call.

## Try the hosted lab

**https://mcp.chouse-ui.com/mcp** is a live, hosted instance of this server.
Mint a personal access token in the lab UI (same Preferences flow, same
`ch_pat_…` format), point any MCP client below at the endpoint, and evaluate
the toolset without deploying anything. The lab runs the default-safe policy
(read-only; writes and destructive tools off), so it is safe to experiment
with — self-host when you need the write/ops toolsets. Smoke test:

```bash
curl -s https://mcp.chouse-ui.com/mcp \
  -H "Authorization: Bearer ch_pat_…" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Client configuration

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

**Cursor** (`.cursor/mcp.json`) and **Claude Desktop**
(`claude_desktop_config.json`) use the same shape:

```jsonc
{
  "mcpServers": {
    "chouse": {
      "type": "http",
      "url": "http://127.0.0.1:8752/mcp",
      "headers": { "Authorization": "Bearer ch_pat_…" }
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
curl -s http://chouse.internal:8752/mcp \
  -H "Authorization: Bearer $CH_HOUSE_PAT" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Note on `Origin`: requests carrying an `Origin` header are rejected unless the
origin is in `MCP_ALLOWED_ORIGINS` (DNS-rebinding protection). Headerless
clients (curl, CI agents) always pass.

## Tools

Toolsets (default: `core,explore,query,observe,ops`):

| Toolset | Tools |
|---|---|
| core | `whoami`, `list_connections`, `use_connection` |
| explore | `list_databases`, `list_tables`, `describe_table`, `sample_table` (≤20 rows) |
| query | `query` (SELECT-only), `explain_query`, `list_saved_queries`, `get_saved_query`, `run_saved_query` (write definitions refused) |
| observe | `metrics_overview`, `live_queries`, `fleet_snapshots`, `list_scheduled_jobs`, `get_scheduled_job`, `list_scheduled_runs`, `list_health_checks`, `get_health_check`, `health_timeline`, `list_alerts`, `audit_list` |
| writes (needs `MCP_ALLOW_WRITES`) | `create_saved_query`, `run_scheduled_job`, `run_health_check`, `acknowledge_incident`, `test_alert_channel` |
| destructive (needs `MCP_ALLOW_DESTRUCTIVE`) | `kill_query`, `query_raw`, `delete_saved_query`, `delete_scheduled_job` |
| ai (opt-in, LLM spend) | `ai_optimize`, `doctor_scan`, `doctor_reports`, `get_doctor_report` |

Resources: `chouse://connection/{id}`, `chouse://database/{name}`,
`chouse://table/{db}/{table}`, `chouse://saved-query/{id}`,
`chouse://scheduled-job/{id}`, `chouse://health-check/{id}`,
`chouse://doctor-report/{id}`.

Prompts: `investigate-slow-query`, `diagnose-incident`, `review-schema`,
`plan-schema-migration`.

Every tool call is attributed in the audit log (`mcp.tool_call`) to the PAT's
user, alongside the route-level audit entries the projected API already writes.

## Human approval per client

Destructive tools run under the operator's flags and the token's scopes —
approval by a human happens in the **client**, via each host's native
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
| CI / headless | no human present | none — flags + scoped PATs are the only layer |

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
pipelines) have no human to ask — the operator's flags and a narrowly scoped
PAT are the only guardrails there. Never mint a destructive-capable PAT for
unattended use unless the operator explicitly accepts that trade-off.

## Safety model

1. **Read-only by default.** Write/destructive tools are not registered unless
   the operator enables them — an agent cannot opt in.
2. **SQL classification** reuses the AST-based parser that guards the API:
   `query` accepts a single SELECT/WITH/SHOW/DESCRIBE/EXPLAIN; anything else
   (including multi-statement input) fails closed.
3. **Human approval happens in the client** ([ADR 0014](adr/0014-mcp-destructive-client-approval.md)):
   destructive tools execute under the operator's flags and the PAT's scopes,
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

Connection scoping: pass `X-Connection-Id` as a request header or a
`connection_id` tool argument; otherwise the caller's default connection is
used (same resolution as the CLI). Nothing is pinned server-side — the
protocol is stateless and multi-replica safe.

## End-to-end

`./scripts/e2e-mcp.sh` builds the server from the working tree, boots the
compose stack with `MCP_ENABLED=true` on DinD, and runs
`scripts/e2e-mcp-check.py` inside the compose network: PAT auth, read-only
toolset, SELECT through ClickHouse, write refusal, Origin/JWT rejection, and
PAT-revocation taking effect on the next call. Sequential runs only.
