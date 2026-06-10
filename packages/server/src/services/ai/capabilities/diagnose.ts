/**
 * Capabilities: diagnose-error / diagnose-parts / diagnose-schema.
 *
 * All three are read-only single-node investigators that return the shared
 * ErrorDiagnosis shape. They differ only in prompt, the user message, and the
 * `name` field of the result — so they share a builder.
 */

import { z } from "zod";
import type { ModelMessage, ToolSet } from "ai";
import { AppError } from "../../../types";
import { PERMISSIONS } from "../../../rbac/schema/base";
import { CLICKHOUSE_PLAYBOOK } from "../../clickhousePlaybook";
import {
  ErrorDiagnosisSchema,
  type ErrorDiagnosis,
  type ParsedDiagnosis,
  type FleetNode,
  queryNodeTool,
  resolveNode,
} from "./fleetShared";
import {
  ERROR_DIAGNOSE_PROMPT,
  PARTS_DIAGNOSE_PROMPT,
  SCHEMA_DIAGNOSE_PROMPT,
} from "./diagnosePrompts";
import type { StructuredCapability } from "../types";

interface NodePrepared {
  node: FleetNode;
}

const DIAGNOSE_TUNING = { stopAtSteps: 8, temperature: 0.1, maxOutputTokens: 8000 };

/**
 * Shared lifecycle for a single-node diagnosis: resolve the node from the
 * session's connection, expose the query_node tool, and run the prompt.
 */
function resolveNodePrepared(ctx: { connectionId?: string }): Promise<NodePrepared> {
  if (!ctx.connectionId) {
    throw AppError.badRequest("No active ClickHouse connection.");
  }
  return resolveNode(ctx.connectionId).then((node) => ({ node }));
}

function diagnoseTools(prepared: NodePrepared): ToolSet {
  return queryNodeTool([prepared.node]) as ToolSet;
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
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: z.object({
    name: z.string().min(1),
    code: z.number().int().optional(),
    message: z.string().optional(),
  }),
  outputSchema: ErrorDiagnosisSchema,
  tuning: DIAGNOSE_TUNING,

  async prepare(input, ctx) {
    return { ...(await resolveNodePrepared(ctx)), input };
  },
  tools: diagnoseTools,
  instructions: () => `${ERROR_DIAGNOSE_PROMPT}\n\n${CLICKHOUSE_PLAYBOOK}`,
  messages(prepared): ModelMessage[] {
    const { node, input } = prepared;
    return [
      {
        role: "user",
        content: `Node id: "${node.id}" (name: ${node.name}). Diagnose this ClickHouse error and give a solution.\n\nCode: ${input.code ?? "?"}\nName: ${input.name}\nLast message: ${input.message ?? "(none)"}\n\nInvestigate with query_node (connectionId="${node.id}") if useful, then return the structured diagnosis.`,
      },
    ];
  },
  fallbackMessages(prepared, _ctx, raw): ModelMessage[] {
    const { input } = prepared;
    return [
      { role: "system", content: ERROR_DIAGNOSE_PROMPT },
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
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
  inputSchema: z.object({ database: z.string().min(1), table: z.string().min(1) }),
  outputSchema: ErrorDiagnosisSchema,
  tuning: DIAGNOSE_TUNING,

  async prepare(input, ctx) {
    return { ...(await resolveNodePrepared(ctx)), input };
  },
  tools: diagnoseTools,
  instructions: () => `${PARTS_DIAGNOSE_PROMPT}\n\n${CLICKHOUSE_PLAYBOOK}`,
  messages(prepared): ModelMessage[] {
    const { node, input } = prepared;
    return [
      {
        role: "user",
        content: `Node id: "${node.id}" (name: ${node.name}). Diagnose the part/partition health of table \`${input.database}.${input.table}\` and give a solution. Investigate with query_node (connectionId="${node.id}"), then return the structured diagnosis.`,
      },
    ];
  },
  fallbackMessages(prepared, _ctx, raw): ModelMessage[] {
    const { input } = prepared;
    return [
      { role: "system", content: PARTS_DIAGNOSE_PROMPT },
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
  delivery: "structured",
  permission: PERMISSIONS.AI_OPTIMIZE,
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
  tuning: DIAGNOSE_TUNING,

  async prepare(input, ctx) {
    return { ...(await resolveNodePrepared(ctx)), input };
  },
  tools: diagnoseTools,
  instructions: () => `${SCHEMA_DIAGNOSE_PROMPT}\n\n${CLICKHOUSE_PLAYBOOK}`,
  messages(prepared): ModelMessage[] {
    const { node, input } = prepared;
    const sizeLine = schemaSizeLine(input.metrics);
    return [
      {
        role: "user",
        content: `Node id: "${node.id}" (name: ${node.name}). Database: ${input.database}. Table: ${input.table}. Column: \`${input.column}\` (type: ${input.columnType}). Issue category: ${input.category}.\n${sizeLine}\nInvestigate with query_node (connectionId="${node.id}") and produce the structured diagnosis with a concrete ALTER TABLE fix.`,
      },
    ];
  },
  fallbackMessages(prepared, _ctx, raw): ModelMessage[] {
    const { input } = prepared;
    const sizeLine = schemaSizeLine(input.metrics);
    return [
      { role: "system", content: SCHEMA_DIAGNOSE_PROMPT },
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
