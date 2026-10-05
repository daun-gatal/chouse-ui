---
app: Agents › Assistant
route: /agents/assistant
permissions: ai_agents:view, ai_agents:manage
---
# AI agents

Every AI feature in CHouse UI runs on an **agent** you can see and change in **Agents › Assistant**: the chat, the SQL editor's Optimize and Debug, the Doctor scan, the diagnoses in Monitoring, and the DataOps and observability assistants. An agent is a prompt, a model, a set of tools, skills, optional subagents, a harness and tuning. Nothing about an agent is hard-coded: CHouse ships built-in agents, and you can edit them, add your own, and test a change before you save it.

Viewing needs `ai_agents:view`; changing or testing needs `ai_agents:manage` (Admin and Super Admin by default). Using the features keeps its own permissions (`ai:chat`, `ai:optimize`, `doctor:run`, …).

## Features

The **Features** tab lists all 22 AI features, grouped by where they appear, with the agent each one runs on. Pick another agent from the list to rebind a feature; only agents that fit are offered and the server checks again on save.

Each feature keeps in code what the product depends on — who may call it, the evidence it gathers, and the shape of its answer. It hands its agent **template variables** (for example `ctx.query` for Optimize, `ctx.overview` and `ctx.needsPlaybook` for the Doctor scan) and the **contexts** its tools may use:

| Context | What the tools can do |
| --- | --- |
| ClickHouse session | Run read-only queries on the signed-in user's connection, with their data access rules |
| Fleet nodes | Read `system.*` tables on the nodes the feature resolved |
| Your CHouse access | Call CHouse's own API as the chatting user (chat only) |

A feature whose agent is missing, disabled or no longer fits **fails with an error** that names the problem; the **Problems** panel lists every such issue.

## Agents and subagents

The **Agents** tab shows a tree: routers and top-level agents, with their subagents below them. An agent with subagents delegates to them with DeepAgents' `task` tool, choosing by each subagent's **description**. Subagents don't see the conversation — only the task the parent writes — and the tree is at most three levels deep.

The editor has these parts:

- **Prompt** — the system prompt, and for feature agents the **task template** (the first message, which frames the feature's evidence). `{{ctx.name}}` inserts a variable and `{{#ctx.flag}}…{{/ctx.flag}}` keeps a section when the variable is set; `{{skill:name}}` or `{{skill:name/file.md}}` inlines a skill. Any other text, such as `{{slot_start}}`, stays as written. **Preview** renders the prompt with placeholder values and lists problems. For structured features the output contract (the JSON schema) is appended by the feature and can't be edited.
- **Tools** — chosen from the catalog. Every tool is read-only.
- **Skills** — *on demand* (listed in the prompt, read when needed) or *pinned* (a file inlined into the prompt).
- **Subagents** — the agents this one may delegate to.
- **Settings** — description, kind (agent or router), harness, model, step budget, recursion limit, timeout, maximum output tokens, and the permissions a chat user needs to see the agent.
- **Test** — runs the unsaved draft (see [Test console](#test-console)).
- **History** — every saved version, with **Restore**.

A model a user picks in the chat or the SQL editor wins over the agent's model. Per-model runtime limits set in [AI models](/docs/ai-models/) win over the agent's tuning.

## Harnesses

A harness decides how DeepAgents runs an agent: which built-in tools it sees (`task`, `write_todos`, `read_file`, …), whether it gets a general-purpose subagent, a prompt suffix, and tool description overrides. Three are built in:

| Harness | Use |
| --- | --- |
| Focused | Tool-first and bounded — no planning or delegation. Every built-in feature and the ClickHouse chat agent |
| Delegating | Keeps the `task` tool so an agent can use its subagents |
| Router | Only the `task` tool |

An agent that has subagents needs a harness that keeps `task`.

## Skills

Skills are `SKILL.md` files with optional reference files (for example the ClickHouse playbook and the `system.*` table reference). They are stored in the metadata database and served read-only to agents under `/skills/`. Edit a skill's `SKILL.md` — its front matter sets the name and description — or add files to it.

## Tools

The **Tools** tab lists the catalog: what each tool does, the context it needs, the permissions it needs, and which agents use it. Tools are defined in code because they decide what runs and as whom. The CHouse tools (users, roles, data access policies, connections, scheduled jobs, data health, alerting, incidents, Doctor reports, AI models, external agents, audit log) call the API as the chatting user, so a user never learns more through the chat than through the screens. Secrets are redacted and results are capped.

## Chat agents

The chat bubble has an agent picker:

- **Auto · CHouse Assistant** — a router that sends ClickHouse questions to *ClickHouse Data* and questions about CHouse itself to *CHouse Admin*, and combines both for questions that span them.
- **ClickHouse Data** — the default: databases, tables, SQL, performance and charts on your connection.
- **CHouse Admin** — read-only questions about CHouse: who can do what, what failed overnight, what changed this week. It delegates to an access auditor, an operations analyst and a platform auditor.

The choice is saved on the thread, and the activity panel shows which subagent made each tool call. Agents you add appear in the picker when they have no task template and aren't someone else's subagent. **Required permissions** on an agent hide it from users who hold none of them.

## Test console

The **Test console** runs any feature as you, on your active connection — with its bound agent, another agent, or (from the editor) an unsaved draft. It shows the result, every tool call with the agent that made it, the system prompt as the model received it, and the task. Testing needs `ai_agents:manage` and the feature's own permission.

## Built-in agents and upgrades

Editing a built-in agent, harness or skill marks it **customized**. CHouse upgrades keep improving the built-ins you haven't changed and never overwrite the ones you have — those show **update available** when a newer version ships. **Reset to built-in** brings one back to how it shipped. Built-ins can't be deleted, only disabled, rebound or reset.

Every save is validated against the whole registry (a change can't break another feature), recorded as a version, applied on every replica on the next request, and audited (`ai_agent.*`, `ai_harness.*`, `ai_skill.*`, `ai_binding.update`, `ai_registry.reset`, `ai_registry.rollback`).
