/**
 * Shared bits for the SQL-editor optimizer capabilities (optimize-query,
 * debug-query, check-optimize). These use the session/service-based core tools
 * + the `load_skill` tool to pull detailed instructions from
 * src/skills/ai-optimizer/* at run time.
 */

import { z } from "zod";
import { discoverSkills, createLoadSkillTool } from "../../agentSkills";
import { discoverReferences, createLoadReferenceTool } from "../../agentReferences";
import type { EstimateFigures } from "./fleetShared";
import type { ToolSet } from "ai";

/** Skill directory for the optimizer/debugger/evaluator SKILL.md files. */
export const OPTIMIZER_SKILL_DIR = "../skills/ai-optimizer";
const REFERENCES_DIR = "../references";

/**
 * Build the `load_skill` + `load_reference` tools for the optimizer family, so
 * the agent can pull the query-optimizer/debugger/evaluator skill AND the
 * ClickHouse playbook / type-codec reference on demand.
 */
export async function loadSkillTool(): Promise<ToolSet> {
  const [skills, references] = await Promise.all([
    discoverSkills([OPTIMIZER_SKILL_DIR]),
    discoverReferences([REFERENCES_DIR]),
  ]);
  return {
    load_skill: createLoadSkillTool(skills),
    load_reference: createLoadReferenceTool(references),
  } as ToolSet;
}

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
  engine: z.string().optional(),
  rows: z.string().optional(),
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
  tables: { name: string; engine?: string; rows?: string; note: string }[];
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

export function buildOptimizationPrompt(query: string, additionalPrompt?: string): string {
  let prompt = `Optimize this ClickHouse SQL query:

\`\`\`sql
${query.trim()}
\`\`\`

Use your tools to:
1. Load the \`query-optimizer\` skill for detailed instructions.
2. Fetch the DDL for all tables referenced in the query using \`get_table_ddl\`.
3. Run \`explain_query\` to understand the current execution plan.
4. Produce the optimized query as a JSON response matching the exact schema specified in the optimizer skill.`;
  if (additionalPrompt?.trim()) {
    prompt += `\n\nAdditional instructions from the user:\n${additionalPrompt.trim()}`;
  }
  return prompt;
}

export function buildDebugPrompt(query: string, error: string, additionalPrompt?: string): string {
  let prompt = `Debug this failed ClickHouse SQL query:

\`\`\`sql
${query.trim()}
\`\`\`

Error:
\`\`\`
${error.trim()}
\`\`\`

Use your tools to:
1. Load the \`query-debugger\` skill for detailed instructions.
2. Fetch the DDL for tables referenced in the query using \`get_table_ddl\`.
3. Validate the corrected query with \`validate_sql\`.
4. Produce the fixed query as a JSON response matching the exact schema specified in the debugger skill.`;
  if (additionalPrompt?.trim()) {
    prompt += `\n\nAdditional instructions from the user:\n${additionalPrompt.trim()}`;
  }
  return prompt;
}

/**
 * Shared formatting rule — the AI is the ONLY formatter. The client no longer
 * reformats AI output (sql-formatter's keywordCase:"upper" uppercased
 * case-sensitive ClickHouse function/identifier names and broke queries), so the
 * model must return SQL that is both pretty AND runnable.
 */
export const SQL_PRETTY_RULE = `FORMAT the SQL prettily and return it runnable: multi-line with 2-space indentation, one major clause per line (SELECT / FROM / JOIN / WHERE / GROUP BY / ORDER BY / LIMIT). SQL keywords UPPERCASE, but PRESERVE the EXACT original case of every identifier, database, table, column, alias and function name — ClickHouse is case-sensitive (e.g. \`toStartOfInterval\`, \`argMax\`, \`LowCardinality\`, \`uniqExact\`). Output the raw SQL string only — no markdown code fences, no trailing FORMAT clause.`;

export const OPTIMIZER_INSTRUCTIONS = `You are an expert ClickHouse Query Optimizer agent.
Your job is to analyze and optimize SQL queries using the available tools.

WORKFLOW (follow this order strictly):
1. Call \`load_skill\` with name "query-optimizer" to load your detailed instructions.
2. Use \`get_table_ddl\` (and \`get_table_size\`) for every table referenced in the query to ground per-table findings.
3. Use \`explain_query\` to understand the current execution plan.
4. Produce ONLY a JSON object (no markdown, no extra text) matching this exact schema:
   {
     "optimizedQuery": "<full optimized SQL>",
     "summary": "<one-line headline of the main improvement>",
     "explanation": "<detailed markdown explanation of why the original is slow and how the rewrite fixes it>",
     "cause": "<the grounded root cause of the inefficiency>",
     "tables": [{ "name": "db.table", "engine": "<engine>", "rows": "<e.g. 2.3B>", "note": "<the issue for this table>" }],
     "suggestions": ["<concrete, data-grounded optimization step>", "..."]
   }

${SQL_PRETTY_RULE}`;

export const DEBUGGER_INSTRUCTIONS = `You are an expert ClickHouse Query Debugger agent.
Your job is to diagnose and fix failed SQL queries using the available tools.

WORKFLOW (follow this order strictly):
1. Call \`load_skill\` with name "query-debugger" to load your detailed instructions.
2. Use \`get_table_ddl\` or \`get_table_schema\` for tables referenced in the query.
3. Use \`validate_sql\` to verify the corrected query is syntactically valid.
4. Produce ONLY a JSON object (no markdown, no extra text) matching this exact schema:
   {
     "fixedQuery": "<fully corrected SQL>",
     "errorAnalysis": "<concise cause of error>",
     "explanation": "<detailed markdown explanation of the fix>",
     "summary": "<one-line summary of the fix>"
   }

${SQL_PRETTY_RULE}`;

export const EVALUATOR_INSTRUCTIONS = `You are a ClickHouse query evaluator performing a rapid pre-screening check.
Load the "query-evaluator" skill for detailed instructions, then evaluate the query.
Produce ONLY a JSON object (no markdown, no extra text):
{ "canOptimize": true|false, "reason": "<one sentence>" }`;
