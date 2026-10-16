# 0020 — AI Usage and Data Egress Tracking for CHouse's Own AI Agents

- **Status:** Accepted
- **Date:** 2026-10-16
- **Builds on:** [0016](0016-data-observability-platform.md) §10 (AI Governance, `log_comment` attribution), [0019](0019-deepagents-managed-in-the-ui.md) (one DeepAgents engine for every AI feature)
- **Scope:** every run of the DeepAgents engine in `services/ai/engine.ts`: the chat, all structured AI features, and the background callers (Doctor schedules, fleet alerts, watchers). External agents over MCP or tokens are already covered by **AI Governance › Sessions** and are out of scope.

## Context

AI Governance shows what *external* agents read and cost. CHouse's *own* agents
(the chat and the 22+ AI features) are invisible: nobody can answer

1. **What does our AI cost?** Tokens per user, agent and model.
2. **What data left the building?** Which ClickHouse tables and columns, and
   which CHouse records (users, audit log, tokens…), were sent to which LLM
   provider, by whom.
3. **What ClickHouse load did the AI cause?** Queries and bytes read per AI step.

Generic LLM tracing tools (Langfuse, LangSmith) answer the first question at
best. Only CHouse can link an LLM step to the ClickHouse work it caused and to
the data it sent out.

### What the libraries give us (verified)

- **Token usage.** Every bundled LangChain provider fills `usage_metadata` on
  non-streaming calls (DeepSeek inherits OpenAI's). The engine never streams, so
  OpenAI's streamed-usage gap does not apply. Conventions: `input_tokens`
  *includes* cached tokens (`input_token_details.cache_read` /
  `cache_creation`), and `output_tokens` includes reasoning for OpenAI and
  Anthropic. Google reports thinking tokens only in `total_tokens`, so billable
  output is `max(output_tokens, total_tokens − input_tokens)`.
- **Coverage.** A spike against deepagents 1.10.7 showed one callback handler
  sees every model call in a run: the root agent, compiled subagents (the `task`
  tool forwards its config) and config-less nested calls such as the
  summarization middleware (LangChain's async-local-storage config propagation
  works on Bun). Each start event carries `metadata.lc_agent_name`.
- **One call is outside the agent run:** the structured-output fallback in
  `structuredOutput.ts`. Every model is created per run by
  `resolveDeepAgentModel`, so a handler attached to the model instance covers it,
  and covers subagents that use their own model.
- **ClickHouse cost per query.** `ClickHouseService.executeQuery` already
  returns `statistics` (`elapsed`, `rows_read`, `bytes_read`), `meta` (output
  columns) and accepts a `queryId`. All session tools use it with `JSON` format.
  The fleet tool `query_node` uses the raw client and needs its own capture.
- **Tables.** `parseStatement()` in `middleware/sqlParser.ts` extracts the
  tables a statement reads.
- **Pricing.** Nothing in LangChain or the app knows prices (model profiles only
  carry limits).

### Constraints found on the way

- `ClientManager` keys its client cache on the client-level `log_comment`
  (`clientManager.ts`). A per-run tag at client level would create a ClickHouse
  client per AI run, so tags must be **per query**.
- The `queries` observe collector keeps hourly rollups, not single queries, so
  per-step ClickHouse cost must be captured at execution time, not joined later.
- A call that times out, is aborted, or is retried inside the provider SDK
  reports no usage. Totals are a lower bound in that case and must say so.
- Chat already stores the user prompt and the final answer
  (`rbac_ai_chat_messages`).

## Decision

### 1. Capture — three hook points, no change to deepagents

1. **Run scope.** `runStructuredCapability` and `invokeChat` open a *usage run*
   in an `AsyncLocalStorage` context and close it in `finally` (status `ok`,
   `error` or `timeout`). A run started while another is active (a feature tool
   such as `optimize_query` inside the chat) joins the outer run instead of
   opening its own, so its tokens count once, under the request that caused them.
2. **LLM steps.** `resolveDeepAgentModel` attaches a run-scoped callback handler
   to the model instance it creates. On `handleChatModelStart` it opens an `llm`
   step (agent from `lc_agent_name`); on `handleLLMEnd` it records usage from
   `usage_metadata`, falling back to `llmOutput.tokenUsage`; on `handleLLMError`
   it closes the step as `error` with no usage. A step without usage is marked
   `usageReported = false` and the request `incomplete`.
3. **Tool steps.** `guardDuplicateTools` (`registry/builder.ts`), which already
   wraps every granted tool with the caller's agent path, records a `tool` step
   and runs the tool inside a *query observer* context:
   - `ClickHouseService.executeQuery` asks the active observer for a `query_id`
     (`chouse-ai-<request>-<n>`) and a per-query `log_comment` tag
     (`ai_request_id`), then reports `statistics`, result rows, output columns
     (`meta`) and tables (`parseStatement`).
   - `query_node` (fleet) reports the same from its JSON body.
   - CHouse management tools (in-process API) report a **CHouse source**: the
     tool's title, the top-level fields of the returned rows and the row count
     after caps.
   Duplicate calls the guard short-circuits are recorded with no queries.

The observer is a generic hook on `ClickHouseService` (an `AsyncLocalStorage`
the AI module sets), so the query layer does not import AI code.

### 2. What counts as data egress

Everything a tool returns goes into the model's context, so a tool result *is*
data sent to the provider of the agent that called the tool. Each result is
recorded **once** (re-sending the growing context on later turns is already in
the input tokens). Per source we record: kind (`clickhouse` | `chouse`), source
(`db.table` or the CHouse tool title), columns, rows, result bytes, and the
provider/model of the calling agent. Prompt and response text are **not**
stored.

### 3. Storage — the RBAC database (SQLite / PostgreSQL)

Migration **1.58.0** (idempotent, `IF NOT EXISTS` and guarded column add):

| Table | One row per | Holds |
|---|---|---|
| `ai_usage_requests` | AI request | user, connection, feature, agent, source (`chat` / `feature` / `background`), status, duration, token totals, cost, unpriced and incomplete call counts, ClickHouse query/row/byte totals, egress rows/bytes |
| `ai_usage_steps` | LLM call or tool call | kind, agent path, model or tool name, provider, tokens, cost, price source, `usage_reported`, ClickHouse totals, and a bounded JSON detail (the step's queries) |
| `ai_usage_egress` | data source in a tool result | request, step, time, user, provider, model, kind, source, columns, rows, bytes |

…plus a nullable `pricing` JSON column on `rbac_ai_models`. Timestamps are unix
milliseconds; indexes on `started_at`, `(user_id, started_at)`, `request_id` and
`(started_at, source)` for egress.

Writes happen once per request, after it finishes, and never fail or slow the
AI call (errors are logged). Every replica writes to the shared database, so no
lease is needed (ADR 0010). Rows older than `AI_USAGE_RETENTION_DAYS` (default
**30**) are deleted hourly by every replica; the delete is idempotent.

### 4. Pricing — admin-entered, optional

`rbac_ai_models.pricing` = `{ input, output, cacheRead?, cacheWrite? }` in USD
per 1M tokens, edited on the existing model form. Cost per LLM step:

```
uncached = max(0, input − cacheRead − cacheWrite)
cost = (uncached·input + cacheRead·(cacheRead ?? input) + cacheWrite·(cacheWrite ?? input)
        + billedOutput·output) / 1e6
```

Cost is computed **when the request is written** and stored with
`price_source` (`model` or `none`), so a later price change never rewrites
history. A model without a price stores `cost = NULL`, never 0. The UI then
shows "–", labels totals "priced models only", and names the unpriced models.
A bundled or fetched price catalog is a deliberate non-goal for now (staleness,
model-ID matching, outbound network calls).

### 5. Access

- New permission **`ai_usage:view`**: see everyone's AI usage and egress.
  Granted to Super Admin and Admin by the migration.
- Users with `ai:chat` or `ai:optimize` but not `ai_usage:view` see **their own**
  requests only; the API scopes every query to the caller.
- The tab is **AI Governance › AI activity** (`/ai/usage`).

### 6. API (`/api/ai-usage`, RBAC-authenticated)

`GET /summary`, `/egress`, `/models`, `/requests`, `/requests/:id`, each with a
`days` window (1–30, capped at retention). All are scoped as in §5.

### 7. UI

AI Governance › **AI activity**: KPI tiles (requests, tokens, estimated cost,
ClickHouse read by AI, data sent to providers), an *unpriced models* banner,
**Data sent to providers** by source, **Usage by model**, and **Recent AI
requests** with a detail sheet that lists the steps: LLM calls with tokens and
cost; tool calls with their sources, rows and ClickHouse queries. A query on
the active connection links to `/monitoring/logs?q=<query_id>&at=<ms>` (`at`
widens Query logs' default 6-hour window to the last N hours that cover the
query; a relative window, because ClickHouse evaluates it on its own clock
while a from/to range would be read in the server's time zone); a query on
another connection names that connection instead of linking to a search that
cannot find it. The model form in
Admin › AI Models gets four optional price fields.

## Consequences

- Every AI run gains a small fixed cost: one handler per model, a wrapper per
  tool call, and one batched write per request.
- `ClickHouseService.executeQuery` gains an optional observer hook; behaviour is
  unchanged when no AI run is active.
- AI queries now carry a `query_id` and an `ai_request_id` in `log_comment`, so
  `system.query_log` attributes them to the AI request too.
- Token totals are a lower bound when a call reports no usage; the UI says so.
- Cost is only as good as the admin's prices; unpriced models are visible, not
  hidden.
- New env var `AI_USAGE_RETENTION_DAYS` flows through the chart's `config:` map;
  no chart template change.

## Alternatives considered

- **Full prompt/response capture (Langfuse-style).** Rejected for now: a new
  store of sensitive text with little added value, since chat already keeps the
  prompt and final answer. Can be added later behind a separate permission.
- **Bundled or fetched price catalog (models.dev, LiteLLM).** Deferred: it needs
  upkeep and model-ID matching, and fetching adds outbound calls and an env var.
- **Joining `system.query_log` for per-step cost.** Rejected: needs `query_log`
  access on every connection, waits for the log flush, and the observe
  collector only keeps rollups. `executeQuery` statistics are exact and
  immediate.
- **Tagging trace ids in the client-level `log_comment`.** Rejected: the client
  cache is keyed on it, so it would create a ClickHouse client per run.
- **Writing traces to a ClickHouse table.** Deferred: CHouse does not own a
  ClickHouse cluster; the RBAC database works for every install.
- **Budgets on tokens or cost.** Deferred until the numbers are in use.
- **PII column badges.** Rejected here: there is no column classification to
  base them on.
