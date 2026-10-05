/**
 * AI features — shared types (ADR 0019).
 *
 * Every AI feature (optimize/debug/diagnose/scan/DataOps/Observe/chat) is a code
 * contract — permission, input schema, evidence gathering, output schema and
 * finalization — bound to an agent in the registry. The agent (prompt, task
 * framing, model, tools, skills, subagents, harness, tuning) is data, managed
 * in Agents › Assistant; the engine (engine.ts) joins the two for each run.
 */

import type { z } from "zod";
import type { ClickHouseService } from "../clickhouse";
import type { Permission } from "../../rbac/schema/base";
import type { FleetNode } from "./capabilities/fleetShared";
import type { TemplateValue, VariableSpec } from "./registry/template";
import type { ToolContextKind } from "./registry/types";

// ============================================
// Run context
// ============================================

/**
 * Everything a feature might need at run time. Session-based features (SQL
 * editor optimize/debug, chat) carry a live `clickhouseService`; fleet features
 * (diagnose-*, optimize-log, fleet-scan) resolve their own nodes from
 * `connectionId` / the connections registry.
 */
export interface AgentRunContext {
  /** RBAC user id (for audit + tool access checks). */
  userId?: string;
  /** Whether the user is an RBAC admin. */
  isAdmin?: boolean;
  /** User's RBAC permissions. */
  permissions?: string[];
  /** Active ClickHouse connection id. */
  connectionId?: string;
  /** Live ClickHouse service — present for session-based features only. */
  clickhouseService?: ClickHouseService;
  /** Default database from the connection config. */
  defaultDatabase?: string;
  /** Optional model override (config id). Falls back to the agent's model, then the default config. */
  modelId?: string;
  /**
   * The caller's own bearer token, for CHouse management tools that call the API
   * in-process as that user. Absent for background runs.
   */
  bearerToken?: string;
}

export type AgentMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

// ============================================
// Feature metadata
// ============================================

export type DeliveryMode = "structured" | "invoke";

/** Where a feature shows up in the product (groups the Agents › Assistant feature list). */
export type FeatureSurface = "sql-editor" | "doctor" | "diagnostics" | "dataops" | "observe" | "chat";

export interface FeatureInfo {
  id: string;
  title: string;
  description: string;
  surface: FeatureSurface;
  delivery: DeliveryMode;
  /** RBAC permission required to invoke. Enforced by the route before the engine. */
  permission: Permission;
  /** Run contexts this feature can provide to its agent's tools. */
  contexts: readonly ToolContextKind[];
  /** Template variables this feature supplies to its agent's prompt and task templates. */
  variables: Readonly<Record<string, VariableSpec>>;
  /** Runs without a signed-in user (scheduler / alerter), so user-scoped contexts never apply. */
  background?: boolean;
}

/**
 * Metadata produced by the engine during a run, handed to `finalize` so the
 * feature can build its final result (e.g. fleet-scan needs the raw text +
 * the audit trail of tool calls).
 */
export interface RunMeta {
  /** The agent's final raw text. */
  raw: string;
  /** Audit trail of tool calls the agent made (evidence chain). */
  steps: { tool: string; input: unknown; agent?: string }[];
  /** The resolved model label (for reports). */
  modelLabel: string;
}

/** The bound agent's rendered prompt, for formatter fallbacks. */
export interface RenderedPrompts {
  /** The system prompt as the agent received it, before the output contract is appended. */
  system: string;
  /** The agent's own template rendered, without pinned skills. */
  core: string;
}

/**
 * A structured (non-streaming) AI feature.
 *
 * Lifecycle inside the engine:
 *   1. prepare(input, ctx)              → P   (access checks, evidence, node resolution…)
 *   2. templateVariables(prepared, ctx) → variables for the bound agent's templates
 *   3. <engine renders the agent's prompt + task, builds its tree, runs it,
 *       extracts outputSchema, collects steps>
 *   4. finalize(parsed, prepared, ctx, meta) → O   (EXPLAIN estimate, vitals, mapping…)
 *
 * `P` is the feature's private "prepared" bag threaded through the lifecycle.
 */
export interface StructuredCapability<TInput, TPrepared, TParsed, TOutput> extends FeatureInfo {
  delivery: "structured";
  /**
   * Validates the request `input`. The third generic param is loosened to
   * `unknown` so schemas with `.default()` fields (whose parsed *input* type is
   * looser than the resulting `TInput` output type) remain assignable here —
   * only the parsed `Output` (`TInput`) is ever relied on.
   */
  inputSchema: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  /** Schema the agent's final JSON must satisfy. Same `.default()` note as `inputSchema` above. */
  outputSchema: z.ZodType<TParsed, z.ZodTypeDef, unknown>;

  /** Resolve everything the run needs before the model is called. */
  prepare(input: TInput, ctx: AgentRunContext): Promise<TPrepared> | TPrepared;
  /** Values for the declared template variables. */
  templateVariables(prepared: TPrepared, ctx: AgentRunContext): Record<string, TemplateValue>;
  /** Fleet nodes the `query_node` tool is bound to (features providing the fleet context). */
  fleetNodes?(prepared: TPrepared): FleetNode[];
  /**
   * Return a previously generated result for the prepared evidence, if any.
   * `scope` identifies the bound agent revision, so an edited agent never
   * serves a result its previous revision produced.
   */
  cachedResult?(prepared: TPrepared, ctx: AgentRunContext, scope: string): Promise<TOutput | undefined> | TOutput | undefined;
  /**
   * Messages for the structured JSON fallback when the agent's free text didn't
   * parse. Defaults to a generic "here are your notes, produce the JSON now".
   */
  fallbackMessages?(prepared: TPrepared, ctx: AgentRunContext, raw: string, prompts: RenderedPrompts): AgentMessage[];
  /** Map the parsed JSON (+ run meta) into the public result. */
  finalize(
    parsed: TParsed,
    prepared: TPrepared,
    ctx: AgentRunContext,
    meta: RunMeta,
  ): Promise<TOutput> | TOutput;
  /** Persist an evidence-keyed result after successful finalization. */
  cacheResult?(output: TOutput, prepared: TPrepared, ctx: AgentRunContext, scope: string): Promise<void> | void;
  /**
   * Called when the agent produced no schema-valid output (both free-text
   * extraction and the structured fallback failed). If set, its result is
   * returned instead of throwing — used by fleet-scan to render the raw text +
   * a null analysis rather than 500.
   */
  onParseFailure?(prepared: TPrepared, ctx: AgentRunContext, meta: RunMeta): Promise<TOutput> | TOutput;
  /**
   * If set, the engine returns this value instead of throwing when the run
   * fails (model unavailable, provider error, missing agent binding). Used by
   * the lightweight `check-optimize` pre-screen, which must degrade gracefully.
   */
  softFail?: (error: unknown) => TOutput;
}

/**
 * The invoked feature (chat). The engine runs the bound — or the thread's
 * chosen — agent over the conversation and returns the final answer plus the
 * tool audit trail in one response.
 */
export interface InvokeCapability<TInput> extends FeatureInfo {
  delivery: "invoke";
  inputSchema: z.ZodType<TInput>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyStructuredCapability = StructuredCapability<any, any, any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyInvokeCapability = InvokeCapability<any>;
export type AnyCapability = AnyStructuredCapability | AnyInvokeCapability;
