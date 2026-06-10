/**
 * Capability: optimize-log — optimize one query the operator points at from the
 * Query Logs view (by query_id) or by raw text. Resolves the full query from
 * system.query_log, runs the read-only investigator, and proves the rewrite
 * with a before→after EXPLAIN ESTIMATE computed by the backend.
 */

import { z } from "zod";
import type { ModelMessage, ToolSet } from "ai";
import { AppError } from "../../../types";
import { PERMISSIONS } from "../../../rbac/schema/base";
import { CLICKHOUSE_PLAYBOOK } from "../../clickhousePlaybook";
import {
  SYSTEM_TABLE_REFERENCE,
  type FleetNode,
  queryNodeTool,
  resolveNode,
  fetchQueryById,
  cleanQueryForOptimize,
  explainEstimate,
} from "./fleetShared";
import { QueryOptimizationOutputSchema, type QueryOptimization } from "./optimizerShared";
import type { StructuredCapability } from "../types";

export interface OptimizeLogInput {
  queryId?: string;
  query?: string;
}

type Parsed = z.infer<typeof QueryOptimizationOutputSchema>;

const SINGLE_OPTIMIZE_PROMPT = `You optimize ONE heavy ClickHouse query. You are given the query text and its observed peak memory.

Investigate FAST with the read-only \`query_node\` tool (the connectionId to use is in the user message). Inspect ONLY cheap metadata for the tables this query reads — system.tables (engine, total_rows), system.columns (types; spot the wide / high-cardinality columns), system.parts (active parts, partitioning). Do NOT scan system.query_log. Stay tight: at most ~2 tables and a few cheap lookups, then write the answer.

Find WHY it eats memory (grounded in the data you gathered, never invented) and produce \`optimizedQuery\` — the optimized version with the fixes applied as concrete, runnable ClickHouse SQL using the REAL table + column names (e.g. push the date filter into the CTEs, argMax(...) instead of ROW_NUMBER() OVER(...) WHERE rn=1, filter/aggregate each side BEFORE the JOIN, LowCardinality, narrow the SELECT, max_bytes_before_external_group_by).

HARD REQUIREMENTS — the optimized query MUST:
  • return the EXACT SAME result as the original — same columns, same rows, same values (optimize only HOW data is read/computed, never WHAT it returns);
  • keep the business logic 100% unchanged;
  • target < 1 minute runtime and < 1 GB peak memory;
  • be COMPLETE and VALID — reproduce every CTE / SELECT / JOIN / WHERE / GROUP BY / ORDER BY / window in full so it parses and EXPLAINs cleanly (NO "…" / "-- omitted" placeholders, never abbreviate static lists).

Return JSON only: { "optimizedQuery": "<the full optimized SQL>", "summary": "<one-line headline of the main improvement>", "explanation": "<short markdown explanation of why it was heavy and how the rewrite fixes it>", "cause": "...", "tables": [{ "name": "db.table", "engine": "MergeTree", "rows": "2.3B", "note": "the issue" }], "suggestions": ["concrete, data-grounded", "..."] }. Do NOT include any EXPLAIN/estimate — the system computes the before→after proof itself.

FORMAT \`optimizedQuery\` prettily and runnable: multi-line, 2-space indentation, one major clause per line. SQL keywords UPPERCASE, but PRESERVE the EXACT original case of every identifier, table, column, alias and function name — ClickHouse is case-sensitive (e.g. \`toStartOfInterval\`, \`argMax\`, \`LowCardinality\`). No markdown fences, no trailing FORMAT clause.

${SYSTEM_TABLE_REFERENCE}`;

interface Prepared {
  node: FleetNode;
  connectionId: string;
  cleaned: string;
  peakMemory?: string;
  user?: string;
}

export const optimizeLogCapability: StructuredCapability<
  OptimizeLogInput,
  Prepared,
  Parsed,
  QueryOptimization
> = {
  id: "optimize-log",
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: z
    .object({ queryId: z.string().optional(), query: z.string().optional() })
    .refine((v) => v.queryId || v.query, { message: "queryId or query is required" }),
  outputSchema: QueryOptimizationOutputSchema,
  tuning: { stopAtSteps: 8, temperature: 0.1, maxOutputTokens: 16000 },

  async prepare(input, ctx) {
    if (!ctx.connectionId) throw AppError.badRequest("No active ClickHouse connection.");
    const node = await resolveNode(ctx.connectionId);

    let queryText = (input.query ?? "").trim();
    let peakMemory: string | undefined;
    let user: string | undefined;
    if (input.queryId) {
      const fetched = await fetchQueryById(ctx.connectionId, input.queryId);
      if (fetched) {
        queryText = fetched.query;
        peakMemory = fetched.peakMemory;
        user = fetched.user;
      }
    }
    const cleaned = cleanQueryForOptimize(queryText);
    if (!cleaned) throw AppError.badRequest("Could not find the query text to optimize");
    if (!/^(select|with)\b/i.test(cleaned)) {
      throw AppError.badRequest("Only SELECT / WITH queries can be optimized (read-only)");
    }
    return { node, connectionId: ctx.connectionId, cleaned, peakMemory, user };
  },

  tools(prepared): ToolSet {
    return queryNodeTool([prepared.node]) as ToolSet;
  },

  instructions: () => `${SINGLE_OPTIMIZE_PROMPT}\n\n${CLICKHOUSE_PLAYBOOK}`,

  messages(prepared): ModelMessage[] {
    const { node, cleaned, peakMemory } = prepared;
    return [
      {
        role: "user",
        content: `Node id: "${node.id}" (name: ${node.name}). Observed peak memory: ${peakMemory ?? "unknown"}. Investigate this query's tables with query_node (connectionId="${node.id}") and produce the optimized version.\n\n\`\`\`sql\n${cleaned.slice(0, 8000)}\n\`\`\``,
      },
    ];
  },

  fallbackMessages(prepared, _ctx, raw): ModelMessage[] {
    return [
      { role: "system", content: SINGLE_OPTIMIZE_PROMPT },
      {
        role: "user",
        content: `Query:\n\`\`\`sql\n${prepared.cleaned.slice(0, 8000)}\n\`\`\`\n\nInvestigation notes (may be empty):\n${raw || "(none)"}\n\nProduce the optimized query now.`,
      },
    ];
  },

  async finalize(parsed, prepared) {
    const [before, after] = await Promise.all([
      explainEstimate(prepared.connectionId, prepared.cleaned),
      parsed.optimizedQuery
        ? explainEstimate(prepared.connectionId, parsed.optimizedQuery)
        : Promise.resolve(null),
    ]);
    return {
      originalQuery: prepared.cleaned,
      optimizedQuery: parsed.optimizedQuery,
      summary: parsed.summary,
      explanation: parsed.explanation,
      cause: parsed.cause,
      tables: parsed.tables,
      suggestions: parsed.suggestions,
      estimate: before || after ? { before: before ?? undefined, after: after ?? undefined } : undefined,
      node: prepared.node.name,
      peakMemory: prepared.peakMemory,
      user: prepared.user,
    };
  },
};
