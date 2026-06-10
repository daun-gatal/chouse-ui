/**
 * Capability: check-optimize — lightweight background pre-screen that decides
 * whether a query is worth optimizing. Capped at 4 steps; degrades gracefully
 * (never throws) via softFail so the SQL editor's silent check stays silent.
 */

import { z } from "zod";
import type { ModelMessage, ToolSet } from "ai";
import { AppError } from "../../../types";
import { PERMISSIONS } from "../../../rbac/schema/base";
import { coreTools } from "../toolsets";
import type { StructuredCapability } from "../types";
import { EvaluatorOutputSchema, EVALUATOR_INSTRUCTIONS, loadSkillTool } from "./optimizerShared";

export interface CheckOptimizeInput {
  query: string;
}

export interface OptimizationCheckResult {
  canOptimize: boolean;
  reason: string;
}

interface Prepared {
  query: string;
}

type Parsed = z.infer<typeof EvaluatorOutputSchema>;

export const checkOptimizeCapability: StructuredCapability<
  CheckOptimizeInput,
  Prepared,
  Parsed,
  OptimizationCheckResult
> = {
  id: "check-optimize",
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: z.object({ query: z.string().min(1, "Query is required") }),
  outputSchema: EvaluatorOutputSchema,
  tuning: { stopAtSteps: 4, temperature: 0 },

  prepare(input) {
    return { query: input.query };
  },

  async tools(_prepared, ctx): Promise<ToolSet> {
    const skill = await loadSkillTool();
    // Only a cheap subset of schema tools — and only when a session is present.
    if (!ctx.clickhouseService) return skill;
    const { analyze_query, get_table_ddl, get_table_schema } = coreTools(ctx) as Record<string, unknown>;
    return { ...skill, analyze_query, get_table_ddl, get_table_schema } as ToolSet;
  },

  instructions() {
    return EVALUATOR_INSTRUCTIONS;
  },

  messages(prepared): ModelMessage[] {
    return [{ role: "user", content: `Evaluate this query:\n\`\`\`sql\n${prepared.query.trim()}\n\`\`\`` }];
  },

  finalize(parsed) {
    return { canOptimize: parsed.canOptimize, reason: parsed.reason };
  },

  softFail(error) {
    return {
      canOptimize: false,
      reason: error instanceof AppError ? error.message : "Analysis failed",
    };
  },
};
