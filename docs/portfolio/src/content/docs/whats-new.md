# What's new in 3.14

3.14 moves CHouse UI from watching clusters to watching the **data itself** — every table, every ingestion source — and adds a way to fix what it finds, safely. Every AI feature now runs on an agent you manage in the UI, MCP moved into the UI, and the CLI reached 1.0.

## Highlights

**Data observability** — The new **Data** page replaces DataOps and answers *is the data right, right now?* for every table, without scanning them. Freshness and volume baselines are learned from metadata from day one, every table gets a trust state, and criticality comes from real reads. → [How data is watched](/docs/data-observability/)

**Pipelines and lineage** — Materialized and refreshable views, Kafka, RabbitMQ, NATS, S3Queue, AzureQueue, MaterializedPostgreSQL/MySQL, external tables, `Distributed` inserts, dictionaries, async inserts, writers and scheduled jobs share one status vocabulary, and hidden failures surface as incidents. Lineage is built from metadata and `query_log`, with no instrumentation. → [Pipelines](/docs/data-pipelines/), [Lineage](/docs/data-lineage/)

**Root cause and approved fixes** — Incidents walk from the data symptom down to the engine with the evidence for each step and the blast radius. Fixes come from a closed catalog, run under a separate credential and only after approval (two approvers for high-impact changes), are verified, and can be rolled back. Approve in the UI, Slack or the CLI. → [Incidents, root cause & fixes](/docs/data-incidents/)

**Schema change preflight** — DDL that would break a view, dictionary, job, promise or saved query is stopped with the impact, unless someone with `schema:override` confirms. → [Schema preflight](/docs/data-incidents/#schema-change-preflight)

**Context for people and agents** — Table descriptions, owners, grain and canonical metrics, dbt import, Chouse AI drafts of the empty fields (built from metadata and summary numbers, never raw rows), and plain-language watchers that become promises. → [Context](/docs/data-context/)

**Monitoring: Performance, Capacity, Upgrades** — Regressions against each query's own baseline next to the changes around them; disk forecasts, codec trials and cost; upgrade readiness against your workload with canary replay. → [Performance](/docs/monitoring-performance/), [Capacity](/docs/monitoring-capacity/), [Upgrades](/docs/monitoring-upgrades/)

**Agents** — Every MCP and token session with what it read and cost, budgets checked with `EXPLAIN ESTIMATE` before queries run, health notices in results, and a pause switch. → [AI Governance](/docs/agents/)

**AI agents in the UI** — Every AI feature — the chat, Optimize and Debug, the Doctor scan, the diagnoses, the DataOps and observability assistants — runs on an agent you can see and change in **AI Governance › Assistant**: its prompt, model, read-only tools, skills, subagents and limits. Test a change on your own connection before you save it, roll back any version, and keep receiving CHouse's improvements to the built-ins you haven't changed. → [AI agents](/docs/ai-agents/), [Customize an AI feature](/docs/guide-customize-an-ai-feature/)

**Chat about CHouse itself** — The chat has an agent picker. *CHouse Admin* answers read-only questions about CHouse — who can do what, what failed overnight, what changed this week — through its API as you, so it never shows more than your screens would. *Auto* routes each question to it or to *ClickHouse Data* and combines the answers. → [Chat agents](/docs/ai-chat-agents/)

**MCP in the UI** — The MCP endpoint is at `/mcp` on the web port and managed in **AI Governance › MCP**: turn it on, set allowed origins and timeout, and switch each tool on or off. Agents only see tools that are on and that their token allows. → [MCP](/docs/mcp/), [tool catalog](/docs/mcp-tools/)

**CLI 1.0** — Tables in a terminal and JSON when piped, a hidden-prompt login, profiles, connection names, retries, `--debug`, custom CA trust, and new `health`, `lineage`, `incidents`, `remediation`, `mcp` and `agents` commands. → [CLI](/docs/cli/), [command reference](/docs/cli-reference/)

**Also** — Cluster-aware scheduled-query destinations (`Replicated*` on every replica, or per-shard tables plus a `Distributed` table), a `distribution` promise check, Doctor reports as notebooks with fixes, and role cards grouped by the server's permission categories.

## Upgrading from 3.13

Migrations run on start; nothing to run by hand. Check these:

| What changed | What to do |
| --- | --- |
| MCP moved to `/mcp` on the web port; port 8752 and all `MCP_*` settings (and `mcp.*` YAML keys) are removed | Remove them. After the upgrade, turn MCP on in **AI Governance › MCP** (it starts **off**) and point agents at `https://<your host>/mcp` |
| Helm chart **2.0**: `mcp.*` values, the `<release>-mcp` Service and the MCP Ingress are removed | Remove `mcp:` from your values; nothing else changes |
| Fleet collection always runs; `FLEET_POLLER_ENABLED` is ignored | Remove it. `FLEET_POLL_INTERVAL_SECONDS` still works; `OBSERVE_FLEET_INTERVAL` wins |
| DataOps became **Data** | Old `/dataops/*` links redirect |
| 15 new permissions (`observe:*`, `remediation:*`, `agents:*`, …) | Built-in roles get their defaults automatically. Add them to custom roles that should use the new pages — see the [permission catalog](/docs/permissions/) |
| AI prompts, tools and skills moved from code into the metadata database as built-in agents | Nothing to do: they are installed on first start and behave as before. Give `ai_agents:view` / `ai_agents:manage` to custom roles that should see or edit them in **AI Governance › Assistant** (Admin and Super Admin have both) |
| AI skills now actually load — before 3.14 the built-in skills were never offered to the model, and Bedrock deployments had extra planning and file tools | Expect AI answers to change slightly (usually better grounded). Raise an agent's step budget if a feature starts stopping at its step limit |
| The collector reads more system tables | Open **Admin › Connections › Edit › Check privileges** for each connection and run the `GRANT`s it lists |
| CLI 1.0 changed some commands and output | Re-check scripts: JSON is the default when piped, unknown subcommands now fail, and a few commands that only pointed at the UI were removed — see the CLI changelog |

To use fixes, add a remediation credential to each connection; for Slack approvals, set the `SLACK_*` variables. See [Set up fixes](/docs/data-incidents/#set-up-fixes-for-a-connection).

The full list of changes is in the [changelog](https://github.com/daun-gatal/chouse-ui/blob/main/CHANGELOG.md).
