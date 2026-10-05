/**
 * Feature: check-optimize — lightweight background pre-screen that decides
 * whether a query is worth optimizing. Degrades gracefully (never throws) via
 * softFail so the SQL editor's silent check stays silent — including when its
 * agent binding is missing.
 */

import { z } from "zod";
import { AppError } from "../../../types";
import { PERMISSIONS } from "../../../rbac/schema/base";
import type { StructuredCapability } from "../types";
import { EvaluatorOutputSchema } from "./optimizerShared";

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
  title: "Optimization pre-screen",
  description: "SQL editor: silently decides whether a query is worth optimizing before offering Optimize.",
  surface: "sql-editor",
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  // Session tools are offered only when a live session is present.
  contexts: ["session"],
  variables: {
    query: { type: "string", description: "The query to evaluate (trimmed)." },
  },
  inputSchema: z.object({ query: z.string().min(1, "Query is required") }),
  outputSchema: EvaluatorOutputSchema,

  prepare(input) {
    return { query: input.query };
  },

  templateVariables(prepared) {
    return { query: prepared.query.trim() };
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
