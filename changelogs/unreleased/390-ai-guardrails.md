type: minor

### Added
- **AI guardrails** — a new AI Governance › Guardrails tab controls what passes through every run of CHouse's own AI (chat, AI features, every agent and subagent) and, where enabled, every MCP tool result: four stages (user input, tool calls, tool results, model output), log/warn/redact/block actions, a shadow mode that records without changing anything, and fail-closed errors. Eight kinds: patterns with built-in PII and secret detectors, keywords, column masking, prompt-injection shield, SQL safety (read-only, LIMIT, denied tables, EXPLAIN ESTIMATE rows), tool policies, limits and an AI judge. Built-in guardrails on by default: PII redaction and secret detection on tool results, a 1,000-row / 256 KB result cap, the injection shield and per-run call limits. Live test on sample text, revision history, drag to reorder, Draft with AI (built-in *Guardrail Drafter* agent), and a trigger log linked to the AI request that never stores matched values. New permissions `ai_guardrails:view|manage`; MCP tools `list_ai_guardrails` and `list_ai_guardrail_triggers` (ADR 0022)
- **Context window per model** — a provider model's context window drives when agents summarize (at 85% of it) instead of a fixed 170k tokens; detected from LangChain's model list, and required for models not in it
- **One AI model picker** — the Data page's model button is now shared with Dashboards (Ask AI) and AI Governance, per user; the Assistant's agent list switches an agent's model in place

### Changed
- A provider model LangChain does not know (most OpenAI-compatible and local models) must have a context window before it can be saved or run
- A picked AI model that was removed or deactivated is shown as unavailable and AI features fail with a clear error, instead of quietly using the default model
