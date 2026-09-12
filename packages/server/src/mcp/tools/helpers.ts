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
} from "@modelcontextprotocol/sdk/types";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol";
import { McpApiClient, McpApiError } from "../api";
import { cappedJson } from "../safety";
import { auditMcpToolCall } from "../audit";
import type { McpToolContext } from "../types";
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
