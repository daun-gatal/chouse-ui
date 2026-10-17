/**
 * Guardrail kinds (ADR 0022 §2): each kind's config schema, the stages it can
 * run at, and the actions each stage allows. Save-time validation lives here,
 * so the routes, the AI drafter and seed tests accept exactly the same shapes.
 */

import { z } from "zod";

import { DETECTOR_IDS } from "./detectors";
import { REDACT_STRATEGIES, type GuardrailAction, type GuardrailDef, type GuardrailKind, type GuardrailStage } from "./types";

export const MAX_PATTERN_LENGTH = 1_000;
/** A single scanned value larger than this stops the run (fail closed). */
export const MAX_SCANNED_VALUE_BYTES = 1024 * 1024;

const strategy = z.enum(REDACT_STRATEGIES);

const patternConfig = z.object({
  detectors: z.array(z.string().refine((id) => DETECTOR_IDS.includes(id), { message: "Unknown detector" })).max(DETECTOR_IDS.length),
  patterns: z.array(z.object({
    label: z.string().trim().min(1).max(40),
    regex: z.string().min(1).max(MAX_PATTERN_LENGTH),
    caseInsensitive: z.boolean(),
  })).max(20),
  strategy,
}).strict();

const keywordsConfig = z.object({
  terms: z.array(z.string().trim().min(1).max(200)).min(1).max(200),
  strategy,
}).strict();

const columnsConfig = z.object({
  /** Column names or globs, matched case-insensitively against result keys and column lists. */
  columns: z.array(z.string().trim().min(1).max(128)).min(1).max(100),
  strategy,
}).strict();

const injectionConfig = z.object({
  /** Extra phrases (plain text, case-insensitive) on top of the built-in list. */
  extraPhrases: z.array(z.string().trim().min(3).max(200)).max(50),
}).strict();

const sqlConfig = z.object({
  readOnly: z.boolean(),
  requireLimit: z.boolean(),
  denyDatabases: z.array(z.string().trim().min(1).max(128)).max(50),
  denyTables: z.array(z.string().trim().min(1).max(256)).max(100),
  /** EXPLAIN ESTIMATE ceiling for tools that run on the session connection; null = no estimate. */
  maxEstimatedRows: z.number().int().min(1).max(1e15).nullable(),
}).strict();

const toolConfig = z.object({
  tool: z.string().trim().min(1).max(100),
  rule: z.enum(["deny", "max_calls", "permission"]),
  maxCalls: z.number().int().min(1).max(1000).nullable(),
  permission: z.string().trim().min(1).max(100).nullable(),
}).strict();

const limitsConfig = z.object({
  maxToolCalls: z.number().int().min(1).max(10_000).nullable(),
  maxModelCalls: z.number().int().min(1).max(10_000).nullable(),
  maxResultRows: z.number().int().min(1).max(1_000_000).nullable(),
  maxResultBytes: z.number().int().min(1024).max(64 * 1024 * 1024).nullable(),
}).strict();

const judgeConfig = z.object({
  rule: z.string().trim().min(10).max(2_000),
  /** The model that judges; required, so a judge never silently uses another model. */
  modelConfigId: z.string().min(1).nullable(),
}).strict();

export type PatternConfig = z.infer<typeof patternConfig>;
export type KeywordsConfig = z.infer<typeof keywordsConfig>;
export type ColumnsConfig = z.infer<typeof columnsConfig>;
export type InjectionConfig = z.infer<typeof injectionConfig>;
export type SqlConfig = z.infer<typeof sqlConfig>;
export type ToolConfig = z.infer<typeof toolConfig>;
export type LimitsConfig = z.infer<typeof limitsConfig>;
export type JudgeConfig = z.infer<typeof judgeConfig>;

export interface KindSpec {
  label: string;
  description: string;
  schema: z.ZodTypeAny;
  /** Actions allowed at each stage the kind supports. */
  stages: Partial<Record<GuardrailStage, readonly GuardrailAction[]>>;
}

const TEXT_ACTIONS = ["log", "warn", "redact", "block"] as const;

export const KIND_SPECS: Record<GuardrailKind, KindSpec> = {
  pattern: {
    label: "Pattern match",
    description: "Regexes and built-in detectors (PII and secrets)",
    schema: patternConfig,
    stages: { input: TEXT_ACTIONS, tool_call: ["log", "warn", "block"], tool_result: TEXT_ACTIONS, output: TEXT_ACTIONS },
  },
  keywords: {
    label: "Keyword list",
    description: "Whole-word terms to flag, redact or block",
    schema: keywordsConfig,
    stages: { input: TEXT_ACTIONS, tool_result: TEXT_ACTIONS, output: TEXT_ACTIONS },
  },
  columns: {
    label: "Column masking",
    description: "Hide the values of chosen result columns",
    schema: columnsConfig,
    stages: { tool_result: ["log", "redact", "block"] },
  },
  injection: {
    label: "Prompt-injection shield",
    description: "Instruction-like text inside tool results",
    schema: injectionConfig,
    stages: { tool_result: ["log", "warn", "block"] },
  },
  sql: {
    label: "SQL safety",
    description: "Read-only, LIMIT, denied tables, estimated rows",
    schema: sqlConfig,
    stages: { tool_call: ["log", "warn", "block"] },
  },
  tool: {
    label: "Tool policy",
    description: "Deny a tool, cap its calls, or require a permission",
    schema: toolConfig,
    stages: { tool_call: ["log", "warn", "block"] },
  },
  limits: {
    label: "Limits",
    description: "Calls per run and rows or bytes per tool result",
    schema: limitsConfig,
    stages: { tool_call: ["log", "warn", "block"], tool_result: ["log", "redact", "block"] },
  },
  judge: {
    label: "AI judge",
    description: "A model checks text against a plain-language rule",
    schema: judgeConfig,
    stages: { input: ["log", "warn", "block"], output: ["log", "warn", "block"] },
  },
};

/**
 * Nested unbounded quantifiers such as `(a+)+` or `(\w*)*` backtrack
 * exponentially. JavaScript regexes cannot be interrupted, so they are refused.
 */
function hasNestedQuantifier(source: string): boolean {
  const stack: boolean[] = [];
  let quantifiedInside = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") { i++; continue; }
    if (ch === "[") {
      for (i++; i < source.length && source[i] !== "]"; i++) if (source[i] === "\\") i++;
      continue;
    }
    if (ch === "(") { stack.push(quantifiedInside); quantifiedInside = false; continue; }
    if (ch === ")") {
      const inner: boolean = quantifiedInside;
      quantifiedInside = stack.pop() ?? false;
      const next = source[i + 1];
      const outerUnbounded = next === "+" || next === "*" || (next === "{" && /^\{\d+,\}/.test(source.slice(i + 1)));
      if (inner && outerUnbounded) return true;
      quantifiedInside = quantifiedInside || inner || outerUnbounded;
      continue;
    }
    if (ch === "+" || ch === "*" || (ch === "{" && /^\{\d+,\}/.test(source.slice(i)))) quantifiedInside = true;
  }
  return false;
}

/** Why a user regex is refused, or null when it is accepted. */
export function regexProblem(source: string, caseInsensitive = false): string | null {
  if (source.length > MAX_PATTERN_LENGTH) return `Patterns are limited to ${MAX_PATTERN_LENGTH} characters`;
  try {
    new RegExp(source, caseInsensitive ? "giu" : "gu");
  } catch (error) {
    return `Invalid regex: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (hasNestedQuantifier(source)) return "Nested repeats like (a+)+ can stall every AI run; rewrite the pattern without them";
  if (new RegExp(source, "u").test("")) return "The pattern matches empty text";
  return null;
}

export interface GuardrailShape {
  kind: GuardrailKind;
  config: unknown;
  stages: GuardrailStage[];
  action: GuardrailAction;
  enabled: boolean;
  scope: GuardrailDef["scope"];
}

/** Problems with a guardrail's kind, config, stages and action, as messages. Empty when valid. */
export function guardrailProblems(input: GuardrailShape): string[] {
  const spec = KIND_SPECS[input.kind];
  const problems: string[] = [];
  const parsed = spec.schema.safeParse(input.config);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push(`config.${issue.path.join(".") || "(root)"}: ${issue.message}`);
    return problems;
  }
  if (input.stages.length === 0) problems.push("Choose at least one stage");
  for (const stage of input.stages) {
    const allowed = spec.stages[stage];
    if (!allowed) problems.push(`${spec.label} cannot run at the ${stage.replace("_", " ")} stage`);
    else if (!allowed.includes(input.action)) problems.push(`${spec.label} cannot ${input.action} at the ${stage.replace("_", " ")} stage`);
  }
  if (input.kind === "pattern") {
    const config = parsed.data as PatternConfig;
    if (config.detectors.length === 0 && config.patterns.length === 0) problems.push("Choose a built-in detector or add a pattern");
    for (const p of config.patterns) {
      const problem = regexProblem(p.regex, p.caseInsensitive);
      if (problem) problems.push(`Pattern '${p.label}': ${problem}`);
    }
  }
  if (input.kind === "tool") {
    const config = parsed.data as ToolConfig;
    if (config.rule === "max_calls" && config.maxCalls === null) problems.push("Set the maximum number of calls");
    if (config.rule === "permission" && config.permission === null) problems.push("Choose the permission the tool needs");
  }
  if (input.kind === "limits") {
    const config = parsed.data as LimitsConfig;
    const callLimits = config.maxToolCalls !== null || config.maxModelCalls !== null;
    const resultLimits = config.maxResultRows !== null || config.maxResultBytes !== null;
    if (input.stages.includes("tool_call") && !callLimits) problems.push("Set a call limit for the tool call stage");
    if (input.stages.includes("tool_result") && !resultLimits) problems.push("Set a row or byte limit for the tool result stage");
  }
  if (input.kind === "judge" && input.enabled && (parsed.data as JudgeConfig).modelConfigId === null) {
    problems.push("Choose the model that judges before enabling an AI judge");
  }
  if (input.scope.mcp && !input.stages.includes("tool_result")) problems.push("MCP coverage applies to tool results; add the tool result stage or turn MCP off");
  if (input.scope.mcp && (input.kind === "judge" || input.kind === "limits" && !input.stages.includes("tool_result"))) {
    problems.push(`${spec.label} cannot apply to MCP tool results`);
  }
  return problems;
}
