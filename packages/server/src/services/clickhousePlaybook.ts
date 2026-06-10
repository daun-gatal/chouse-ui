/**
 * clickhousePlaybook — Chouse AI's condensed ClickHouse optimization knowledge.
 *
 * Distilled (our own lean version) from two sources, generic only — no
 * proprietary schemas/queries:
 *   - ClickHouse's official agent-skills "best-practices" rules
 *     (https://github.com/ClickHouse/agent-skills) — joins, types, primary key,
 *     partitioning, mutations, skip indices, query safety.
 *   - Common ClickHouse query-rewrite patterns (argMax, predicate pushdown,
 *     progressive filtering, delayed lookup, single-scan, arrayJoin).
 *
 * Kept OUT of the always-on system prompt and injected only when a scan actually
 * finds a heavy query (see `needsPlaybook`), so a healthy-fleet scan stays light.
 */

import { readReferenceSync } from "./agentReferences";

/**
 * Canonical text lives in `packages/server/src/references/clickhouse-playbook.md`
 * (the single source of truth, also loadable on demand by the chat agent via the
 * `load_reference` tool). Read here as a string so existing consumers
 * (diagnose / optimize-log / fleet-scan) concatenate it into prompts unchanged.
 */
export const CLICKHOUSE_PLAYBOOK = readReferenceSync("clickhouse-playbook.md");

/**
 * Only worth injecting the playbook when the scan actually surfaced a heavy
 * query to optimize — otherwise the prompt stays lean.
 */
export function needsPlaybook(overview: Record<string, unknown>[]): boolean {
  return overview.some((o) => {
    const heavy = Array.isArray(o.recentHeavyQueries) ? o.recentHeavyQueries : [];
    const top = Array.isArray(o.topMemoryQueries) ? o.topMemoryQueries : [];
    return heavy.length > 0 || top.length > 0;
  });
}
