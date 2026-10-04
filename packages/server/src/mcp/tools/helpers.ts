/**
 * Shared tool helpers (ADR 0013 §3/§4).
 *
 * Every tool handler is wrapped with the same behavior:
 *  - the authenticated MCP context is extracted from the transport AuthInfo
 *    and missing identity fails closed,
 *  - API failures surface as tool errors with the server's code/message,
 *  - successful results pass through the caps + redaction,
 *  - every call is audited best-effort (never fails the tool).
 */

import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol";
import { z } from "zod";
import { McpApiClient, McpApiError, runInToolScope, type McpToolScope } from "../api";
import { cappedJson } from "../safety";
import { auditMcpToolCall } from "../audit";
import type { McpToolContext } from "../types";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { logger } from "../../utils/logger";
import type { Permission } from "../../rbac/schema/base";
import * as agentStore from "../../services/agents/store";

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** The MCP context attached to the transport AuthInfo in createMcpApp. */
export function toolContext(extra: ToolExtra): McpToolContext {
  const ctx = extra.authInfo?.extra?.mcp;
  if (isMcpToolContext(ctx)) {
    return ctx;
  }
  throw new Error("MCP tool invoked without authenticated context — refusing.");
}

function isMcpToolContext(value: unknown): value is McpToolContext {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { identity?: unknown; token?: unknown };
  if (candidate.token === undefined || candidate.token === null || candidate.token === "") return false;
  const identity = candidate.identity;
  if (identity === null || typeof identity !== "object") return false;
  const ident = identity as { userId?: unknown; permissions?: unknown };
  return typeof ident.userId === "string" && Array.isArray(ident.permissions);
}

export function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], isError };
}

export function jsonResult(data: unknown): CallToolResult {
  return textResult(cappedJson(data));
}

/**
 * Put a tool call on the caller's agent session (ADR 0016 §10). Calls that
 * reached a governed query endpoint were recorded by the server already.
 * Best-effort: session bookkeeping never fails the tool.
 */
async function recordAgentToolCall(
  ctx: McpToolContext,
  scope: McpToolScope,
  target: string | undefined,
  outcome: "ok" | "error" | "blocked",
  error?: string
): Promise<void> {
  if (scope.recorded) return;
  try {
    const session = await agentStore.touchSession(ctx.identity.patId ?? null, ctx.identity.userId, "mcp", null);
    await agentStore.recordToolCall({
      sessionId: session.id,
      patId: ctx.identity.patId ?? null,
      userId: ctx.identity.userId,
      tool: scope.tool,
      argsSummary: target ?? null,
      outcome,
      detail: error ? { error: error.slice(0, 500) } : {},
    });
  } catch (err) {
    logger.warn({ module: "Mcp", tool: scope.tool, err: err instanceof Error ? err.message : String(err) }, "Failed to record agent tool call");
  }
}

/**
 * Run a projected API call with the standard wrapping: agent pause switch,
 * error mapping, caps, redaction, audit and agent-session recording.
 * `target` names the object acted on (for audit).
 */
export async function runApiTool(
  ctx: McpToolContext,
  api: McpApiClient,
  tool: string,
  target: string | undefined,
  call: () => Promise<unknown>
): Promise<CallToolResult> {
  const scope: McpToolScope = { tool, recorded: false };
  if (await agentStore.isAgentAccessPaused().catch(() => false)) {
    await auditMcpToolCall(ctx.identity, { tool, target, connectionId: ctx.connectionId, status: "failed", error: "Agent access is paused" });
    await recordAgentToolCall(ctx, scope, target, "blocked", "Agent access is paused");
    return textResult("AGENT_ACCESS_PAUSED: An administrator paused agent access. Try again later.", true);
  }
  try {
    const data = await runInToolScope(scope, call);
    await auditMcpToolCall(ctx.identity, {
      tool,
      target,
      connectionId: ctx.connectionId,
      status: "success",
    });
    await recordAgentToolCall(ctx, scope, target, "ok");
    return jsonResult(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!(error instanceof McpApiError)) {
      logger.warn({ module: "Mcp", tool, err: message }, "MCP tool failed");
    }
    await auditMcpToolCall(ctx.identity, {
      tool,
      target,
      connectionId: ctx.connectionId,
      status: "failed",
      error: message,
    });
    await recordAgentToolCall(ctx, scope, target, error instanceof McpApiError && error.code === "AGENT_POLICY_BLOCKED" ? "blocked" : "error", message);
    return error instanceof McpApiError ? textResult(`${error.code}: ${error.message}`, true) : textResult(message, true);
  }
}

/**
 * Build the per-request API client for a tool call, honoring a tool-level
 * `connection_id` argument over the request header connection.
 */
export function apiFor(ctx: McpToolContext, api: McpApiClient, connectionId?: string): McpApiClient {
  if (!connectionId) return api;
  return api.withConnection(connectionId);
}

/**
 * Tool-argument accessors.
 *
 * Schemas are registered as `Record<string, z.ZodTypeAny>` (see ADR 0013):
 * annotating with the SDK's `ZodRawShapeCompat` union (zod v3 | zod v4)
 * exceeds TypeScript's instantiation depth in the full server graph
 * (TS2589). The SDK still zod-validates arguments against the shape before
 * the handler runs, so these narrow accessors restore typed, strict access
 * to the validated values.
 */
export function argString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

export function argNumber(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function argOptionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function argEnum<K extends string>(args: Record<string, unknown>, key: string, allowed: readonly K[]): K | undefined {
  const value = args[key];
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as K) : undefined;
}

export function argOptionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Domain a tool belongs to — how the catalog groups tools in the UI. */
export const MCP_TOOL_CATEGORIES = [
  "identity",
  "explore",
  "query",
  "monitoring",
  "scheduling",
  "data_health",
  "data_observability",
  "ai",
] as const;
export type McpToolCategory = (typeof MCP_TOOL_CATEGORIES)[number];

/**
 * What a tool does to the system. Reads are on by default; writes and
 * destructive tools stay off until an administrator turns them on, and the
 * MCP annotations clients use for approval prompts are derived from this.
 */
export type McpToolAccess = "read" | "write" | "destructive";

export interface ChouseToolRegistration {
  name: string;
  /** Short human title (MCP `title`, catalog heading). */
  title: string;
  category: McpToolCategory;
  access: McpToolAccess;
  /**
   * The token needs at least one of these for the tool to be listed (empty:
   * any token). Mirrors the projected route's guard; the route still decides.
   */
  permissions: Permission[];
  /** Spends LLM budget on every call: off by default even when read-only. */
  spendsLlm?: boolean;
  description: string;
  inputSchema?: Record<string, z.ZodTypeAny>;
  handler: (args: Record<string, unknown>, extra: ToolExtra) => Promise<CallToolResult>;
}

/** Where tool definitions go: the catalog collector or a live McpServer. */
export interface McpToolSink {
  add(tool: ChouseToolRegistration): void;
}

export function registerChouseTool(sink: McpToolSink, tool: ChouseToolRegistration): void {
  sink.add(tool);
}

/** MCP tool annotations derived from the tool's access level. */
export function toolAnnotations(tool: ChouseToolRegistration): ToolAnnotations {
  return {
    title: tool.title,
    readOnlyHint: tool.access === "read",
    destructiveHint: tool.access === "destructive",
    idempotentHint: tool.access === "read",
    openWorldHint: false,
  };
}

/**
 * Single SDK registration boundary for chouse tools.
 *
 * The SDK's `registerTool` infers its generics from `AnySchema` — a union of
 * zod v3 and zod v4 core types (zod-compat) — and in the full server graph
 * that union exceeds TypeScript's instantiation-depth budget (TS2589) at
 * whichever tool lands on the budget edge; the failing site moves when
 * sibling registrations change. Runtime behavior is identical (the SDK still
 * zod-validates `arguments` against the shape before the handler runs), so
 * the SDK call site is pinned once here with a structural cast, and every
 * tool definition stays strictly typed on our side (loose args narrowed by
 * the arg* accessors above).
 */
export function registerOnServer(mcp: McpServer, tool: ChouseToolRegistration): void {
  type Register = (
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: Record<string, z.ZodTypeAny>;
      annotations?: ToolAnnotations;
    },
    handler: (args: Record<string, unknown>, extra: ToolExtra) => Promise<CallToolResult>
  ) => unknown;
  const register = mcp.registerTool.bind(mcp) as unknown as Register;
  // An empty object schema keeps the SDK's call shape uniform: without an
  // inputSchema it invokes the handler as handler(extra) instead of
  // handler(args, extra), which would misroute the context.
  register(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema ?? {},
      annotations: toolAnnotations(tool),
    },
    async (args, extra) => tool.handler(args, extra)
  );
}

export interface ChousePromptRegistration {
  name: string;
  title?: string;
  description?: string;
  argsSchema?: Record<string, z.ZodTypeAny>;
  handler: (args: Record<string, unknown>) => {
    messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
  };
}

/**
 * Single registration boundary for chouse prompts (same TS2589 rationale as
 * registerChouseTool — see that doc block).
 */
export function registerChousePrompt(mcp: McpServer, prompt: ChousePromptRegistration): void {
  type Register = (
    name: string,
    config: {
      title?: string;
      description?: string;
      argsSchema?: Record<string, z.ZodTypeAny>;
    },
    handler: (args: Record<string, unknown>) => {
      messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
    }
  ) => unknown;
  const register = mcp.registerPrompt.bind(mcp) as unknown as Register;
  register(
    prompt.name,
    {
      ...(prompt.title ? { title: prompt.title } : {}),
      ...(prompt.description ? { description: prompt.description } : {}),
      ...(prompt.argsSchema ? { argsSchema: prompt.argsSchema } : {}),
    },
    (args) => prompt.handler(args)
  );
}
