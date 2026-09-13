/**
 * MCP tool-call audit (ADR 0013 §3).
 *
 * Best-effort, never fails the tool: the projected API routes already audit
 * their own actions, and this entry adds the agent-facing record — which tool
 * ran, against what, with which outcome — attributable to the PAT
 * (`patId`-carrying user) via the existing audit pipeline.
 */

import { createAuditLog } from "../rbac/services/rbac";
import { AUDIT_ACTIONS } from "../rbac/schema/base";
import { logger } from "../utils/logger";
import { MCP_USER_AGENT } from "./api";
import type { McpIdentity } from "./types";

export interface McpToolAuditOptions {
  tool: string;
  target?: string;
  connectionId?: string;
  status?: "success" | "failed";
  error?: string;
  details?: Record<string, unknown>;
}

export async function auditMcpToolCall(
  identity: McpIdentity,
  options: McpToolAuditOptions
): Promise<void> {
  try {
    await createAuditLog(AUDIT_ACTIONS.MCP_TOOL_CALL, identity.userId, {
      resourceType: "mcp_tool",
      resourceId: options.tool,
      details: {
        tool: options.tool,
        target: options.target,
        connectionId: options.connectionId,
        patId: identity.patId,
        error: options.error,
        ...options.details,
      },
      userAgent: MCP_USER_AGENT,
      status: options.status ?? "success",
      errorMessage: options.error,
    });
  } catch (error) {
    logger.warn(
      { module: "Mcp", tool: options.tool, err: error instanceof Error ? error.message : String(error) },
      "Failed to create MCP tool audit entry"
    );
  }
}
