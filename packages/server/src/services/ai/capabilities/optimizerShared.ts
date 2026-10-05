/**
 * Shared output contracts for the SQL-editor optimizer features (optimize-query,
 * debug-query, check-optimize) and optimize-log. Their prompts, tools and
 * skills belong to the bound agents in the registry (ADR 0019).
 */

import { z } from "zod";
import type { EstimateFigures } from "./fleetShared";

/**
 * Remove any trailing FORMAT clause the AI may have appended — the app passes
 * FORMAT to ClickHouse itself, so a FORMAT in the text causes a duplicate-format
 * error at execution time.
 */
export function stripFormatClause(sql: string): string {
  return sql
    .replace(/\s*;\s*$/, "")
    .replace(/\s+FORMAT\s+\w+\s*$/i, "")
    .trimEnd();
}

/** Strip a leading ```sql fence the model sometimes wraps the query in. */
export function unfence(sql: string): string {
  let q = sql.trim();
  if (q.startsWith("```")) {
    q = q.replace(/^```(?:sql)?\s*/i, "").replace(/\s*```$/, "");
  }
  return q;
}

/** Per-table finding shared by both optimizers (and the fleet heavy-query analysis). */
export const OptimizationTableSchema = z.object({
  name: z.string(),
  // `.nullish()`, never a bare `.optional()`: strict structured-output modes
  // reject optional fields that cannot be emitted as null.
  engine: z.string().nullish(),
  rows: z.string().nullish(),
  note: z.string(),
});

/**
 * Unified agent-output schema for BOTH optimize-query and optimize-log.
 * The model produces all of these; the backend fills `estimate` (EXPLAIN),
 * `originalQuery`, `warnings`, and the log context in `finalize`.
 */
export const QueryOptimizationOutputSchema = z.object({
  optimizedQuery: z.string().describe("The full optimized SQL query, pretty-printed and runnable."),
  summary: z.string().describe("A one-line headline of the main improvement (e.g., 'Replaced WHERE with PREWHERE')."),
  explanation: z
    .string()
    .describe("A detailed markdown explanation of WHY the original is slow/heavy and HOW the rewrite improves it."),
  cause: z
    .string()
    .describe("The grounded root cause of the inefficiency (e.g. 'scans every partition — no filter on the partition key')."),
  tables: z
    .array(OptimizationTableSchema)
    .describe("Per-table findings for the tables the query reads (name, engine, rows, the issue)."),
  suggestions: z
    .array(z.string())
    .describe("Concrete, actionable optimization steps grounded in the data gathered."),
});

/**
 * Unified RESULT type returned by both optimizer capabilities to the frontend.
 * A superset: narrative (summary/explanation) + data-grounded analysis
 * (cause/tables/suggestions) + backend-computed before→after EXPLAIN estimate.
 */
export interface QueryOptimization {
  originalQuery: string;
  optimizedQuery: string;
  summary: string;
  explanation: string;
  cause: string;
  tables: { name: string; engine?: string | null; rows?: string | null; note: string }[];
  suggestions: string[];
  /** before→after EXPLAIN ESTIMATE (rows/parts/marks) — computed by the backend. */
  estimate?: { before?: EstimateFigures; after?: EstimateFigures };
  /** Table-access warnings (optimize-query path). */
  warnings?: string[];
  /** Log context (optimize-log path). */
  peakMemory?: string;
  user?: string;
  node?: string;
}

export const DebugOutputSchema = z.object({
  fixedQuery: z.string().describe("The fully corrected SQL query"),
  errorAnalysis: z.string().describe("Concise explanation of the error cause"),
  explanation: z.string().describe("Detailed markdown explanation of the fix"),
  summary: z.string().describe("One-line summary of the fix"),
});

export const EvaluatorOutputSchema = z.object({
  canOptimize: z.boolean().describe("Whether significant optimization is possible"),
  reason: z.string().describe("Brief reason for the decision"),
});
