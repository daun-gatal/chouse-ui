/**
 * Feature: debug-query — the SQL editor "Debug" dialog (opens on failure).
 * The bound agent (registry) inspects DDL, validates the fix and returns a
 * structured DebugResult.
 */

import { z } from "zod";
import { PERMISSIONS } from "../../../rbac/schema/base";
import type { StructuredCapability } from "../types";
import {
  DebugOutputSchema,
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
  title: "Debug query",
  description: "SQL editor › Debug: explains why a query failed and returns a validated fix.",
  surface: "sql-editor",
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  contexts: ["session"],
  variables: {
    query: { type: "string", description: "The failed query (trimmed)." },
    error: { type: "string", description: "The ClickHouse error message (trimmed)." },
    additionalPrompt: { type: "string", description: "Extra instructions from the user (trimmed; empty when none)." },
  },
  inputSchema: z.object({
    query: z.string().min(1, "Query is required"),
    error: z.string().min(1, "Error message is required"),
    additionalPrompt: z.string().optional(),
    database: z.string().optional(),
  }),
  outputSchema: DebugOutputSchema,

  prepare(input) {
    return { query: input.query, error: input.error, additionalPrompt: input.additionalPrompt };
  },

  templateVariables(prepared) {
    return { query: prepared.query.trim(), error: prepared.error.trim(), additionalPrompt: prepared.additionalPrompt?.trim() ?? "" };
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
