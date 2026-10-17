# 0022 — AI Guardrails for CHouse's Own Agents and MCP

- **Status:** Proposed
- **Date:** 2026-10-17
- **Builds on:** [0013](0013-chouse-mcp.md) (MCP tools), [0019](0019-deepagents-managed-in-the-ui.md) (registry agents, harnesses, revisions, seed sync), [0020](0020-ai-usage-and-data-egress-tracking.md) (usage runs, data sent to providers)
- **Scope:** a **Guardrails** tab in AI Governance (`/ai/guardrails`, `/api/ai-guardrails`), a guardrail engine that runs inside every registry agent run and on every MCP tool result, preconfigured guardrails, and a per-model **context window** that drives DeepAgents' summarization.

## Context

Every CHouse AI feature and the chat run as registry agents (ADR 0019). Their
tools return ClickHouse rows, and ADR 0020 showed that everything a tool returns
is data sent to the model's provider. Today nothing stands between a result and
the provider: an agent that samples `users` sends its emails, phone numbers and
card numbers to the provider as they are. The same holds for MCP agents: a tool
result goes straight to an external client.

Administrators can already tune what an agent *may do* (granted tools, harness,
budgets for MCP sessions). They cannot control what *passes through* a run:

1. **Data leaving the cluster.** PII and secrets in rows, DSNs in settings,
   tokens pasted into the chat.
2. **Untrusted text inside data.** A row whose text says "ignore the previous
   instructions" is read by the model like any other prompt text.
3. **Runaway runs.** A loop of tool calls, or one huge result that fills the
   context window.
4. **Query shape.** A model writing `SELECT *` over a multi-billion-row table.

LangChain v1 middleware (`createMiddleware`, hooks `beforeAgent`, `wrapModelCall`,
`wrapToolCall`, `afterModel`) is what DeepAgents builds on, and the registry
builder already installs one per agent (the harness tool filter). It is the
natural hook point.

A related gap: DeepAgents decides when to summarize from
`model.profile.maxInputTokens`. LangChain fills the profile from its model
table, so OpenAI-compatible, Ollama and other custom model names have no
profile. Those runs fall back to a fixed 170k-token trigger, and a model with a
32k window overflows long before summarization starts.

## Decision

### 1. A guardrail is a registry row

`ai_guardrails` (migration 1.62.0) lives next to harnesses and agents and is part
of the registry snapshot, so it shares the snapshot cache, revisions
(`ai_registry_revisions`, entity `guardrail`), rollback, seed sync
(`seed_hash` / `customized`, "Reset to built-in") and the version counter that
keeps every replica current (ADR 0010).

| Field | Meaning |
|---|---|
| `kind` | One of the kinds in §2 |
| `config` | Kind-specific JSON, validated per kind |
| `stages` | Subset of `input`, `tool_call`, `tool_result`, `output` the kind supports |
| `action` | `log`, `warn`, `redact` or `block` (each kind declares which it supports) |
| `mode` | `shadow` (record only) or `enforce` |
| `scope` | `{ agents: "all" \| string[], features: "all" \| string[], mcp: boolean }` |
| `position` | Order within a stage, lowest first |
| `enabled` | On/off switch, kept across seed upgrades |

A guardrail is **always one of the shipped kinds**. Users configure instances —
patterns, term lists, columns, a rule for the judge — but never supply code.

### 2. Kinds

| Kind | Stages | Actions | What it checks |
|---|---|---|---|
| `pattern` | all | log, warn, redact, block | Regexes plus built-in detectors: `email`, `card` (Luhn-checked), `phone`, `ip` (parsed v4/v6), `url`, and secret detectors `aws_key`, `chouse_token`, `jwt`, `private_key`, `password_in_url`, `bearer_token` |
| `keywords` | input, tool_result, output | log, warn, redact, block | Whole-word, case-insensitive terms |
| `columns` | tool_result | log, redact, block | Values of result columns matching names or globs (`users.email`, `*.ssn`) |
| `injection` | tool_result | log, warn, block | Instruction-like text inside tool results; `warn` marks the result as untrusted data for the model |
| `sql` | tool_call | log, warn, block | SQL arguments: read-only, `LIMIT` on row-returning SELECTs, denied databases/tables, maximum estimated rows (EXPLAIN ESTIMATE, session connection tools only) |
| `tool` | tool_call | log, warn, block | Per-tool rule: deny, at most N calls per run, or only for given roles |
| `limits` | tool_call, tool_result | log, redact, block | Tool calls and model calls per run (block), rows and bytes per tool result (redact = truncate) |
| `judge` | input, output | log, warn, block | A small model checks text against a plain-language rule |

Redaction strategies for `pattern`, `keywords` and `columns`: `placeholder`
(`[EMAIL]`), `mask` (`da•••`) or `hash` (stable, irreversible within a run).

Regexes are rejected at save time when they are not valid, longer than 1,000
characters, or have nested unbounded quantifiers (catastrophic backtracking);
inputs scanned by a pattern are capped at 1 MB per value.

### 3. Engine

The builder compiles the snapshot's enabled guardrails that are in scope for a
node (agent slug and feature) into one middleware, `ChouseGuardrails`, installed
on every agent and subagent of the tree. Within a stage, guardrails run in
`position` order, each seeing the previous one's output.

| Stage | Hook | Applied to |
|---|---|---|
| `input` | `beforeAgent` (root agent only) | The user's messages |
| `tool_call` | `wrapToolCall`, before the tool | Tool name and arguments |
| `tool_result` | `wrapToolCall`, after the tool | The tool message content (JSON results are walked value by value, so redaction keeps them valid JSON) |
| `output` | `afterModel` | The model's text |

- **`block`** stops the run with a `GuardrailBlockedError`, which the chat and
  features show as "Blocked by guardrail *name*: *reason*".
- **`warn`** lets the run continue: on tool results the model gets a notice that
  the content is untrusted data; on tool calls it gets the reason next to the
  result.
- **Fail closed.** If a guardrail itself throws (bad config, judge model
  unavailable), the run stops. A guardrail never silently stops applying.
- **Shadow mode** evaluates and records exactly as enforce would, and changes
  nothing. New guardrails can start in shadow and be switched to enforce from
  their row.

**MCP.** `registerOnServer` (the single MCP registration boundary) runs the
`tool_result` stage of guardrails with `scope.mcp = true` on every MCP tool
result before it reaches the client. `tool_call`-stage kinds that need an agent
run (`limits` model calls, `judge`) do not apply to MCP.

### 4. Events

Every match is recorded in `ai_guardrail_events`: guardrail, stage, action,
mode, match count, agent path, tool, and the AI request and step (ADR 0020) it
belongs to — or the MCP session for MCP. **Matched values are never stored.**
Events are written once per request with the usage run; MCP events are written
per call. Retention follows `AI_USAGE_RETENTION_DAYS`.

### 5. Preconfigured guardrails

| Guardrail | Kind | Default |
|---|---|---|
| PII redaction | pattern (email, card, phone, ip) on tool results | **on**, enforce, redact |
| Secret detection | pattern (secret detectors) on input, tool results, output | **on**, enforce, redact (block on output) |
| Prompt-injection shield | injection | **on**, enforce, warn |
| Call limits | limits (120 tool calls, 80 model calls per run) | **on**, enforce, block |
| Result size cap | limits (1,000 rows, 256 KB per result) | **on**, enforce, redact |
| SQL safety | sql | off |
| Sensitive column masking | columns | off (needs a column list) |
| Topic restriction | judge on input | off (needs a judge model) |

A **model-fallback** guardrail is deliberately not offered: a run must use the
model it was configured with, or fail.

### 6. Context window

`contextWindow` joins the engine parameters on a model config (no migration:
params are JSON). The model factory sets `profile.maxInputTokens` on the model
instance, so DeepAgents summarizes at 85% of the window and keeps the latest 10%,
in every agent and subagent. When LangChain's profile already knows the model,
`contextWindow` is optional and overrides it. When it does not, the window is
**required**: saving the model fails without it, and a run on such a model fails
with a message pointing to Admin › AI models. The API reports the detected
window so the form can show it.

### 7. Access and API

- `ai_guardrails:view` (Admin, Super Admin) and `ai_guardrails:manage`
  (Super Admin, Admin).
- `/api/ai-guardrails`: list (with 24 h trigger counts), create, update (row
  version), delete (custom only), reorder, mode switch, reset to built-in,
  revisions and rollback, `test` (run a guardrail on pasted sample text, nothing
  stored), events, and `draft` (Draft with AI, review before saving).
- MCP tools and CLI commands mirror the read and write routes.

### 8. UI

AI Governance gains a **Guardrails** tab: KPIs, the list grouped by stage with
drag to reorder, an editor per kind with a live test, a four-step "New guardrail"
dialog (kind or AI draft → configure → scope and action → test and save in
shadow or enforce), and recent triggers linked to the AI request. Agents in the
Assistant tab list the guardrails that apply to them.

## Consequences

- Guardrails add work to every model and tool call. Pattern guardrails cost
  microseconds per value; a judge guardrail adds a model call per check and its
  tokens appear in AI activity.
- Redaction changes what the model sees, so answers may contain placeholders
  instead of values. That is the point; shadow mode exists to check the effect
  first.
- Installs with OpenAI-compatible or local models LangChain does not know must
  set a context window before those models run again (upgrade step).
- Guardrails are not a sandbox: they reduce what reaches the provider and what
  the model can do, alongside RBAC and data-access rules, not instead of them.

## Alternatives considered

- **LangChain's prebuilt `piiMiddleware`.** It covers only some detectors,
  cannot run in shadow mode, and reports nothing we could record. Our kinds use
  the same hooks with our own detection.
- **User-supplied JavaScript guardrails.** Maximum flexibility, but it runs
  admin-written code inside the server process. Rejected.
- **Guardrails on the harness.** Harnesses are per agent; guardrails are a
  policy across agents, features and MCP, so they get their own scope.
- **A global summarization override via harness profiles.** Profiles are
  process-global per provider and cannot vary per model config (ADR 0019 §3).
