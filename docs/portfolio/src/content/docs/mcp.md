---
app: Agents › MCP
route: /agents/mcp
permissions: agents:view
---
# MCP server

AI agents (Claude Code, Codex, Cursor, VS Code Copilot, OpenCode, CI pipelines) can operate CHouse UI without the browser through a **Model Context Protocol** endpoint at **`/mcp` on the same address as the UI** — no extra port, Service or Ingress. Transport: **Streamable HTTP**. Authentication: a [personal access token](/docs/personal-access-tokens/) (`Authorization: Bearer ch_pat_…`), verified live against RBAC on every call.

Safe by default: the endpoint is **off** until an administrator turns it on, only **read-only** tools are on until an administrator turns on more, and destructive tools are approved by a human through the client's permission prompt before they run.

## Turn it on

1. Sign in with `agents:manage` (Admin and Super Admin by default) and open **Agents › MCP**.
2. Switch **MCP server** on. The page shows the endpoint, e.g. `https://chouse.corp/mcp`: the address you opened the UI on, unless the server sets `PUBLIC_BASE_URL` or you fill in **Public address** (for agents that reach CHouse UI on another address — a port-forward, an internal IP, another Ingress host). It warns when the endpoint is `localhost`.
3. Optionally add **allowed origins** (only browser-based agent hosts send one) and change the **tool call timeout** (default 60 s).
4. Review the **Tools** list and turn on what your agents need.

Changes reach every replica within seconds, without a restart, and are audited. There is nothing to set in Docker or Helm. Behind a proxy that buffers responses, turn buffering off and raise the read timeout for the UI host — MCP streams over SSE, like AI chat.

> **Upgrading from 3.13:** port `8752`, the `MCP_*` variables and the chart's `mcp.*` values are gone. Point agents at `https://<host>/mcp` and turn MCP on in Agents › MCP — it starts off after the upgrade.

## Mint a token

Preferences → Personal access tokens → create a token for the agent, then export it as `CH_HOUSE_PAT`. One token per agent keeps revocation surgical, and a token scoped to fewer permissions sees fewer tools.

## Connect a client

Agents › MCP has copy-ready setup for each client with your endpoint filled in, and the CLI prints it for your profile (`chouse mcp config claude-code`). The token always comes from the `CH_HOUSE_PAT` environment variable or a secret prompt — never paste it into a config file. With the endpoint at `https://chouse.corp/mcp`:

:::tabs
@tab Claude Code
Terminal (add `--scope user` for every project):

```bash
claude mcp add --transport http chouse https://chouse.corp/mcp \
  --header "Authorization: Bearer $CH_HOUSE_PAT"
```
@tab Codex CLI
```bash
codex mcp add chouse --url https://chouse.corp/mcp --bearer-token-env-var CH_HOUSE_PAT
```
@tab Cursor
`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "chouse": {
      "url": "https://chouse.corp/mcp",
      "headers": {
        "Authorization": "Bearer ${env:CH_HOUSE_PAT}"
      }
    }
  }
}
```
@tab VS Code
`.vscode/mcp.json` — VS Code prompts for the token and stores it as a secret:

```json
{
  "servers": {
    "chouse": {
      "type": "http",
      "url": "https://chouse.corp/mcp",
      "headers": {
        "Authorization": "Bearer ${input:chouse_pat}"
      }
    }
  },
  "inputs": [
    {
      "id": "chouse_pat",
      "type": "promptString",
      "description": "CHouse UI personal access token",
      "password": true
    }
  ]
}
```
@tab OpenCode
`opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "chouse": {
      "type": "remote",
      "url": "https://chouse.corp/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:CH_HOUSE_PAT}"
      },
      "timeout": 60000
    }
  }
}
```
@tab curl
Smoke test — lists the tools your token gets:

```bash
curl -s https://chouse.corp/mcp \
  -H "Authorization: Bearer $CH_HOUSE_PAT" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
:::

Headerless clients (curl, CLI and desktop agents) always pass origin checks; requests that carry an `Origin` must match the allowed origins (DNS-rebinding protection).

## Tools

Every tool has a description, an access level and the permissions it needs, shown in Agents › MCP with its parameters. Switch tools on or off one at a time or per category:

| Access | Default | Examples |
| --- | --- | --- |
| Read | On | `query` (SELECT-only), `describe_table`, `get_dataset_health`, `get_lineage`, `metrics_overview` |
| Write | Off | `create_saved_query`, `run_health_check`, `acknowledge_incident`, `propose_remediation` |
| Destructive | Off | `kill_query`, `query_raw`, `delete_saved_query`, `delete_scheduled_job` |
| Spends LLM budget | Off | `ai_optimize`, `doctor_scan` |

An agent only sees tools that are on **and** that its token's permissions allow, so it never carries a tool it would be refused. Turning on a tool that changes or deletes things asks for confirmation.

## Human approval per client

Destructive tools use the client's own permission system: the agent must ask, and the human approves in the host before the tool runs. The tool switches are the hard ceiling — agents can never turn a tool on themselves.

## Safety model

| Layer | Guarantee |
| --- | --- |
| RBAC | Every tool call verified live against the token owner's permissions and data access |
| Tool switches | Writes, destructive and LLM-spending tools off by default; only administrators change them |
| Human approval | Client-side prompt for destructive tools |
| Governance | Budgets, health notices and a pause switch on the [Agents](/docs/agents/) page |
| Audit | Every call and every settings change lands in the [audit log](/docs/audit-log/) |

Full reference: [`docs/mcp.md`](https://github.com/daun-gatal/chouse-ui/blob/main/docs/mcp.md), [ADR 0013](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0013-chouse-mcp.md) and [ADR 0017](https://github.com/daun-gatal/chouse-ui/blob/main/docs/adr/0017-mcp-managed-in-the-ui.md).
