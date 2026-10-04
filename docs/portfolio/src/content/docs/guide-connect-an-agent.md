# Connect an AI agent

This guide connects Claude Code (or any MCP client) to CHouse UI with a token that can only read, then shows how to watch what it does. Two people may be involved: an administrator with `agents:manage`, and you.

## 1. Administrator: turn MCP on

1. **Agents › MCP** → switch **MCP server** on.
2. Check the endpoint shown, e.g. `https://chouse.corp/mcp`. If agents reach CHouse UI on another address, set **Public address**.
3. Leave the tool defaults — read tools on, everything else off — for now.

## 2. You: create a narrow token

**Preferences › Personal access tokens › New token**:

- **Name**: `claude-code-laptop`
- **Expiry**: 30 days
- **Scopes**: only what the agent needs, e.g. `database:view`, `table:view`, `table:select`, `query:execute`, `observe:view`

Copy the token and keep it in your environment, never in a config file:

```bash
export CH_HOUSE_PAT=ch_pat_…
```

## 3. Register the server with the client

:::tabs
@tab Claude Code
```bash
claude mcp add --transport http chouse https://chouse.corp/mcp \
  --header "Authorization: Bearer $CH_HOUSE_PAT"
```
@tab Any client (via the CLI)
```bash
chouse mcp config claude-code    # or codex, cursor, vscode, opencode
```
:::

Other clients: [MCP › Connect a client](/docs/mcp/#connect-a-client).

## 4. Check what the agent can do

```bash
chouse mcp status    # on/off, endpoint, and the tools your token gets
chouse mcp tools
```

Ask the agent something real — *"which tables in `shop` are stale, and what feeds them?"*. It should call `get_dataset_health` and `get_lineage`, and read `get_table_context` before writing SQL.

## 5. Watch it

**Agents › Sessions** shows the session: every tool call, bytes read, budget used and any health notices it received. Administrators can set limits in **Agents › Policies** — max read per query, a daily budget, partition filters on large tables, and what to do with tables that have incidents — or **pause all agent access** at once.

## 6. Give it more, carefully

To let the agent kill queries or run DDL, an administrator turns those tools on in **Agents › MCP** (with a confirmation), *and* your token needs the matching permissions. Make destructive calls ask you first in the client — see [Human approval per client](/docs/mcp/#human-approval-per-client).
