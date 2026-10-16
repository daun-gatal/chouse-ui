type: minor

### Added
- **AI activity** — New **AI Governance › AI activity** tab (ADR 0020) that records every chat and AI feature request: tokens, estimated cost, the ClickHouse queries its tools ran with what they read, and the tables, columns and CHouse records sent to the LLM provider. Open a request to follow each LLM and tool call, down to the query in Query logs. Prompt and response text are not stored. `ai_usage:view` (granted to Admin and Super Admin) shows everyone's requests; users with `ai:chat` or `ai:optimize` see their own. AI queries carry a `chouse-ai-…` query id and an `ai_request_id` in `log_comment`.
- **Model prices** — Admin › AI Models › Provider models takes an optional price per 1M tokens (input, output, cached input, cache write) to estimate cost. Models without a price show tokens only.
- **`AI_USAGE_RETENTION_DAYS`** — Days of AI usage kept (default 30).
