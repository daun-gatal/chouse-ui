/**
 * Features: diagnose-error / diagnose-parts / diagnose-schema.
 *
 * All three are read-only single-node investigations that return the shared
 * ErrorDiagnosis shape. Each is bound to its own agent in the registry; the
 * features supply the node and the finding as template variables.
 */

import { z } from "zod";
import type { AgentMessage } from "../types";
import { AppError } from "../../../types";
import { PERMISSIONS } from "../../../rbac/schema/base";
import {
  ErrorDiagnosisSchema,
  type ErrorDiagnosis,
  type ParsedDiagnosis,
  type FleetNode,
  resolveNode,
} from "./fleetShared";
import type { StructuredCapability } from "../types";

interface NodePrepared {
  node: FleetNode;
}

const NODE_VARIABLES = {
  "node.id": { type: "string", description: "Connection id of the node under investigation." },
  "node.name": { type: "string", description: "Connection name of that node." },
} as const;

/** Resolve the node from the session's connection. */
function resolveNodePrepared(ctx: { connectionId?: string }): Promise<NodePrepared> {
  if (!ctx.connectionId) {
    throw AppError.badRequest("No active ClickHouse connection.");
  }
  return resolveNode(ctx.connectionId).then((node) => ({ node }));
}

function nodeVariables(prepared: NodePrepared): Record<string, string> {
  return { "node.id": prepared.node.id, "node.name": prepared.node.name };
}

// ============================================
// diagnose-error
// ============================================

export interface DiagnoseErrorInput {
  name: string;
  code?: number;
  message?: string;
}

export const diagnoseErrorCapability: StructuredCapability<
  DiagnoseErrorInput,
  NodePrepared & { input: DiagnoseErrorInput },
  ParsedDiagnosis,
  ErrorDiagnosis
> = {
  id: "diagnose-error",
  title: "Diagnose a server error",
  description: "Errors › Diagnose: explains one server error from system.errors and gives a concrete fix.",
  surface: "diagnostics",
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  contexts: ["fleet"],
  variables: {
    ...NODE_VARIABLES,
    "error.code": { type: "string", description: "Error code, or \"?\"." },
    "error.name": { type: "string", description: "Error name, e.g. TOO_MANY_PARTS." },
    "error.message": { type: "string", description: "Last error message, or \"(none)\"." },
  },
  inputSchema: z.object({
    name: z.string().min(1),
    code: z.number().int().optional(),
    message: z.string().optional(),
  }),
  outputSchema: ErrorDiagnosisSchema,

  async prepare(input, ctx) {
    return { ...(await resolveNodePrepared(ctx)), input };
  },
  fleetNodes: (prepared) => [prepared.node],
  templateVariables(prepared) {
    const { input } = prepared;
    return {
      ...nodeVariables(prepared),
      "error.code": String(input.code ?? "?"),
      "error.name": input.name,
      "error.message": input.message ?? "(none)",
    };
  },
  fallbackMessages(prepared, _ctx, raw, prompts): AgentMessage[] {
    const { input } = prepared;
    return [
      { role: "system", content: prompts.core },
      {
        role: "user",
        content: `Error — Code: ${input.code ?? "?"}, Name: ${input.name}, Last message: ${input.message ?? "(none)"}.\n\nInvestigation notes (may be empty):\n${raw || "(none)"}\n\nProduce the structured diagnosis now.`,
      },
    ];
  },
  finalize(parsed, prepared) {
    return {
      code: prepared.input.code,
      name: prepared.input.name,
      summary: parsed.summary,
      cause: parsed.cause,
      impact: parsed.impact,
      solutions: parsed.solutions,
    };
  },
};

// ============================================
// diagnose-parts
// ============================================

export interface DiagnosePartsInput {
  database: string;
  table: string;
}

export const diagnosePartsCapability: StructuredCapability<
  DiagnosePartsInput,
  NodePrepared & { input: DiagnosePartsInput },
  ParsedDiagnosis,
  ErrorDiagnosis
> = {
  id: "diagnose-parts",
  title: "Diagnose part health",
  description: "Parts › Diagnose: explains part and partition health of one MergeTree table.",
  surface: "diagnostics",
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  contexts: ["fleet"],
  variables: {
    ...NODE_VARIABLES,
    database: { type: "string", description: "Database of the table." },
    table: { type: "string", description: "Table name." },
  },
  inputSchema: z.object({ database: z.string().min(1), table: z.string().min(1) }),
  outputSchema: ErrorDiagnosisSchema,

  async prepare(input, ctx) {
    return { ...(await resolveNodePrepared(ctx)), input };
  },
  fleetNodes: (prepared) => [prepared.node],
  templateVariables(prepared) {
    return { ...nodeVariables(prepared), database: prepared.input.database, table: prepared.input.table };
  },
  fallbackMessages(prepared, _ctx, raw, prompts): AgentMessage[] {
    const { input } = prepared;
    return [
      { role: "system", content: prompts.core },
      {
        role: "user",
        content: `Table ${input.database}.${input.table}.\n\nInvestigation notes (may be empty):\n${raw || "(none)"}\n\nProduce the structured diagnosis now.`,
      },
    ];
  },
  finalize(parsed, prepared) {
    return {
      name: `${prepared.input.database}.${prepared.input.table}`,
      summary: parsed.summary,
      cause: parsed.cause,
      impact: parsed.impact,
      solutions: parsed.solutions,
    };
  },
};

// ============================================
// diagnose-schema
// ============================================

export interface DiagnoseSchemaInput {
  database: string;
  table: string;
  column: string;
  columnType: string;
  category: "nullable" | "oversized" | "compression";
  metrics?: { totalRows?: number; compressedBytes?: number; uncompressedBytes?: number };
}

function schemaSizeLine(m: DiagnoseSchemaInput["metrics"]): string {
  const mm = m ?? {};
  const ratio =
    mm.compressedBytes && mm.uncompressedBytes && mm.compressedBytes > 0
      ? (mm.uncompressedBytes / mm.compressedBytes).toFixed(2) + "x"
      : "n/a";
  return mm.totalRows != null || mm.compressedBytes != null
    ? `Current size: rows=${mm.totalRows ?? "?"}, on-disk=${mm.compressedBytes ?? "?"} bytes, uncompressed=${mm.uncompressedBytes ?? "?"} bytes, ratio=${ratio}.`
    : "";
}

export const diagnoseSchemaCapability: StructuredCapability<
  DiagnoseSchemaInput,
  NodePrepared & { input: DiagnoseSchemaInput },
  ParsedDiagnosis,
  ErrorDiagnosis
> = {
  id: "diagnose-schema",
  title: "Diagnose a schema finding",
  description: "Schema Advisor › Diagnose: turns one column-level finding into a concrete ALTER TABLE fix.",
  surface: "diagnostics",
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  contexts: ["fleet"],
  variables: {
    ...NODE_VARIABLES,
    database: { type: "string", description: "Database of the table." },
    table: { type: "string", description: "Table name." },
    column: { type: "string", description: "Column name." },
    columnType: { type: "string", description: "Current column type." },
    category: { type: "string", description: "Finding category: nullable, oversized or compression." },
    sizeLine: { type: "string", description: "One line with rows / on-disk / uncompressed bytes, or empty." },
  },
  inputSchema: z.object({
    database: z.string().min(1),
    table: z.string().min(1),
    column: z.string().min(1),
    columnType: z.string().min(1),
    category: z.enum(["nullable", "oversized", "compression"]),
    metrics: z
      .object({
        totalRows: z.number().optional(),
        compressedBytes: z.number().optional(),
        uncompressedBytes: z.number().optional(),
      })
      .optional(),
  }),
  outputSchema: ErrorDiagnosisSchema,

  async prepare(input, ctx) {
    return { ...(await resolveNodePrepared(ctx)), input };
  },
  fleetNodes: (prepared) => [prepared.node],
  templateVariables(prepared) {
    const { input } = prepared;
    return {
      ...nodeVariables(prepared),
      database: input.database,
      table: input.table,
      column: input.column,
      columnType: input.columnType,
      category: input.category,
      sizeLine: schemaSizeLine(input.metrics),
    };
  },
  fallbackMessages(prepared, _ctx, raw, prompts): AgentMessage[] {
    const { input } = prepared;
    const sizeLine = schemaSizeLine(input.metrics);
    return [
      { role: "system", content: prompts.core },
      {
        role: "user",
        content: `Schema issue — db: ${input.database}, table: ${input.table}, column: \`${input.column}\` (${input.columnType}), category: ${input.category}. ${sizeLine}\n\nInvestigation notes (may be empty):\n${raw || "(none)"}\n\nProduce the structured diagnosis now.`,
      },
    ];
  },
  finalize(parsed, prepared) {
    const { input } = prepared;
    return {
      name: `${input.database}.${input.table}.${input.column}`,
      summary: parsed.summary,
      cause: parsed.cause,
      impact: parsed.impact,
      solutions: parsed.solutions,
    };
  },
};
