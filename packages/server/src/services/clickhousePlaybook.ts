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

export const CLICKHOUSE_PLAYBOOK = `ClickHouse optimization playbook — when you recommend a fix for a heavy/slow query or its schema, ground it here and name the pattern/rule. Patterns compound (combining several can be 50-100×).

A. Query rewrites (the query is shaped badly):
- "Latest per group" via ROW_NUMBER() OVER(PARTITION BY k ORDER BY d DESC) WHERE rn=1 (or QUALIFY) → argMax(col, d) ... GROUP BY k. Avoids materialising every row + its row number; far less memory.
- Predicate pushdown: filter — ideally pre-aggregate — dimension tables in a CTE BEFORE joining the big fact table; shrinks the JOIN hash table 10-1000×. Filtering a dimension column in the FINAL WHERE runs AFTER the join (too late).
- Progressive filtering: layer filters across CTE stages so each stage cuts rows, instead of one giant join then filter.
- Delayed lookup: build per-key lookup/aggregate tables AFTER filtering the fact table, not before — keeps the hash table small.
- Replace nested FROM (SELECT …) subqueries with CTEs that filter early.
- Multiple scans of the same big table over different date ranges → fold into ONE scan (e.g. greatest(date, start) with date <= end).
- Cumulative SUM via window (SUM(x) OVER(… ROWS UNBOUNDED PRECEDING)) on big data → arrayJoin fan-out when cardinality is moderate.
- Big GROUP BY / DISTINCT on high cardinality builds a giant hash table → SET max_bytes_before_external_group_by to spill to disk; never SELECT * (columnar — every extra column is more read bytes).

B. JOIN execution (the usual OOM):
- The default hash join loads the RIGHT table fully into RAM (#1 OOM cause). Keep the SMALLER table on the right; when the big table can't be filtered, FLIP the stages so the smaller/filterable side builds the hash table.
- Large↔large: join_algorithm='grace_hash' or 'partial_merge' (spill to disk), or 'full_sorting_merge' when joined on already-sorted keys.

C. Schema / types (read-amplification → memory):
- WHERE must match the ORDER BY/primary-key prefix left→right, else it's a full scan — the usual root of "scans billions of rows". Order key columns low→high cardinality.
- Unavoidable filter on a non-ORDER BY column → add a data-skipping index (bloom_filter / minmax), after types + key are right.
- LowCardinality(String) for <10K distinct values; smallest int type for the range; avoid Nullable (use DEFAULT) — wide String / Nullable / oversized ints inflate read bytes.
- Partition key should have ~100-1,000 distinct values; over-partitioning → "too many parts". Partitioning is for data lifecycle, not query speed.

D. Mutations / merges:
- Frequent ALTER TABLE UPDATE/DELETE rewrites whole parts (write amplification, I/O spikes) → use ReplacingMergeTree / CollapsingMergeTree for update patterns.
- Avoid OPTIMIZE TABLE … FINAL in routine ops (forces a full merge); the FINAL modifier in SELECT is fine for dedup.

Before claiming a rewrite is safe, note it should be verified by comparing results (count()/sum()/min()/max old vs new). Any change is applied by a human.`;

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
