# What's new in 3.15

3.15 makes the AI agent registry easy to start from, shows what CHouse's own AI costs and sends out, and makes data observability much cheaper to run on busy clusters. Describe an agent, harness or skill and review a complete draft that only uses what exists in your registry; and decide how often observability reads each cluster, with what that costs in front of you.

## Highlights

**Draft with AI** — **New agent**, **New harness** and **New skill** in **AI Governance › Assistant** get a **Draft with AI** button. Describe the goal in plain language, and Chouse AI fills in every section of the editor — prompt, tools, skills, subagents, harness and tuning for an agent; a decision for every built-in tool for a harness — each pick with a reason. A section left empty says why, and one that still needs work is flagged instead of left blank. Unknown tools and skills are dropped, slugs made unique and permissions worked out from the tools before the draft reaches you. Nothing is saved until you press **Create**. → [Draft with AI](/docs/ai-draft-with-ai/)

**Skills from a runbook** — Paste a runbook or doc into a skill draft, and it comes back as a `SKILL.md` that says when to use it, with a step-by-step procedure, examples and pitfalls, and long material split into linked reference files. → [Starting a draft](/docs/ai-draft-with-ai/#starting-a-draft)

**Redraft and refine** — Redraft any single section, or refine a draft — or any custom agent, harness or skill — with an instruction such as "make it stricter about DDL". You review the result before saving, as always. → [Refine with AI](/docs/ai-draft-with-ai/#refine-with-ai)

**AI activity** — A new **AI Governance › AI activity** tab shows what CHouse's own AI costs and what it sends out. Every chat and AI feature request is recorded with its tokens, an estimated cost from the price you give each model, the ClickHouse queries it ran and what they read, and the tables, columns and CHouse records that reached the LLM provider. Open a request to follow it call by call, down to the query in Query logs. Prompt and response text are not stored. → [AI activity](/docs/ai-usage/)

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

The full list of changes is in the [changelog](https://github.com/daun-gatal/chouse-ui/blob/main/CHANGELOG.md).
