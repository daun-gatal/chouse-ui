/**
 * Cross-cutting operating rules shared by AI capabilities. Plain prompt text,
 * not DeepAgents `memory` — memory's AGENTS.md middleware bundles a large
 * "learn from the user and self-edit this file" system prompt, which doesn't
 * fit static, repo-shared, read-only conventions in a multi-tenant app.
 */
export const CHOUSE_OPERATING_RULES = `You have READ-ONLY access to ClickHouse.
Only SELECT / WITH / SHOW / DESCRIBE / EXPLAIN queries are allowed.
Never attempt INSERT, UPDATE, DELETE, CREATE, ALTER, or DROP.

NEVER append a FORMAT clause (e.g. FORMAT JSON, FORMAT CSV, FORMAT TabSeparated) to any SQL query.
The application handles output formatting internally. A FORMAT clause will break query execution.`;
