# What's new in 3.15

3.15 lets you chart what matters for your own tables, makes the AI agent registry easy to start from, shows what CHouse's own AI costs and sends out, and makes data observability much cheaper to run on busy clusters. Build dashboards, or describe one and review a draft that is checked against your data; describe an agent, harness or skill and review a complete draft that only uses what exists in your registry; and decide how often observability reads each cluster, with what that costs in front of you.

## Highlights

**Dashboards** — A new **Dashboards** page holds your own charts of ClickHouse. Each panel is a read-only query with a chart; a dashboard adds a time range, variables and auto-refresh. Every panel runs with each viewer's own data access, so a shared dashboard never shows anyone more than they could query. Start from six curated templates (latency, merges and parts, replication, disk, ingestion) or **Open as dashboard** on Performance and Capacity, or pin a chart from the SQL workspace's new **Chart** tab. Results are shared between viewers for 30 seconds, and every query is capped and fails loudly instead of being cut short. → [Dashboards](/docs/dashboards/)

**Panel alerts and fleet panels** — Put a threshold alert on any panel and get notified on your existing channels when it fires, resolves or can't be evaluated. A fleet panel runs on every connection you can use, one line per connection. → [Panel alerts](/docs/dashboards/#panel-alerts), [Fleet panels](/docs/dashboards/#fleet-panels)

**Draft a dashboard with AI** — Describe what to watch, and Chouse AI drafts the panels. Every panel is checked and dry-run with your access before you see it; nothing is saved until you accept. Dashboards are also code: `chouse dashboard export|apply` and MCP tools manage them as JSON. → [Draft dashboards with AI](/docs/dashboards-ai/)

**Draft with AI** — **New agent**, **New harness** and **New skill** in **AI Governance › Assistant** get a **Draft with AI** button. Describe the goal in plain language, and Chouse AI fills in every section of the editor — prompt, tools, skills, subagents, harness and tuning for an agent; a decision for every built-in tool for a harness — each pick with a reason. A section left empty says why, and one that still needs work is flagged instead of left blank. Unknown tools and skills are dropped, slugs made unique and permissions worked out from the tools before the draft reaches you. Nothing is saved until you press **Create**. → [Draft with AI](/docs/ai-draft-with-ai/)

**Skills from a runbook** — Paste a runbook or doc into a skill draft, and it comes back as a `SKILL.md` that says when to use it, with a step-by-step procedure, examples and pitfalls, and long material split into linked reference files. → [Starting a draft](/docs/ai-draft-with-ai/#starting-a-draft)

**Redraft and refine** — Redraft any single section, or refine a draft — or any custom agent, harness or skill — with an instruction such as "make it stricter about DDL". You review the result before saving, as always. → [Refine with AI](/docs/ai-draft-with-ai/#refine-with-ai)

**AI activity** — A new **AI Governance › AI activity** tab shows what CHouse's own AI costs and what it sends out. Every chat and AI feature request is recorded with its tokens, an estimated cost from the price you give each model, the ClickHouse queries it ran and what they read, and the tables, columns and CHouse records that reached the LLM provider. Open a request to follow it call by call, down to the query in Query logs. Prompt and response text are not stored. → [AI activity](/docs/ai-usage/)

**Where AI requests come from** — AI activity records who started each request: the UI, an MCP agent, a token caller such as the `chouse` CLI, or CHouse in the background, with the agent's name and the token it used. Filter the request list by origin, see tokens and cost split by origin, and find the requests of one token by its name. → [Where a request came from](/docs/ai-usage/#where-a-request-came-from)

**Agents and the CLI see what's new** — Seventeen new read-only [MCP tools](/docs/mcp-tools/) cover AI usage, data egress, AI requests and the agent registry; query regressions, capacity, upgrade assessments, canary replays and rollout; collector status and schedule; remediation actions and investigation notebooks. They are on by default and listed only for tokens with the matching permission. The [CLI](/docs/cli/) gets the same reads (`chouse ai usage|egress|requests|agents`, `chouse perf`, `chouse capacity`, `chouse upgrades`, `chouse collectors`, `chouse context`, `chouse notebook`), and *CHouse Admin* in the chat now answers questions about them too. → [MCP tools](/docs/mcp-tools/), [CLI](/docs/cli/), [Chat agents](/docs/ai-chat-agents/#chouse-admin)

**Collection schedule** — **Admin › Connections › Collection schedule** sets how often each observability collector runs, for every connection, and a connection's **Edit** dialog can set its own. Pause a collector you don't need; a paused one is named on the Data page so its stale pages are no surprise. Each collector shows what its last run read and what that adds up to per day at the interval you pick, so you can see where the load comes from before changing anything. Changes apply within seconds on every server. → [Collection schedule](/docs/connections/#collection-schedule)

**Lighter collection** — The *Usage* collector no longer scans 30 days of `system.query_log` — including every query's text — on every run: it reads only the rows since its last run and keeps daily rollups. On the lab clusters that scan was about 88% of everything collection read from ClickHouse, and it grew with every query the cluster ran. *Table baselines* reads only new `system.part_log` rows for write cadence. → [How often it runs](/docs/data-observability/#how-often-it-runs)

## Upgrading from 3.14

Migrations run on start; nothing to run by hand. Check these:

| What changed | What to do |
| --- | --- |
| Three built-in drafter agents (*Agent Author*, *Harness Author*, *Skill Author*) and their features are installed on start | Nothing to do. Drafting needs `ai_agents:manage` and `ai:optimize`; Admin and Super Admin have both |
| Usage rebuilds its 30 days of query shapes from the newest days back, 3 days per run | Nothing to do. Filter columns and query patterns come back on the first run and are complete after about 2½ hours |
| `OBSERVE_FLEET_INTERVAL` now sets only the built-in fleet interval | Nothing to do; an interval set in **Collection schedule** wins over it |
| New permission `ai_usage:view` (everyone's AI usage), granted to Admin and Super Admin | Grant it to custom roles that should see everyone's AI cost and data egress; users with `ai:chat` or `ai:optimize` see their own requests without it |
| AI cost needs a price per model | Optional: add prices in **Admin › AI Models › Provider models**; without one, AI activity shows tokens only |
| New permissions `dashboards:view`, `dashboards:edit`, `dashboards:delete`, `dashboards:share` and `dashboards:manage`: Viewer gets view; Analyst view, edit and delete; Developer also share; Admin all | Grant them to custom roles that should see or build dashboards. Panels still need `query:execute` and the tables in the role's data access rules |
| A built-in *Dashboard Drafter* agent and its feature are installed on start | Nothing to do. Drafting needs `dashboards:edit` and `ai:optimize` |
| Dashboard panel alerts run with the Scheduled Queries scheduler | Nothing to do. With `SCHEDULED_QUERIES_ENABLED=false` on web pods, the dedicated scheduler evaluates them |
| New read-only MCP tools are on by default | Nothing to do; a token only lists the ones its permissions allow. To keep any of them away from agents, switch them off in **AI Governance › MCP** |
| *Operations Analyst* and *Platform Auditor* get new tools on start (the Operations Analyst also reads dashboards) | Nothing to do for built-in agents. If you customized one, it shows **Update available** in **AI Governance › Assistant**: reset it, or add the new tools yourself |

The full list of changes is in the [changelog](https://github.com/daun-gatal/chouse-ui/blob/main/CHANGELOG.md).
