# Agents & governance

**Agents** (`/agents`, `agents:view`) shows every AI agent connected over [MCP](/docs/mcp/) or a [personal access token](/docs/personal-access-tokens/): what it read, what it cost, and whether the data it answered from was healthy.

## Sessions

Each session lists queries, bytes read, share of the daily budget, warnings and blocks. Open one to replay its tool calls — `get_table_context`, `get_dataset_health`, then `query` — with the health notices attached to each result. Every agent query is tagged in `log_comment`, so `system.query_log` attributes it too. Arguments of other users' sessions are hidden without `query:history:view:all`.

## Policies

Budget policies apply to every agent, a role, or one token — the most specific wins (`agents:manage` to edit):

| Setting | Effect |
| --- | --- |
| Max read per query | Estimated with `EXPLAIN ESTIMATE` before the query runs; larger reads are blocked |
| Daily read budget | Across all of the agent's queries |
| Partition filter above N GiB | Large tables must be read with a partition filter |
| Tables with a critical incident | **warn** (attach a notice), **block**, or ignore |
| Alert at × usual usage | Flags runaway agents |

**Pause all agent access** refuses every MCP tool call and every token-authenticated query until resumed. People using the UI are not affected.

## What agents get

The MCP server adds `get_dataset_health`, `get_lineage`, `get_table_context`, `get_metric`, `get_pipeline_status` and `list_incidents`, and — with `MCP_ALLOW_WRITES` — `propose_remediation`. There is no approve tool: an agent's proposal always waits for a person. Query results carry health notices ("this table has an open incident; say so in the answer").
