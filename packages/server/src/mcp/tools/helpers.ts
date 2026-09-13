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
import { McpApiClient, McpApiError } from "../api";
import { cappedJson } from "../safety";
import { auditMcpToolCall } from "../audit";
import type { McpToolContext } from "../types";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { logger } from "../../utils/logger";

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
 * Run a projected API call with the standard wrapping: error mapping, caps,
 * redaction, and audit. `target` names the object acted on (for audit).
 */
export async function runApiTool(
  ctx: McpToolContext,
  api: McpApiClient,
  tool: string,
  target: string | undefined,
  call: () => Promise<unknown>
): Promise<CallToolResult> {
  try {
    const data = await call();
    await auditMcpToolCall(ctx.identity, {
      tool,
      target,
      connectionId: ctx.connectionId,
      status: "success",
    });
    return jsonResult(data);
  } catch (error) {
    if (error instanceof McpApiError) {
      await auditMcpToolCall(ctx.identity, {
        tool,
        target,
        connectionId: ctx.connectionId,
        status: "failed",
        error: error.message,
      });
      return textResult(`${error.code}: ${error.message}`, true);
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ module: "Mcp", tool, err: message }, "MCP tool failed");
    await auditMcpToolCall(ctx.identity, {
      tool,
      target,
      connectionId: ctx.connectionId,
      status: "failed",
      error: message,
    });
    return textResult(message, true);
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

export interface ChouseToolRegistration {
  name: string;
  description: string;
  inputSchema?: Record<string, z.ZodTypeAny>;
  annotations?: ToolAnnotations;
  handler: (args: Record<string, unknown>, extra: ToolExtra) => Promise<CallToolResult>;
}

/**
 * Single registration boundary for chouse tools.
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
export function registerChouseTool(mcp: McpServer, tool: ChouseToolRegistration): void {
  type Register = (
    name: string,
    config: {
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
      description: tool.description,
      inputSchema: tool.inputSchema ?? {},
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
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
