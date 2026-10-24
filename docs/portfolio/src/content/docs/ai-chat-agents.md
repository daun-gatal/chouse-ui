---
app: Chobi › Chat › Chat agent
permissions: ai:chat
---
# Chat agents

The chat in [Chobi](/docs/chobi/) talks to **CHouse Assistant** by default: one agent that answers, investigates with read-only helpers, and makes changes for you — each checked by its [tier](/docs/ai-approvals/#tiers). Administrators can add their own chat agents in [AI Governance › Assistant](/docs/ai-agents/).

## CHouse Assistant

One main agent owns the conversation, your page, its memory and **every write**:

- **Core tools**, always there: your schema, read-only SQL, charts, who you are.
- **Toolkits** of write tools: *Data & Query* and the toolkit of the page you chat from are loaded up front; the assistant loads others (Scheduling, Data Health, Observe & Ops, Dashboards & Context, Access, Platform & Audit) with `load_toolkit` when your question needs them. Only tools you hold a permission for appear, so the model chooses among a few dozen tools, not all 74.
- **Your screen.** `navigate` and `open_entity` open a CHouse page or item in your browser; `fill_form` puts SQL in a new editor tab for you to review. Nothing is saved or run by them, and they only ever open CHouse's own pages.
- **Plans.** For two or more changes it lists the plan first, then asks for them together, so you confirm once.

It knows which page you opened Chobi on (*this dashboard*, *this incident*) and uses that as context.

### Investigators

For deep or broad read-only questions it delegates to an investigator with its own context. Investigators can't change anything, and what they return counts as data, never instructions:

| Investigator | Covers |
| --- | --- |
| **ClickHouse Data** | Databases, tables, columns, SQL, query performance, running and slow queries, server info and charts — on your active connection |
| **Operations Analyst** | Scheduled jobs and runs, Data Health promises and incidents, alerting, observability incidents with their fixes and notebooks, Doctor reports, the fleet, query regressions, capacity, upgrades, collectors, dashboards |
| **Access Auditor** | Users, roles and permissions, data access policies, your personal access tokens (never the secret), SSO, ClickHouse users and roles |
| **Platform Auditor** | Connections, AI models, CHouse's AI agents and which feature runs which, [AI activity](/docs/ai-usage/) (usage, cost, data sent to providers), guardrails, external agents and MCP settings, the audit log |

Things to ask:

- *Who can edit connections?* — the Access Auditor finds the roles holding `connections:edit` and the users holding those roles.
- *What failed overnight, and pause the job that keeps failing.* — the Operations Analyst finds it; the assistant pauses it, undoably.
- *Keep an eye on shop.orders until tomorrow.* — a [watch](/docs/data-health/#watches).
- *Create a dashboard of inserts per minute and open it.*

An investigator only gets the tools for which you hold a permission. Ask about users without `users:view` and the answer says you lack access to that area — the agent doesn't try to work around it. Results are capped (100 rows) and secrets such as SSO client secrets, channel webhooks and API keys are redacted before the model sees them.

## The agent picker

The **Chat agent** menu next to the model picker lists every chat agent you may use (it appears when there is more than one, on screens wider than a phone). The default is the agent bound to the **Chat** feature, CHouse Assistant unless an administrator bound another one.

The choice is saved **on the thread**: switching threads switches the agent, and a new thread starts with the agent you had picked. When a thread's agent is deleted, the thread answers with the default agent; when it is disabled or no longer available to you, the chat asks you to pick another one. Each answer is labelled with the agent that gave it, and in the activity panel every tool call made by an investigator shows *via* its path — for example `via chouse-assistant › access-auditor`.

## Which agents appear

An agent is offered in the picker when all of these hold:

- it is **enabled** and has **no task template** (feature agents never appear)
- it is a **router**, sits directly under a router, is the Chat feature's bound agent, or is nobody's subagent — investigators under another agent stay behind it
- the user holds at least one of its **required permissions**, or it has none (admins see every agent)

Required permissions also prune a tree: a subagent the user may not use is left out of that user's run.

## Upgrading from earlier releases

CHouse Assistant used to be a router over *ClickHouse Data* and *CHouse Admin*. On upgrade:

- the **Chat** feature moves to CHouse Assistant if it was still on the shipped default; a binding an administrator chose stays;
- **CHouse Admin** is retired: agents that delegated to it delegate to its three specialists, features bound to it move to CHouse Assistant, and the agent is removed — unless an administrator customized it, in which case it stays as it is;
- **ClickHouse Data** becomes a read-only investigator; its write tools moved to CHouse Assistant.

## Adding your own

Any chat agent you create in **AI Governance › Assistant** shows up in the picker by the rules above. Typical uses:

- a **team assistant** — ClickHouse Data's tools with a prompt and a skill about your schemas and naming
- a **restricted helper** — a narrower tool set, visible only to roles with a given permission
- an assistant of your own with `load_toolkit` — it then loads toolkits the way CHouse Assistant does

[Build a chat agent](/docs/guide-build-a-chat-agent/) walks through one end to end.

## Limits

A chat run stops after 2 minutes unless the agent sets its own timeout (CHouse Assistant allows 4, since it waits for investigators), and after its step budget. Picking a model in the chat overrides the agent's model for the agent and its subagents that have no model of their own.
