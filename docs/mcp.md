# CHouse MCP Server

AI agents (Cursor, VS Code Copilot, OpenCode, Claude Desktop, CI pipelines) can
operate CHouse UI without the browser through a **Model Context Protocol**
endpoint on a dedicated port. Authentication is a personal access token
(`ch_pat_…`, [ADR 0011](adr/0011-personal-access-tokens.md)); the transport is
**Streamable HTTP** ([ADR 0013](adr/0013-chouse-mcp.md)). Safe by default:
read-only unless the operator enables writes, and destructive tools always
require human approval in the agent host.

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
  ingress:
    # Optional: expose the endpoint at https://<host>/mcp through the
    # ingress (TLS on 80/443) instead of a non-standard client-facing port.
    # host: ""             # defaults to the main ingress host
    enabled: true
```

MCP is **disabled by default** everywhere. In development it is on, bound to
`localhost`. The chart renders the `mcp:` block into the pod environment and
creates a dedicated ClusterIP Service (`<release>-mcp`) plus a NetworkPolicy
port rule, so agent traffic can be scoped separately from the public UI
origin. `helm` refuses renders where `allowWrites`/`allowDestructive` are set
without `enabled`, or where `mcp.ingress.enabled` is set without the
listener. With `mcp.ingress.enabled`, agents use `https://<host>/mcp`
(no port); the container keeps listening on 8752 and the ingress routes the
path to the dedicated Service. Because MCP streams over SSE, the ingress
needs the same annotations as AI chat (raise the proxy read timeout and
disable buffering — nginx: `proxy-read-timeout: "300"`,
`proxy-buffering: "off"`).

## Mint a token

Preferences → Personal access tokens → create. The token can be scoped: a
token with only `table:select, metrics:view` caps the agent regardless of the
server toolsets. Every call re-checks live roles ∩ token scopes — revoke,
demotion, or deactivation take effect on the **next** tool call.

## Client configuration

**OpenCode** (`opencode.json`; `oauth: false` disables auto-OAuth):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "chouse": {
      "type": "remote",
      "url": "https://chouse.corp/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:CH_HOUSE_PAT}",
        "X-Connection-Id": "{env:CHOUSE_CONNECTION}"
      }
    }
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
| destructive (needs `MCP_ALLOW_DESTRUCTIVE` + elicitation) | `kill_query`, `query_raw`, `delete_saved_query`, `delete_scheduled_job` |
| ai (opt-in, LLM spend) | `ai_optimize`, `doctor_scan`, `doctor_reports`, `get_doctor_report` |

Resources: `chouse://connection/{id}`, `chouse://database/{name}`,
`chouse://table/{db}/{table}`, `chouse://saved-query/{id}`,
`chouse://scheduled-job/{id}`, `chouse://health-check/{id}`,
`chouse://doctor-report/{id}`.

Prompts: `investigate-slow-query`, `diagnose-incident`, `review-schema`,
`plan-schema-migration`.

Every tool call is attributed in the audit log (`mcp.tool_call`) to the PAT's
user, alongside the route-level audit entries the projected API already writes.

## Safety model

1. **Read-only by default.** Write/destructive tools are not registered unless
   the operator enables them — an agent cannot opt in.
2. **SQL classification** reuses the AST-based parser that guards the API:
   `query` accepts a single SELECT/WITH/SHOW/DESCRIBE/EXPLAIN; anything else
   (including multi-statement input) fails closed.
3. **Destructive tools need a human:** every call runs an MCP elicitation
   prompt in the agent host; hosts without elicitation support get a
   fail-closed refusal pointing at the UI/CLI.
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
