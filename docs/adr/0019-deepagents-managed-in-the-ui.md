# 0019 — DeepAgents Managed in the UI: One Agent Registry for Every AI Feature, Multi-Agent Chat, and a Read-Only CHouse Management Agent

- **Status:** Accepted
- **Date:** 2026-10-05
- **Builds on:** [0004](0004-dataops-ai-operator-assistance.md) (evidence-grounded DataOps AI), [0010](0010-pod-local-state-and-multi-replica-correctness.md) (no pod-local authority), [0013](0013-chouse-mcp.md) / [0017](0017-mcp-managed-in-the-ui.md) (tools as API projections, typed tool catalog, per-user tool filtering), [0016](0016-data-observability-platform.md) §10 (Agents page, `agents:view` / `agents:manage`)
- **Scope:** **every** DeepAgents run in CHouse. That covers the chat bubble and all 22 capabilities in `services/ai/capabilities/index.ts`: SQL-editor optimize/debug/check, Doctor fleet scan, optimize-log, the three diagnoses, the ten DataOps capabilities, the Observe incident explainer, the watcher compiler, and chat. After this ADR, no DeepAgents agent is defined in code.

## Context

### What runs today

Every AI feature goes through one engine (`services/ai/engine.ts`) as a
code-defined *capability*. Each capability is code: `prepare` (evidence and access
checks), `tools`, `instructions`, `messages`, `outputSchema`, `finalize`, plus
optional `cachedResult`, `softFail` and `onParseFailure`. The parts that shape
agent behaviour are all hard-coded:

| What | Where it lives today |
|---|---|
| System prompts | String constants: `OPTIMIZER_INSTRUCTIONS`, `DEBUGGER_INSTRUCTIONS`, `EVALUATOR_INSTRUCTIONS`, `*_DIAGNOSE_PROMPT`, `SYSTEM_PROMPT` (fleet), `commonInstructions(task)` (DataOps), `instructions(task)` (Observe), `buildSystemPrompt()` (chat) |
| Prompt composition | Code branches. Diagnose and optimize-log append `CLICKHOUSE_PLAYBOOK`. Fleet scan appends it only when `needsPlaybook(overview)` |
| Task framing (first user message) | Template literals per capability (e.g. "Node id … Investigate with query_node … produce the structured diagnosis") |
| Tool sets | Per-capability subsets of `coreTools`. For example, check-optimize gets 3 tools and draft-scheduled-query gets 5. Fleet capabilities get `query_node` bound to the resolved nodes. Chat also gets `optimize_query`, which calls another capability |
| Skills | **One global list** (`DEEP_AGENT_SKILL_SOURCES`: `ai-chat`, `ai-optimizer`, `references`) read from `src/skills/` on disk and given to **every** agent |
| Harness | **One global harness profile** per `provider:modelId` (`registerFastHarnessProfile`). It excludes `task`, `write_todos`, `ls`, `write_file`, `edit_file`, `glob`, `grep`, `execute` and the async-task tools, disables the general-purpose subagent, and appends a "do not delegate" suffix |
| Tuning | `tuning.stopAtSteps` / `maxOutputTokens` per capability. Per-model `params.recursionLimit` / `runTimeoutMs` (already in the DB) override them |

Callers: `/ai/invoke` (UI and MCP `ai_optimize` / `doctor_scan`), `/ai-chat/invoke`,
and three **background** callers with no user session: `doctorScheduler`
(scheduled fleet scans), `fleetAlerter` (alert-triggered scans) and
`context/watchers` (compile-watcher).

### Why change

1. **Nothing is maintainable without a release.** Tuning a prompt, trimming a
   tool set, adding a skill or changing the harness all need a code change.
   Customers can't adapt the agents to their fleet or their model.
2. **The chat needs to grow.** Users want read-only questions about CHouse itself
   ("who has `connections:edit`?", "which jobs failed overnight?"). Putting about
   25 management tools into the single chat agent makes tool selection and the
   prompt worse. Splitting it into a multi-agent design needs subagent
   delegation, and the global harness profile disables delegation for every
   agent on the same model.
3. **Skills on disk can't become editable.** Each replica would hold its own copy
   (ADR 0010).

### DeepAgents facts this design relies on (v1.10.7, read from the shipped code)

- `createDeepAgent` takes `tools`, `systemPrompt`, `subagents`
  (`SubAgent | CompiledSubAgent | AsyncSubAgent`), `skills` (paths resolved
  **through the backend**), `backend`, `permissions`, `middleware`, `store`,
  `checkpointer`, `interruptOn` and `name`. A `CompiledSubAgent { name, description, runnable }`
  nests a full deep agent, which gives agent → subagent → sub-subagent trees.
- Custom subagents **don't inherit** the parent's skills. A subagent's
  `permissions` **replace** the parent's rather than merging.
- **Harness profiles are process-global and merge-only.** `registerHarnessProfile`
  stores profiles in a `globalThis` map keyed by `provider[:model]` and **merges**
  into any existing entry. Nothing can unregister a profile or narrow it per agent.
  `createDeepAgent` resolves the profile from the *model*, not the agent. So
  per-agent harness behaviour **can't** be built on `registerHarnessProfile`.
- Everything a profile does can be done per agent instead:
  - `excludedTools` is just a `wrapModelCall` middleware that filters
    `request.tools`.
  - `toolDescriptionOverrides` rewrites tool descriptions.
  - `systemPromptSuffix` appends text to the prompt.
  - The general-purpose subagent is skipped when a subagent named
    `general-purpose` is already supplied. `GENERAL_PURPOSE_SUBAGENT` is exported,
    so we can supply our own.
  - The one exception is `excludedMiddleware`. It can't be done per agent, but the
    middleware it would remove (todo, summarization, patch-tool-calls) costs
    nothing once its tools are excluded.
- `BaseStore` has one abstract method (`batch`). `BaseCheckpointSaver` has five
  (`getTuple`, `list`, `put`, `putWrites`, `deleteThread`). `interruptOn`
  requires a checkpointer.

## Decision

### 1. Split every AI feature into a code *contract* and a DB *agent*

A capability becomes a **feature**. A feature is a code contract that **binds to
an agent** stored in the registry. The contract keeps only what must be code
because the UI, the API and its callers depend on it. Everything that shapes how
the agent reasons moves to the DB and is managed in the UI.

| Stays in code: **feature contract** (locked) | Moves to DB: **agent definition** (UI-managed) |
|---|---|
| `id`, RBAC `permission`, `inputSchema` | System prompt (template, §5) |
| `prepare`: access checks, evidence gathering, node resolution | Task-message template: how the evidence is framed for the model (§5) |
| The **variables** it exposes to templates (§5) | Model (an AI config, or the default) |
| The **tool context** it provides (§4) | Tool grants, chosen from the code catalog and limited to tools compatible with the feature's context |
| `outputSchema`, `finalize`, `cachedResult` / `cacheResult`, `softFail`, `onParseFailure` | Skills, each either on-demand (progressive) or pinned into the prompt (§6) |
| Output-contract text appended to the prompt (`structuredInstructions`) and the structured-output fallback | Subagents (wiring to other agents) |
| Delivery mode (structured / invoke) | Harness (§3) and tuning (step budget, recursion limit, timeout, max output tokens) |

The capability files keep `prepare` / `finalize` and so on. Their prompt
constants, tool picks and tuning are **deleted from the runtime code**. They
survive only as **seed data** (§8). The engine has **no default or fallback path**:
a run always resolves `feature → binding → agent graph` from the DB. If a binding
is missing or invalid, the run fails closed with an actionable error ("AI feature
`optimize-query` has no valid agent — fix it in Agents › Assistant"). Save-time
validation and the seed sync (§8) keep built-in features valid.

### 2. Registry data model (metadata DB, SQLite and PostgreSQL)

Migration **1.56.0** creates all tables, with `VERSION_CHECKS` entries,
upgrade-path coverage and a dedicated upgrade/idempotency test (CLAUDE.md,
mandatory). An agent's tools, skill links and subagents are **JSON columns on
the agent row**, not join tables: a save is one atomic row write, which matters
because neither migrations nor store writes are wrapped in a transaction across
tables. The version counter is its own one-row table, so incrementing it is a
plain `UPDATE … SET version = version + 1` on both dialects.

```
ai_harnesses
  id, slug, name, description
  excluded_tools        json   -- built-in DeepAgents tools hidden from the model (task, write_todos, ls, read_file, glob, grep, write_file, edit_file, execute, *_async_task)
  general_purpose       json   -- { enabled, description?, systemPrompt? }
  prompt_suffix         text   -- appended to the agent prompt (profile `systemPromptSuffix` semantics)
  tool_description_overrides json  -- { toolName: description }
  is_system, seed_hash, customized, version, timestamps

ai_agents
  id, slug (unique, kebab — the DeepAgents `name`), name
  description           text   -- routing hint a parent model reads (≤ 1024)
  kind                  text   -- 'router' | 'agent'
  system_prompt         text   -- template (§5)
  task_template         text null  -- first user message template (§5); null for chat agents
  model_config_id       text null  -- rbac AI config; null = default
  harness_id            text       -- → ai_harnesses
  tuning                json   -- { stepBudget, recursionLimit?, timeoutMs?, maxOutputTokens? }
  required_permissions  json   -- for chat visibility (§9)
  tools                 json   -- ordered grants from the code catalog
  skills                json   -- [{ skillId, mode 'progressive' | 'pinned', pinnedFile }]
  subagents             json   -- ordered child agent ids; a child can be reused
  enabled, is_system, seed_hash, customized, version, created_by, timestamps

ai_skills          id, name (kebab), dir_path ('<group>/<dir>'), description (≤ 1024),
                   skill_md (full SKILL.md), files json,
                   enabled, is_system, seed_hash, customized, version, timestamps
ai_feature_bindings (feature_id pk, agent_id, updated_by, updated_at)
ai_registry_revisions (id, entity, entity_id, version, action, snapshot json, actor, created_at)  -- history and rollback
ai_registry_state  (id = 1, version)                            -- bumped on every registry write
rbac_ai_chat_threads  + agent_id text null                     -- per-thread chat agent
```

A skill's directory (`dir_path`) is stored separately from its name because the
built-in optimizer skills live in `ai-optimizer/optimizer` but are named
`query-optimizer`. Keeping the directory keeps the skill paths the model sees
unchanged.

### 3. Harness: per-agent and UI-managed, with no global profiles

- **Remove `registerFastHarnessProfile`.** CHouse makes exactly **one** global
  registration, at boot: `{ generalPurposeSubagent: { enabled: false } }` under
  each provider key. This makes "no implicit general-purpose subagent" the
  uniform baseline, because a merge-only global registry can't be scoped any
  finer.
- Each agent's harness row is compiled **per agent** at build time:
  - `excluded_tools` → our own `ToolExclusionMiddleware`, the same
    `wrapModelCall` filter DeepAgents uses, passed in the agent's `middleware`.
  - `tool_description_overrides` → applied to catalog tools before they're passed
    in. Overrides for built-in tools are applied in the same middleware.
  - `prompt_suffix` → appended to the rendered system prompt.
  - `general_purpose.enabled = true` → we add `GENERAL_PURPOSE_SUBAGENT` (with the
    row's description and prompt, and the agent's own tools and skills) to that
    agent's `subagents`.
  - Subagents get their own harness middleware, because each subagent can point
    at a different harness.
- **Seeded harnesses:**
  - **Focused.** This is today's fast profile exactly: the same exclusions, GP
    off, and the same suffix. All structured features and today's chat start on
    it.
  - **Delegating.** It keeps `task` and excludes the write/execute fs tools and
    `write_todos`. Agents with subagents use it.
  - **Router.** Only `task` and `read_file`.
- The UI explains each built-in tool and warns when a harness excludes `task` on
  an agent that has subagents. Saving that combination is rejected.
- Two consequences of going per agent, both accepted:
  - The prompt suffix now follows the agent's prompt, not DeepAgents' own base
    prompt. The instruction is the same; only its position moves.
  - Bedrock models never matched DeepAgents' profile lookup, so they used to
    run with `task`, the filesystem tools and the general-purpose subagent. They
    now get the same exclusions as every other provider. Bedrock model ids
    without a `:` can still get DeepAgents' implicit general-purpose subagent,
    because the merge-only baseline can't reach them.

### 4. One tool catalog, with a declared run context

`services/ai/registry/catalog.ts` holds the only list of AI tools. MCP keeps its
own registrations; the chat's CHouse tools are read-only projections of the same
routes, called the same way. Moving MCP onto this catalog is a follow-up. Each
entry is
`{ name, title, domain, category, access, permissions[], requires, description, build(ctx) }`.
`requires` is the run context the tool needs:

| `requires` | Provided by | Tools |
|---|---|---|
| `session` | SQL-editor features, three DataOps features, chat | the 16 core tools, `render_chart`, `run_bounded_aggregate`, and `optimize_query`, which runs the `optimize-query` feature through **its** binding |
| `fleet` | Doctor / diagnose / optimize-log (resolved nodes) | `query_node` (bound to the feature's nodes) |
| `userApi` | Chat only, carrying the user's access token | CHouse read projections (§9) |
| none | everyone | `generate_query` |

Each feature declares the contexts it provides. Background features
(`fleet-scan`, run by the scheduler and the alerter) provide neither `session`
nor `userApi`, and at run time the engine strips any context a feature doesn't
declare. Save
and bind validation rejects any agent whose tools, or whose subagents' tools,
need a context the bound feature doesn't provide. So a background Doctor scan
can't be given a tool that would need a user token. For this ADR, only
`access: "read"` tools can be granted (§9).

### 5. Templates: logic-less, namespaced, validated

The system prompt and task message are **templates**. Only `{{ctx.name}}`
(insert) and `{{#ctx.flag}} … {{/ctx.flag}}` (section) are interpreted. All other
text is literal. This matters because today's draft-scheduled-query prompt
legitimately contains `{{slot_start}}` / `{{slot_end}}`, which must pass through
untouched. Each feature declares its variables with a type and a description, and
the editor shows them. Unknown variables fail validation at save time. Examples:

- Fleet scan exposes `ctx.needsPlaybook` (boolean), `ctx.hours`, `ctx.nodeCount`
  and `ctx.overview` (JSON). The seeded prompt is
  `…SYSTEM_PROMPT…{{#ctx.needsPlaybook}}\n\n{{skill:clickhouse-playbook/reference.md}}{{/ctx.needsPlaybook}}`.
  This reproduces today's conditional playbook exactly.
- Diagnose-error exposes `ctx.node.id`, `ctx.node.name`, `ctx.error.code`,
  `ctx.error.name` and `ctx.error.message`. Its task template is today's literal
  message.
- DataOps features expose `ctx.evidence` (the JSON the code already builds). Their
  task template is `<evidence>\n{{ctx.evidence}}\n</evidence>`.

The **output contract** (the JSON schema text appended by `structuredInstructions`
and the formatter fallback) belongs to the feature. The editor shows it read-only,
appended after the editable prompt, so an admin edit can never break the shape the
UI parses.

### 6. Skills: DB rows, progressive or pinned

- Skills are `ai_skills` rows, attached to an agent per link in one of two modes:
  - **progressive:** the normal DeepAgents skill, listed in the prompt and read
    on demand.
  - **pinned:** a chosen file of the skill is appended to the system prompt.
    This preserves today's always-inline `CLICKHOUSE_PLAYBOOK` in diagnose and
    optimize-log. Any template can also inline a skill where
    `{{skill:name}}` or `{{skill:name/file.md}}` appears, which is how the
    `system.*` table reference stays inside the diagnosis prompts.
- Runtime serving: every agent gets its own
  `CompositeBackend(new StateBackend(), { "/skills/": new RegistrySkillsBackend(files) })`
  holding **only its own** skills, so subagents compile into their own deep
  agents. The backend is a read-only `BackendProtocolV2` that serves rows as
  `/skills/<group>/<dir>/SKILL.md` (+ `files`), the same paths as before. Writes
  are denied by the backend and by `permissions` on every agent.
- **Fix found while building this.** The pre-registry engine mounted its skills
  at `/skills` without the trailing slash. `CompositeBackend` then built
  `//group/...` paths, `FilesystemBackend` rejected them as outside its root,
  and **no skill ever loaded**. The registry mounts at `/skills/`, so the 14
  skills now load as the prompts always assumed. A regression test pins this.
  It is the one intended behaviour change of the cut-over.
- **`FilesystemBackend` and `src/skills/` are no longer read at runtime.** The
  directory moves to `services/ai/seeds/skills/`, the seed source.
- Parity note: today every agent sees all 14 skills. Seeds attach the same 14 to
  every seeded agent so behaviour is preserved. Trimming them per agent becomes a
  one-click admin optimisation, not a code change.

### 7. Runtime assembly (`services/ai/registry/builder.ts`)

1. **Resolve.** Look up `feature → binding → agent`. For chat, the agent comes
   from the thread or picker (§9). Read through a per-process cache keyed on
   `ai_registry_version`, which every request reads with a single-row lookup, so
   no replica serves a stale graph (ADR 0010).
2. **Validate and prune.** Tools whose context the run doesn't provide are left
   out, as are CHouse tools and chat subagents the user lacks permission for. A
   missing or disabled bound agent, a cycle, or excessive depth fails the run closed.
3. **Build bottom-up.** Every agent becomes `createDeepAgent({ name, model, tools, systemPrompt,
   subagents, backend, skills, permissions, middleware })`. Each child is compiled the same way
   and attached as a `CompiledSubAgent` with its own recursion limit, so it carries its own
   backend, skills and harness.
4. **Run** with the feature's delivery mode, as the engine does today: structured
   parse, formatter fallback, `finalize`. Recursion limit and timeout come from
   **agent tuning**. Per-model `params.recursionLimit` / `runTimeoutMs` still
   override them, keeping today's precedence (see Open questions).
5. **Trace.** Every tool at every level is wrapped by the existing duplicate-call
   recorder, extended with the **agent path** (taken from LangGraph's
   `lc_agent_name` metadata). The path goes into structured `steps`, chat
   `toolCalls` and Doctor reports.

### 8. Seeds, exact-parity migration, and upgrades: no fallback, no drift

- **Seed source** lives in `services/ai/seeds/`: one agent per feature (22), the
  chat topology (§9), three harnesses, 14 skills and 22 bindings. Every prompt,
  task framing, tool subset, skill set, harness and tuning is copied
  **verbatim** from today's code. For example, `check-optimize` → agent
  "Query Evaluator" with `analyze_query`, `get_table_ddl`, `get_table_schema`, the
  Focused harness and stepBudget 4. `recommend-health-promise` → stepBudget 8,
  maxOutputTokens 5000, and `get_table_schema`, `get_table_ddl`,
  `run_select_query`.
- **Parity is a test, not a promise.** Before the cut-over PR deletes the old
  constants, a golden test captures each capability's compiled run config: the
  rendered system prompt for fixed sample inputs, the task message, tool names,
  skill names, excluded tools, GP on/off, recursion limit, timeout and max output
  tokens. After the cut-over, the same test builds every feature from the seeded
  registry and asserts the configs are **identical**. That is how "existing
  behaviour by default" is guaranteed.
- **Seed sync** runs at startup and is idempotent:
  - It inserts missing system rows and bindings.
  - It updates system rows with `customized = false` when their `seed_hash`
    changed, so shipped improvements reach installs that never edited them.
  - It **never** overwrites customized rows. The UI flags them as "built-in
    update available".
  - It restores a deleted binding for a built-in feature to its seeded agent.
    System agents can't be deleted, only rebound or reset.
- Seed rows aren't written by `migrations.ts`, so migrations never depend on
  prompt text. Migrations only create the schema.

### 9. Chat: multi-agent, plus the read-only CHouse management agent

Chat becomes the `chat` feature (invoke delivery). The threads and messages
tables keep their 7-day retention and stay the transcript and UI source of truth.

```
CHouse Assistant            router   (Router harness; tools: none)       ← "Auto"
├── ClickHouse Data         agent    today's chat prompt/tools/skills (Focused harness) ← default chat binding
└── CHouse Admin            agent    (Delegating harness) whoami + light lookups
    ├── access-auditor               users, roles, permissions, data-access policies, PAT metadata, SSO (redacted), CH users/roles
    ├── operations-analyst           scheduled jobs/runs, data health, incidents, alerts, doctor reports, fleet
    └── platform-auditor             connections, AI providers/models (keys redacted), MCP settings, agent sessions/policies, audit log
```

- **The default chat binding is ClickHouse Data**, so today's chat behaves as it
  does now. It keeps the Focused harness (no delegation) for parity, so it ships
  without subagents. An administrator can give it some by switching it to the
  Delegating harness.
- The composer gets an agent picker: **Auto** (router), ClickHouse Data, CHouse
  Admin, plus any custom top-level agent the user is allowed to use. The choice
  is stored on the thread.
- Auto delegates a single-domain question to exactly one agent and passes its
  answer through. It only combines answers for cross-domain questions.

**Read-only is enforced by the tool layer:**

- `chouse` tools are `GET` projections of existing routes. They're called
  in-process with **the chatting user's own access token** (`verifyBearer`
  already accepts JWTs), so route RBAC, data-access policies, rate limits and
  audit apply as they do in the UI. A user can never learn more through the
  agent than through the UI.
- Results pass through `redactSecrets` + `applyCaps` from `mcp/safety.ts`.
- Write and destructive tools can't be granted to any agent until a follow-up ADR
  adds them, together with `interruptOn` approval.
- Every prompt carries the standing rule that tool output is untrusted data.

### 10. Guardrails for editing production AI features

Making the SQL-editor optimizer or Doctor editable means a bad edit can degrade a
product feature. The guardrails:

- **Permissions** (new): `ai_agents:view`, `ai_agents:manage`. Editing or
  rebinding **any** agent, harness, skill or binding needs `manage`. Using
  features keeps its existing permissions (`ai:optimize`, `ai:chat`,
  `doctor:run`, …).
- **Audit actions:** `ai_agent.*`, `ai_harness.*`, `ai_skill.*`,
  `ai_binding.update`, `ai_registry.reset`, `ai_registry.rollback`.
- **Revisions:** every save writes a snapshot to `ai_registry_revisions`. The UI
  shows each revision's snapshot and restores any of them with one click. Edits use optimistic
  concurrency on `version`.
- **Test console:** run any feature against the **draft** (unsaved) graph, with a
  sample input or a recent real invocation, as the current admin. It shows the
  rendered prompt, the tool trace by agent path, the raw output and the parsed
  result, all before saving.
- **Locked output contracts** (§5) and the existing structured fallback keep the
  UI's expected shapes. `softFail` on check-optimize still keeps the editor's
  silent pre-screen silent.
- **Validation on save:** template variables, context compatibility, no cycles,
  depth ≤ 3, harness/subagent consistency, and read-only tools only.

### 11. Persistence: metadata DB only, no new drivers

| Concern | Decision |
|---|---|
| Registry (agents, harnesses, skills, bindings, revisions) | §2 tables on SQLite / PostgreSQL through drizzle |
| Chat transcript | Unchanged `rbac_ai_chat_*` tables |
| Conversation context | **No checkpointer in this ADR.** Structured features are single-shot, and read-only chat replays the transcript as it does today, which is already multi-replica safe |
| Checkpointer (follow-up) | **`ChouseCheckpointSaver`** over `ai_checkpoints` / `ai_checkpoint_writes` (`thread_id` = chat thread, `checkpoint_ns` per subagent). `deleteThread` is wired to thread delete and retention. **Mandatory** once any tool uses `interruptOn` |
| Long-term memory (optional, later) | **`ChouseStore`** (`BaseStore.batch` over `ai_store`), namespaced per user and mounted at `/memories/` through `StoreBackend`. Off by default and clearable by the user |

We won't use `@langchain/langgraph-checkpoint-sqlite` or `-postgres`, for three
reasons:

- The SQLite one pulls in `better-sqlite3`, a second native driver on the same
  file as `bun:sqlite`.
- The Postgres one pulls in `pg`, a second pool next to `postgres-js`.
- Both create their own schema through `setup()`, outside `migrations.ts` and its
  mandatory two-dialect tests.

The adapters we need are small (one and five abstract methods). We'll write them
on the `observe/db` dialect helpers and conformance-test them against
`MemorySaver` / `InMemoryStore` on both dialects.

### 12. UI: Agents › Assistant

The Agents page today covers *external* agents (Sessions, Policies, MCP). A new
**Assistant** tab (`/agents/assistant/:view?/:id?`) manages every built-in agent:

- **Features:** all 22 AI features grouped by surface (SQL editor, Doctor,
  Schema/Parts, DataOps, Observe, Chat). Each row shows its bound agent, status
  (built-in / customized / update available), last test, and **Rebind**.
- **Agents:** a tree view with an editor for prompt and task templates (Monaco,
  with a variable palette and the locked output contract shown below), model,
  harness, tool picker (filtered to compatible contexts, with read-only badges and
  required permissions), skills (progressive or pinned), subagents, tuning,
  **Reset to built-in**, and history.
- **Harnesses:** built-in tool toggles with explanations, general-purpose
  subagent settings, prompt suffix, and tool description overrides.
- **Skills:** SKILL.md editor (front-matter validated against DeepAgents' limits)
  plus reference files.
- **Tools:** the read-only catalog: domain, access, required context and
  permissions, and which agents use each tool.
- **Test console** and **History** (§10).

### 13. Delivery

At the owner's direction this shipped as **one PR** (ADR, registry, cut-over,
UI and multi-agent chat), in this order, each step gated by its tests:

1. **Golden parity snapshot.** Captured from the pre-registry code for all 22
   capabilities (`registry/parity.fixture.json`), before anything changed.
2. **Registry foundation.** Migration 1.56.0 (two-dialect tests), the tool
   catalog, `RegistrySkillsBackend`, the per-agent harness, the template engine,
   the builder, seeds and seed sync.
3. **Cut-over.** Every feature, including the background callers and MCP
   `ai_optimize` / `doctor_scan`, runs through its binding. The global harness
   profile, the prompt constants, the inline tool picks, `FilesystemBackend`,
   `src/references` and `src/skills` are gone (skills moved to
   `services/ai/seeds/skills`). *Gate: `parity.test.ts` is identical for all 22
   features (verified to fail when a seed prompt changes by one character).*
4. **Management API, validation and multi-agent chat.** Includes
   `/api/ai-agents`, the CHouse read projections, the user-token in-process
   client, the router and CHouse Admin agents, and the thread agent picker.
5. **Agents › Assistant UI and docs.**

Follow-ups:

- Progress streaming over `streamEvents` with subgraph events. This matters
  more once runs delegate to subagents.
- Moving the MCP tool registrations onto the catalog.
- A future ADR for write tools with `interruptOn`, `ChouseCheckpointSaver` and
  approval UI, plus the optional `ChouseStore` memories.

The Helm chart is unaffected: there are no new env vars, ports or secrets.

## Consequences

**Easier**
- Every agent in the product (prompt, model, tools, skills, subagents, harness,
  tuning) can be inspected, tuned, tested and rolled back from the UI. Changes
  apply to all replicas on the next request.
- One engine path serves every AI surface (UI, chat, MCP-triggered features,
  background jobs), with no special cases and no fallbacks.
- Harness behaviour is finally per agent. Delegation becomes possible without
  breaking the focused, no-delegation features.
- New agents, such as another chat domain, are admin actions.

**Harder / accepted costs**
- **Production features are now editable.** Guardrails: `ai_agents:manage`,
  audit, revisions and rollback, the test console, locked output contracts,
  reset, and save validation (§10).
- **Larger cut-over.** All 22 features switch at once (owner direction: no dual
  path). The golden parity test is the safety net, and the cut-over is gated on
  it.
- **Per-request reads:** a registry-version read and a build per run. This is
  negligible next to the LLM call, and the graph is cached per version.
- **Seed drift:** customized built-ins stop getting upgrades. The UI marks them
  "update available", and Reset to built-in applies the new version.
- **Latency and tokens in Auto chat:** a router hop plus delegation. Mitigated by
  explicit agent picks, ClickHouse Data as the default binding, a cheap router
  model, and pass-through answers (streaming is a follow-up).

## Alternatives considered

1. **Registry for chat only; capabilities stay code-defined.** This was the
   earlier draft of this ADR. Rejected by the owner: it leaves two ways to define
   an agent and keeps most AI behaviour unmaintainable from the UI.
2. **Keep code defaults as a runtime fallback when no DB row exists.** Rejected
   because two sources of truth drift silently. Seeds plus seed sync give
   defaults with exactly one runtime source.
3. **Per-agent harness through `registerHarnessProfile`.** Not possible: the
   registry is global, keyed by model, and merge-only (see Context).
4. **Editable output schemas and `finalize`.** Rejected because the UI, API, MCP
   and stored reports depend on these shapes. They remain the feature contract.
5. **Admin-defined tools or free-form middleware (JS, HTTP or SQL in the UI).**
   Rejected because tools and middleware are the security boundary. Allowing this
   would mean arbitrary code execution and SSRF.
6. **Full template language (Handlebars or Mustache with helpers).** Rejected as
   unnecessary power. It also conflicts with literal `{{slot_start}}` in today's
   prompts. The namespaced, logic-less subset covers every current composition.
7. **Skills in LangGraph `BaseStore` / `StoreBackend`.** Rejected because skills
   would become opaque blobs with no validation, diff or audit. A read-only
   backend over first-class rows gives the same runtime behaviour.
8. **Official SQLite/Postgres checkpointers.** Rejected because of the second
   drivers and the schema outside tested migrations (§11).
9. **`@langchain/langgraph-supervisor` / swarm for chat.** Rejected because it
   duplicates DeepAgents' `task` tool and `CompiledSubAgent`.

## Resolved questions

- **Precedence.** Per-model `params.recursionLimit` / `runTimeoutMs` still win
  over agent tuning, as before (parity). A model the user picks in the chat or
  the SQL editor wins over the agent's model.
- **Skill set.** Every seeded agent keeps all 14 skills on demand (exact parity).
  Trimming them per agent is an admin action.
- **Tab name.** "Assistant" (Agents › Assistant).
- **CHouse Admin visibility.** Every user with `ai:chat` sees it. Its CHouse
  tools are offered per user permission, and the routes decide.
- **MCP prompts for registry agents.** Out of scope.
