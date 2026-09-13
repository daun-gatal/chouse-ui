# AI Assist

AI Assist is the schema-aware assistant living in the workspace: an optimizer to rewrite slow queries, a debugger to explain failures, and a chat for open questions about the current schema and data context.

## The three modes

| Mode | Purpose | Gate |
| --- | --- | --- |
| **Optimizer** | Propose a faster rewrite of the query in the editor | `ai:optimize` |
| **Debugger** | Explain an error and suggest fixes | `ai:optimize` |
| **Chat** | Ask anything with schema context attached | `ai:chat` |

Every AI surface shows a **context preview** — exactly which schema pieces and query text were sent — so nothing is invisible. A **model selector** picks the provider/model per call.

## Provider pluggability

Providers are configured under **Admin → AI models** (`ai_models:*` permissions) or via API:

- OpenAI, Anthropic, Google, Azure OpenAI, AWS Bedrock, Groq, Mistral, Cohere, Ollama, xAI, DeepSeek, Cerebras, Fireworks, Together, OpenRouter
- **Any OpenAI-compatible API** works
- Model parameters (temperature, max tokens) configurable per model — see the AI model params in the admin tab

Self-hosting via Ollama keeps prompts inside your network — a common requirement for on-prem ClickHouse.

## Privacy posture

- Only the **schema context** (tables/columns you're working with) and the query text are sent — no data rows
- Chat history is stored server-side and clearable; the [audit log](/docs/audit-log/) records AI usage
- The AI is **read-only and advisory** — it never runs writes, and in-tab optimizations require review before running (see [Chouse AI in-tab](/docs/ai-in-tab/))

## What the AI costs

AI calls spend provider tokens (LLM budget). Control spend by:

- Gating who can invoke AI at all (`ai:optimize` / `ai:chat`)
- Choosing cheaper models for chat; reserving strong models for optimization
- Budget caps at the provider side

## Quick tour

1. Open the [SQL editor](/docs/workspace-editor/) with a slow query.
2. Click the assistant → **Optimize**; compare the rewrite and its EXPLAIN evidence (see [Visual EXPLAIN](/docs/workspace-explain/)).
3. Accept or discard. Accepting just edits the editor — you still run it yourself.
