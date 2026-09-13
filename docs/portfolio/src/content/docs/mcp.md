# MCP server

AI agents (Cursor, VS Code Copilot, OpenCode, Claude Desktop, CI pipelines) can operate CHouse UI without the browser through a **Model Context Protocol** endpoint on a dedicated port (**8752**). Transport: **Streamable HTTP**. Authentication: a [personal access token](/docs/personal-access-tokens/) (`Authorization: Bearer ch_pat_…`), verified live against RBAC on every call.

Safe by default: **read-only** unless the operator enables writes, and destructive tools are approved by a human through the client's permission prompt before they run.

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
  # allowWrites: false   # server-side policy — agents can never opt in
  # allowDestructive: false
  # toolsets: [core, explore, query, observe, ops]
  # allowedOrigins: []
  service:
    type: ClusterIP      # NodePort/LoadBalancer expose MCP directly (no Ingress)
  ingress:
    enabled: true
    hosts:
      - host: chouse.corp
    annotations:         # MCP streams over SSE: raise read timeout, disable buffering
      nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
      nginx.ingress.kubernetes.io/proxy-buffering: "off"
```

Three exposure options: the dedicated **Service** (in-cluster), the **ingress path** (`https://<host>/mcp`), or both.

## Mint a token

Preferences → Personal access tokens → create a token for the agent, then reference it in the client config. One token per agent keeps revocation surgical.

## Client configuration (OpenCode example)

```json
{
  "mcpServers": {
    "chouse": {
      "url": "http://chouse.corp:8752/mcp",
      "headers": { "Authorization": "Bearer ch_pat_…" }
    }
  }
}
```

The endpoint also works behind the ingress at `https://<host>/mcp`. Headerless clients (curl, CI) always pass origin checks; browser-origin requests must match `MCP_ALLOWED_ORIGINS` (DNS-rebinding protection).

## Toolsets

| Toolset | Contents |
| --- | --- |
| `core` | Connection/session basics |
| `explore` | Database/table discovery |
| `query` | Running queries (read by default) |
| `observe` | Monitoring reads (logs, metrics, live queries…) |
| `ops` | Operational state — live queries, scheduled jobs, health |
| `writes` | Opt-in: create/run/ack actions (needs `MCP_ALLOW_WRITES`) |
| `destructive` | Opt-in: KILL, raw SQL, deletes (needs writes + `MCP_ALLOW_DESTRUCTIVE`) |
| `ai` | Opt-in: LLM-spending tools |

## Human approval per client

Destructive tools use the client's own permission system: the agent must ask, the human approves in-host (MCP elicitation) before the tool runs. The server-side policy (`allowWrites`/`allowDestructive`) is the hard ceiling — agents can never opt themselves into writes.

## Safety model

| Layer | Guarantee |
| --- | --- |
| RBAC | Every tool call verified live against the token owner's permissions |
| Server policy | Writes/destructive disabled by default; agents cannot enable them |
| Human approval | Client-side prompt for destructive tools |
| Audit | All usage lands in the [audit log](/docs/audit-log/) |

Full reference: [`docs/mcp.md`](https://github.com/daun-gatal/chouse-ui/blob/main/docs/mcp.md) and [ADR 0013](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0013-chouse-mcp.md).
