# 0024 — AI Platform v2: Durable Streaming Runs, Approved Actions, Memory, Auto-triage, Analysis Sandbox and Agent Evals

- **Status:** Accepted (implemented; see *As shipped* below)
- **Date:** 2026-10-23
- **Builds on:** [0016](0016-data-observability-platform.md) (remediation catalog, notebooks, leases), [0019](0019-deepagents-managed-in-the-ui.md) (agent registry; its follow-ups: write tools with `interruptOn`, a checkpointer, memories), [0020](0020-ai-usage-and-data-egress-tracking.md) (usage runs; budgets deferred), [0022](0022-ai-guardrails.md) (guardrails)
- **Scope:** the DeepAgents engine (`services/ai`), the chat (`/api/ai-chat`), AI Governance, the remediation queue, notebooks, and the RBAC database. One release, one PR, one section per phase.

## Context

Every CHouse AI feature runs as a registry agent (ADR 0019), behind guardrails
(ADR 0022) and with its usage tracked (ADR 0020). Four gaps remain:

1. **Runs are one-shot.** The chat answers after a 2-minute spinner, a refresh
   loses the run, and nothing is persisted between steps. Nothing can pause.
2. **The AI can only read.** ADR 0019 held write tools back until approval
   (`interruptOn`) and a checkpointer exist. The SRE agent explains a runaway
   query; a human then has to find the button to kill it.
3. **Every run starts from zero.** Table conventions ("always filter `events`
   by `event_date`") are rediscovered in every thread.
4. **The AI only answers when asked.** Incidents and alerts fire with no
   investigation attached.

The libraries have moved: `deepagents` 1.15 adds skill-scoped tools and pinned
skills, forked subagents and multimodal reads; `langchain` 1.5 ships
`humanInTheLoopMiddleware`, model fallback and retry, tool retry, call limits,
context editing and provider prompt caching; `@langchain/quickjs` adds a WASM
JavaScript sandbox that can call the agent's tools from code.

## Decision

### Phase 0 — Library upgrade

`deepagents` 1.10 → 1.15, `langchain` 1.5.3 → 1.5.19, one `@langchain/core` 1.3
across every provider package, plus `@langchain/langgraph` and
`@langchain/langgraph-checkpoint` as direct dependencies. Behaviour changes are
handled, not just bumped: the todo list became opt-in (1.12), so the builder adds
`todoListMiddleware` whenever a harness does not hide `write_todos`; the new
`delete` filesystem tool is listed in the harness editor and hidden by the
shipped harnesses (writes under `/skills/` stay denied); skills load before each
model call (1.14), so registry edits reach running threads.

### Phase 1 — Durable, streaming runtime

**Chat runs.** A chat turn is a *run* (`ai_chat_runs`): it executes on the
server independently of the HTTP request, so closing the panel or refreshing
does not stop it. `POST /api/ai-chat/runs` starts a run and streams it as
server-sent events (`run`, `step`, `status`, `final`, `error`; a pause is a `status` event carrying the pending approvals);
`GET /api/ai-chat/runs/:id` returns its stored state and `GET …/events`
re-attaches. Steps are persisted as they happen, so a page on another replica
can follow a run by polling the row. **Stop** sets `cancel_requested`; the
owning replica aborts the run at the next step. `POST /api/ai-chat/invoke`
remains (CLI, MCP, tests) and is a run that the request awaits.

**What streams (D1).** Steps — tool calls, their subagent path and a short
result summary — stream live. The final answer is sent once the root agent's
output guardrails have passed, never token by token, so text a guardrail would
block or redact never reaches the browser.

**Checkpointer.** `ChouseCheckpointSaver` implements LangGraph's
`BaseCheckpointSaver` over `ai_checkpoints` and `ai_checkpoint_writes` in the
RBAC database (SQLite or PostgreSQL; values serialized with the saver's own
serde and stored base64). `thread_id` is the run id, so a run can pause
(Phase 2) and resume on any replica. Checkpoints are deleted with their run;
runs follow the chat thread's retention.

**Runtime settings per agent** (stored in the agent's `tuning` JSON, so no
schema change): fallback model (`modelFallbackMiddleware`), model retries
(`modelRetryMiddleware`), tool retries for transient errors
(`toolRetryMiddleware`), per-run model- and tool-call caps
(`modelCallLimitMiddleware`, `toolCallLimitMiddleware`), prompt caching
(Anthropic and Bedrock middleware; on by default, OpenAI-compatible providers
cache on their own), and clearing old tool results (`contextEditingMiddleware`).
A subagent link can **inherit the conversation** (`mode: "fork"`); forked
children are built from a spec, so a child with subagents of its own cannot be
forked.

**Budgets (D5).** `ai_budgets` caps tokens or cost per day or month for a
feature, for each user, or for a feature per user. A run checks its budgets
before it starts. When one is exhausted it switches to the budget's fallback
model, or stops with an error naming the budget and when it resets. Budgets are
managed in **AI Usage › Budgets** with the new `ai_budgets:manage` permission;
AI Usage also shows cache-hit tokens and what caching saved.

**Skills.** A skill may list tools in its `SKILL.md` front matter
(`metadata.include_tools`); the agent sees them only after it reads that skill.
They must be catalog tools the user may use, and the skill editor edits them as
chips. The chat composer gets `/skill:` commands and a skill picker
(`pinnedSkills`).

**Attachments.** The composer accepts images, PDFs and text files (CSV, JSON,
SQL, Markdown, plain text) when the chosen model's accepted inputs allow it
(a new per-model setting). Text attachments go through input guardrails like
the message; images and PDFs cannot be scanned and are labelled as such. Every
attachment is counted as data sent to the provider.

### Phase 2 — Approved actions

**Write tools** join the catalog with a risk class:

| Tool | Risk | How it runs |
| --- | --- | --- |
| `kill_query`, `create_saved_query`, `create_scheduled_query`, `create_health_promise`, `create_dashboard`, `update_table_context` | Low | Pauses the run for approval in chat (`interruptOn`, approve / edit / reject), then runs as the user through the in-process API |
| `propose_remediation` (any remediation catalog type) | High | Creates a remediation proposal (origin `ai`); the remediation lifecycle and its approval classes decide |

Rules, all fail-closed:
- A low-risk write tool can only be granted together with approval: the builder
  always puts it in `interruptOn`, and the registry rejects nothing less. The
  harness cannot exclude the approval.
- Approval and execution need the new **`ai:act`** permission plus the
  permission the underlying API checks. RBAC is checked when the action runs,
  as the approving user, not when it is proposed.
- A user may approve their own low-risk action in chat (D2). High-risk actions
  keep the remediation rule that a proposer never approves their own proposal.
- Guardrails check write-tool arguments (`tool_call` stage). An edit re-runs
  validation. Every decision is audited as `ai_action.approve` or
  `ai_action.reject` with `origin: ai`; the action itself is audited by the
  route it calls, as for any change made in the UI.
- Pending approvals expire (chat: 15 minutes; background proposals: 24 hours).
  An expired chat approval ends the run; the user asks again.
- Runs without a person in the loop (features, auto-triage) never execute:
  a low-risk write becomes a pending entry in `ai_actions`, approved from
  **AI › Approvals** by someone with `ai:act`.

`ai_actions` records every proposal and its outcome. Chat approvals are
answered on a card in the reply; **AI Governance › Approvals** lists every
action, with a badge counting what waits for the viewer. The test console and
evals run write tools in a `simulate` mode that records nothing.

### Phase 3 — Memory

`ai_memories` holds short notes with a scope: **user** (one person's
preferences) or **connection** (team knowledge about a cluster). Agents with
memory turned on get a `remember` tool and see the memories that apply to the
user and connection in their system prompt. Rules:
- A user memory is saved at once and shown in chat with an undo. Users see,
  edit, export and delete theirs on **AI › Memories**, and can turn memory off
  for themselves.
- A connection memory is a proposal until an administrator with
  `ai_memories:manage` approves it (D4); the review queue is on the same page.
  A proposal that matches a table context also shows next to that table's
  context.
- The enforced pattern and keyword guardrails run on a note before it is
  stored, whatever their stage (a note reaches the provider in every later
  prompt); a match blocks a user memory and flags a team proposal.
- Memories are deleted with their user; the chat and AI usage never store them
  elsewhere.

The DeepAgents `StoreBackend` (memories as files) was not used: the shipped
harnesses hide `write_file`, and file writes would bypass review and guardrails.

### Phase 4 — Auto-triage

When a data-health incident, an observe incident, a fleet alert, a failed
scheduled run or a Doctor report appears, a triage agent investigates without
being asked. Settings per trigger (`ai_triage_rules`): on/off, agent, cooldown,
daily token budget. A runner on one replica (lease, as ADR 0016) dedupes by
trigger and subject, respects the cooldown and the budget, runs the
`triage-incident` feature, writes its findings and proposed actions into the
subject's investigation notebook (incidents and Doctor reports; fleet alerts
and scheduled runs keep them on the run), and delivers a short notice to the
alerting channels the rule picks (Slack, Google Chat, email or webhook). It can
only propose actions (Phase 2), recorded for the person who set the rule up. Runs are recorded in `ai_triage_runs` and shown with
an **AI investigated** badge.

### Phase 5 — Analysis sandbox

A harness can enable **analysis** (`@langchain/quickjs`): the agent gets
`js_eval`, a QuickJS WASM interpreter with no network, no modules and no
filesystem, limited to 64 MB and a 15-second wall clock per call. The clock
includes the tool calls the code makes, so the planned 2 seconds would have cut
off ordinary ClickHouse queries. Inside it the agent can call its granted
**read-only** tools as functions (`tools.runSelectQuery(…)`), so rows reach the
computation without passing through the model; each bridged call passes the
run's tool-call and tool-result guardrails. Write tools are never exposed in the
sandbox. The switch is `ai_harnesses.analysis` (migration 1.69.0), off for every
harness. This reverses
ADR 0019's "CHouse never provides a sandbox" for this one, in-process
interpreter; `execute` stays unavailable.

### Phase 6 — Agent evals

Each agent can have **test cases** (`ai_eval_cases`): an input (a chat message,
or a feature's input), the tools expected in order (our own subsequence
matcher), and a rubric for an LLM judge (a CHouse prompt on the default
model). A case can be saved from the test console or from a chat request in AI
activity ("Save as test case"); feature requests keep no input, so they can't.
**Run evals** executes every case against the draft through the test console's
paths, with write tools simulated, and stores `ai_eval_runs` (score, per-case
results, regressions, cost), keyed by a hash of the draft's behaviour. With an
eval threshold set, saving the agent requires a completed run of that exact
draft covering every case and scoring at least the threshold; a refused save
opens the Evals tab with the score and the regressions.

### Parked

External MCP tools for agents (`@langchain/mcp-adapters`), IDE integration
(ACP) and DeepAgents async subagents (they need a separate Agent Protocol
server). Slack ChatOps was dropped.

## Consequences

- New RBAC tables and columns (migrations 1.65.0–1.70.0, SQLite and PostgreSQL), new
  permissions `ai:act`, `ai_budgets:manage`, `ai_memories:manage` granted to
  Admin and Super Admin, and `ai:act` to Developer.
- A chat run outlives its request. A replica that dies mid-run leaves the run
  `running`; runs whose heartbeat is older than 2 minutes are marked failed.
- Prompt caching is on by default for Anthropic and Bedrock models; the cost
  drop shows in AI Usage.
- Auto-triage spends tokens without a person asking. It is off by default per
  trigger and always bounded by its budget.
- The analysis sandbox runs model-written code in-process. QuickJS isolation,
  memory and time limits, and read-only tools bound it.

## As shipped

Where the implementation differs from the plan above, the text was updated;
the main differences:

| Planned | Shipped |
| --- | --- |
| `create_watcher` write tool | Dropped: watchers compile into health promises, so `create_health_promise` covers it |
| Expired approval resumes the run as a rejection | The run ends; the user asks again |
| Pending badge in the chat header | Approvals are answered in the reply; the badge is on the Approvals tab |
| Sandbox: 2-second wall clock | 15 seconds, since tool calls count toward it |
| Judge via `openevals` | A CHouse judge prompt (JSON verdict), no extra dependency |
| Migrations 1.65.0–1.69.0 | 1.65.0 runtime, 1.66.0 actions, 1.67.0 memory, 1.68.0 triage, 1.69.0 harness analysis, 1.70.0 evals |

## Alternatives considered

- **Token streaming of the final answer.** Rejected for D1: output guardrails
  must see the whole answer before any of it is shown.
- **One checkpoint thread per chat thread.** A thread can switch agents, and
  each agent has its own graph state; per-run threads keep resume exact and the
  chat history stays in `rbac_ai_chat_messages`.
- **Write tools that always create proposals (no interrupt).** Simpler, but the
  agent could not verify or report what its approved action did.
- **`agentevals` for trajectory matching.** Its last release is from March; a
  20-line ordered-subsequence matcher is ours to maintain.
