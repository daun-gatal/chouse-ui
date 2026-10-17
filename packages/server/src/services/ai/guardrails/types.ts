/**
 * AI guardrail types (ADR 0022).
 *
 * A guardrail is a registry row: one of the shipped kinds, configured by an
 * administrator, applied at one or more stages of every agent run in its scope
 * and, when enabled for MCP, to MCP tool results.
 */

export const GUARDRAIL_KINDS = ["pattern", "keywords", "columns", "injection", "sql", "tool", "limits", "judge"] as const;
export type GuardrailKind = (typeof GUARDRAIL_KINDS)[number];

/** Stages in the order a run passes through them. */
export const GUARDRAIL_STAGES = ["input", "tool_call", "tool_result", "output"] as const;
export type GuardrailStage = (typeof GUARDRAIL_STAGES)[number];

export const GUARDRAIL_ACTIONS = ["log", "warn", "redact", "block"] as const;
export type GuardrailAction = (typeof GUARDRAIL_ACTIONS)[number];

export const GUARDRAIL_MODES = ["shadow", "enforce"] as const;
export type GuardrailMode = (typeof GUARDRAIL_MODES)[number];

export const REDACT_STRATEGIES = ["placeholder", "mask", "hash"] as const;
export type RedactStrategy = (typeof REDACT_STRATEGIES)[number];

export interface GuardrailScope {
  /** Agent ids, or every agent. */
  agents: "all" | string[];
  /** AI feature ids ("chat" for the chat), or every feature. */
  features: "all" | string[];
  /** Also apply the tool-result stage to MCP tool results. */
  mcp: boolean;
}

export interface GuardrailDef {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: GuardrailKind;
  /** Kind-specific settings, validated by the kind's schema (kinds.ts). */
  config: Record<string, unknown>;
  stages: GuardrailStage[];
  action: GuardrailAction;
  mode: GuardrailMode;
  scope: GuardrailScope;
  /** Order within a stage, lowest first. */
  position: number;
  enabled: boolean;
  isSystem: boolean;
  seedHash: string | null;
  customized: boolean;
  version: number;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

/** One trigger, as recorded in ai_guardrail_events. Never holds matched values. */
export interface GuardrailEvent {
  guardrailId: string;
  guardrailName: string;
  kind: GuardrailKind;
  stage: GuardrailStage;
  action: GuardrailAction;
  mode: GuardrailMode;
  matchCount: number;
  agentPath: string | null;
  tool: string | null;
  reason: string | null;
  /** Usage step the trigger belongs to, when known. */
  stepId: string | null;
}
