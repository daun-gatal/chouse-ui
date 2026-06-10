/**
 * AI Capability — shared types
 *
 * Every AI feature (optimize/debug/diagnose/scan/chat) is described by a single
 * declarative `AgentCapability`. The engine (engine.ts) owns the common ritual —
 * model resolution, agent construction, structured-output extraction, step
 * collection, error handling, audit logging — while each capability supplies
 * only what varies: which tools, which instructions, what prompt, what output
 * schema, and how to finalize the result.
 *
 * This is the single source of truth that replaces the per-feature copies in
 * aiOptimizer.ts and chouseDoctor.ts.
 */

import type { ModelMessage, ToolSet } from "ai";
import type { z } from "zod";
import type { ClickHouseService } from "../clickhouse";
import type { Permission } from "../../rbac/schema/base";

// ============================================
// Run context
// ============================================

/**
 * Everything a capability might need at run time. Session-based capabilities
 * (SQL editor optimize/debug, chat) carry a live `clickhouseService`; fleet
 * capabilities (diagnose-*, optimize-log, fleet-scan) resolve their own
 * connections from `connectionId` / the connections registry.
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
  /** Live ClickHouse service — present for session-based capabilities only. */
  clickhouseService?: ClickHouseService;
  /** Default database from the connection config. */
  defaultDatabase?: string;
  /** Optional model override (config id). Falls back to the default config. */
  modelId?: string;
}

// ============================================
// Delivery + tool sets
// ============================================

export type DeliveryMode = "structured" | "stream";

/** Named tool families the engine knows how to assemble. */
export type ToolSetName = "core" | "chart" | "chat" | "query_node";

// ============================================
// Agent tuning
// ============================================

export interface AgentTuning {
  /** Tool-loop step budget. Default 10. */
  stopAtSteps?: number;
  /** Sampling temperature. Default 0. */
  temperature?: number;
  /** Max output tokens (large for report/optimize capabilities). */
  maxOutputTokens?: number;
}

// ============================================
// Capability
// ============================================

/**
 * Metadata produced by the engine during a run, handed to `finalize` so the
 * capability can build its final result (e.g. fleet-scan needs the raw text +
 * the audit trail of tool calls).
 */
export interface RunMeta {
  /** The agent's final raw text. */
  raw: string;
  /** Audit trail of tool calls the agent made (evidence chain). */
  steps: { tool: string; input: unknown }[];
  /** The resolved model label (for reports). */
  modelLabel: string;
}

/**
 * A structured (non-streaming) AI capability.
 *
 * Lifecycle inside the engine:
 *   1. prepare(input, ctx)            → P   (fetch query text, build overview, resolve nodes…)
 *   2. tools(prepared, ctx)           → ToolSet
 *   3. instructions(prepared, ctx)    → system prompt (may be conditional)
 *   4. messages(prepared, ctx)        → first user turn(s)
 *   5. <engine runs the ToolLoopAgent, extracts outputSchema, collects steps>
 *   6. finalize(parsed, prepared, ctx, meta) → O   (EXPLAIN estimate, vitals, mapping…)
 *
 * `P` is the capability's private "prepared" bag threaded through the lifecycle.
 */
export interface StructuredCapability<TInput, TPrepared, TParsed, TOutput> {
  id: string;
  delivery: "structured";
  /** RBAC permission required to invoke. Enforced by the route before the engine. */
  permission: Permission;
  /** Validates the request `input`. */
  inputSchema: z.ZodType<TInput>;
  /** Schema the agent's final JSON must satisfy. */
  outputSchema: z.ZodType<TParsed>;
  /** Agent loop tuning. */
  tuning?: AgentTuning;

  /**
   * Resolve everything the run needs before the model is called: validate
   * access, fetch query text, build a fleet overview, resolve nodes, etc. The
   * returned bag is threaded through tools/instructions/messages/finalize, so it
   * should carry any input fields those phases need (the input itself is not
   * passed again).
   */
  prepare(input: TInput, ctx: AgentRunContext): Promise<TPrepared> | TPrepared;
  /** Assemble the tools the agent may call (may be async, e.g. skill discovery). */
  tools(prepared: TPrepared, ctx: AgentRunContext): ToolSet | Promise<ToolSet>;
  /** Build the system instructions (may vary on prepared data). */
  instructions(prepared: TPrepared, ctx: AgentRunContext): string | Promise<string>;
  /** Build the first user message(s). */
  messages(prepared: TPrepared, ctx: AgentRunContext): ModelMessage[] | Promise<ModelMessage[]>;
  /**
   * Build the messages used for the `generateObject` structured fallback when
   * the agent's free text didn't parse. Defaults to a generic
   * "here are your notes, produce the JSON now" prompt if omitted.
   */
  fallbackMessages?(prepared: TPrepared, ctx: AgentRunContext, raw: string): ModelMessage[];
  /** Map the parsed JSON (+ run meta) into the public result. */
  finalize(
    parsed: TParsed,
    prepared: TPrepared,
    ctx: AgentRunContext,
    meta: RunMeta,
  ): Promise<TOutput> | TOutput;
  /**
   * Called when the agent produced no schema-valid output (both free-text
   * extraction and the generateObject fallback failed). If set, its result is
   * returned instead of throwing — used by fleet-scan to render the raw text +
   * a null analysis rather than 500. Receives the same prepared/meta as finalize.
   */
  onParseFailure?(prepared: TPrepared, ctx: AgentRunContext, meta: RunMeta): Promise<TOutput> | TOutput;
  /**
   * If set, the engine returns this value instead of throwing when the run
   * fails (model unavailable, provider error, thrown exception). Used by the
   * lightweight `check-optimize` pre-screen, which must degrade gracefully.
   */
  softFail?: (error: unknown) => TOutput;
}

/**
 * A streaming capability (chat). The engine builds the agent and returns the
 * AI-SDK stream; SSE framing + presentation stays in the route, which is
 * genuinely chat-specific (chart-data events, scratchpad stripping).
 */
export interface StreamCapability<TInput> {
  id: string;
  delivery: "stream";
  permission: Permission;
  inputSchema: z.ZodType<TInput>;
  tuning?: AgentTuning;
  tools(ctx: AgentRunContext): Promise<ToolSet> | ToolSet;
  instructions(ctx: AgentRunContext): Promise<string> | string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyStructuredCapability = StructuredCapability<any, any, any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyStreamCapability = StreamCapability<any>;
export type AnyCapability = AnyStructuredCapability | AnyStreamCapability;
