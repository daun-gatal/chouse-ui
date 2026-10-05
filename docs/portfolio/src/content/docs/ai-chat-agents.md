---
app: Chat bubble › Chat agent
permissions: ai:chat
---
# Chat agents

The chat bubble can talk to more than one agent. Out of the box it offers three: one for your ClickHouse data, one for CHouse itself, and a router that picks between them. Administrators can add their own in [AI Governance › Assistant](/docs/ai-agents/).

## The agent picker

The **Chat agent** menu next to the model picker lists every chat agent you may use (it appears when there is more than one, on screens wider than a phone):

| Agent | Answers |
| --- | --- |
| **Auto · CHouse Assistant** | Routes each question: ClickHouse questions to ClickHouse Data, questions about CHouse to CHouse Admin, and both for questions that span them, combining the answers |
| **ClickHouse Data** *(default)* | Databases, tables, columns, SQL, query performance, running and slow queries, server info and charts — on your active connection |
| **CHouse Admin** | Read-only questions about CHouse: who can do what, what failed overnight, what changed this week |

Routers come first, marked *Auto*. The default is the agent bound to the **Chat** feature; an administrator can bind another one.

The choice is saved **on the thread**: switching threads switches the agent, and a new thread starts with the agent you had picked. When a thread's agent is deleted, the thread answers with the default agent; when it is disabled or no longer available to you, the chat asks you to pick another one. Each answer is labelled with the agent that gave it, and in the activity panel every tool call made by a subagent shows *via* its path — for example `via chouse-admin › access-auditor`.

## CHouse Admin

CHouse Admin answers from CHouse's own API, as you. It never sees more than your screens would show, and it is read-only: asked to change something, it tells you where in CHouse to do it.

It delegates to three specialists, each with its own [CHouse tools](/docs/ai-tools/#chouse-tools):

| Subagent | Covers |
| --- | --- |
| **Access Auditor** | Users, roles and permissions, data access policies, your personal access tokens (never the secret), SSO, ClickHouse users and roles |
| **Operations Analyst** | Scheduled jobs and runs, Data Health promises and incidents, alerting, observability incidents, Doctor reports, the fleet snapshot |
| **Platform Auditor** | Connections, AI models, external agents and MCP settings, the audit log |

Things to ask:

- *Who can edit connections?* — the auditor finds the roles holding `connections:edit` and the users holding those roles.
- *What failed overnight?* — failed scheduled runs and open incidents, with when they happened.
- *What changed in roles this week?* — audit log entries filtered by action and date.
- *Which AI model is the default, and who used MCP today?*

A specialist only gets the tools for which you hold a permission. Ask about users without `users:view` and the answer says you lack access to that area — the agent doesn't try to work around it. Results are capped (100 rows) and secrets such as SSO client secrets, channel webhooks and API keys are redacted before the model sees them.

## Which agents appear

An agent is offered in the picker when all of these hold:

- it is **enabled** and has **no task template** (feature agents never appear)
- it is a **router**, sits directly under a router, is the Chat feature's bound agent, or is nobody's subagent — specialists under another agent stay behind it
- the user holds at least one of its **required permissions**, or it has none (admins see every agent)

Required permissions also prune a tree: a subagent the user may not use is left out of that user's run, so a router never delegates to it.

## Adding your own

Any chat agent you create in **AI Governance › Assistant** shows up in the picker by the rules above. Typical uses:

- a **team assistant** — ClickHouse Data's tools with a prompt and a skill about your schemas and naming
- a **restricted helper** — a narrower tool set, visible only to roles with a given permission
- a **router of your own** — put your agents under a router so users ask one place

[Build a chat agent](/docs/guide-build-a-chat-agent/) walks through one end to end.

## Limits

A chat run stops after 2 minutes unless the agent sets its own timeout (CHouse Assistant allows 3, since it waits for subagents), and after its step budget. Tool calls are read-only on every agent. Picking a model in the chat overrides the agent's model for the agent and its subagents that have no model of their own.
