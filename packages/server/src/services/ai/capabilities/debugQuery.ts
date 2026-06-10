/**
 * Capability: debug-query — the SQL editor "Debug" dialog (opens on failure).
 * Loads the debugger skill, inspects DDL, validates the fix, returns a
 * structured DebugResult.
 */

import { z } from "zod";
import type { ModelMessage, ToolSet } from "ai";
import { PERMISSIONS } from "../../../rbac/schema/base";
import { coreTools } from "../toolsets";
import type { StructuredCapability } from "../types";
import {
  DebugOutputSchema,
  DEBUGGER_INSTRUCTIONS,
  buildDebugPrompt,
  loadSkillTool,
  stripFormatClause,
  unfence,
} from "./optimizerShared";

export interface DebugQueryInput {
  query: string;
  error: string;
  additionalPrompt?: string;
  database?: string;
}

export interface DebugResult {
  fixedQuery: string;
  originalQuery: string;
  errorAnalysis: string;
  explanation: string;
  summary: string;
}

interface Prepared {
  query: string;
  error: string;
  additionalPrompt?: string;
}

type Parsed = z.infer<typeof DebugOutputSchema>;

export const debugQueryCapability: StructuredCapability<
  DebugQueryInput,
  Prepared,
  Parsed,
  DebugResult
> = {
  id: "debug-query",
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: z.object({
    query: z.string().min(1, "Query is required"),
    error: z.string().min(1, "Error message is required"),
    additionalPrompt: z.string().optional(),
    database: z.string().optional(),
  }),
  outputSchema: DebugOutputSchema,
  tuning: { stopAtSteps: 10, temperature: 0 },

  prepare(input) {
    return { query: input.query, error: input.error, additionalPrompt: input.additionalPrompt };
  },

  async tools(_prepared, ctx): Promise<ToolSet> {
    return { ...(await loadSkillTool()), ...coreTools(ctx) };
  },

  instructions() {
    return DEBUGGER_INSTRUCTIONS;
  },

  messages(prepared): ModelMessage[] {
    return [
      { role: "user", content: buildDebugPrompt(prepared.query, prepared.error, prepared.additionalPrompt) },
    ];
  },

  finalize(parsed, prepared) {
    return {
      originalQuery: prepared.query,
      fixedQuery: stripFormatClause(unfence(parsed.fixedQuery)),
      errorAnalysis: parsed.errorAnalysis,
      explanation: parsed.explanation,
      summary: parsed.summary,
    };
  },
};
