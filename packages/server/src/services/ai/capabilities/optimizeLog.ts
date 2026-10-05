/**
 * Feature: optimize-log — optimize one query the operator points at from the
 * Query Logs view (by query_id) or by raw text. Resolves the full query from
 * system.query_log; the bound agent (registry) investigates read-only through
 * query_node, and finalize proves the rewrite with a before→after EXPLAIN
 * ESTIMATE computed by the backend.
 */

import { z } from "zod";
import type { AgentMessage } from "../types";
import { AppError } from "../../../types";
import { PERMISSIONS } from "../../../rbac/schema/base";
import {
  type FleetNode,
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
  title: "Optimize a heavy query",
  description: "Query Logs › Optimize: rewrites one heavy query from the log, proven with a before→after EXPLAIN estimate.",
  surface: "diagnostics",
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  contexts: ["fleet"],
  variables: {
    "node.id": { type: "string", description: "Connection id of the node the query ran on." },
    "node.name": { type: "string", description: "Connection name of that node." },
    peakMemory: { type: "string", description: "Observed peak memory, or \"unknown\"." },
    query: { type: "string", description: "The cleaned query text (first 8000 characters)." },
  },
  inputSchema: z
    .object({ queryId: z.string().optional(), query: z.string().optional() })
    .refine((v) => v.queryId || v.query, { message: "queryId or query is required" }),
  outputSchema: QueryOptimizationOutputSchema,

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

  fleetNodes: (prepared) => [prepared.node],

  templateVariables(prepared) {
    return {
      "node.id": prepared.node.id,
      "node.name": prepared.node.name,
      peakMemory: prepared.peakMemory ?? "unknown",
      query: prepared.cleaned.slice(0, 8000),
    };
  },

  fallbackMessages(prepared, _ctx, raw, prompts): AgentMessage[] {
    return [
      { role: "system", content: prompts.core },
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
