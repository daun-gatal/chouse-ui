/**
 * Guardrails on MCP tool results (ADR 0022 §3): every guardrail whose scope
 * includes MCP runs its tool-result stage on the text an MCP tool returns,
 * before the client sees it. A block, or a guardrail that cannot run, returns
 * an error result with no data (fail closed). Triggers are written per call.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { logger } from "../utils/logger";
import { getRegistrySnapshot } from "../services/ai/registry/cache";
import { writeMcpGuardrailEvents } from "../services/ai/guardrails/events";
import { GuardrailBlockedError, GuardrailFailedError, GuardrailRunner, guardrailsForRun, mcpCapable } from "../services/ai/guardrails/runner";
import type { GuardrailEvent } from "../services/ai/guardrails/types";
import type { McpIdentity } from "./types";

export async function guardMcpResult(toolName: string, result: CallToolResult, identity: Pick<McpIdentity, "userId" | "permissions" | "roles">): Promise<CallToolResult> {
  const snapshot = await getRegistrySnapshot();
  const list = guardrailsForRun(snapshot.guardrails.values(), null).filter(mcpCapable);
  if (list.length === 0) return result;
  const events: GuardrailEvent[] = [];
  const runner = new GuardrailRunner(list, {
    featureId: null,
    permissions: identity.permissions,
    isAdmin: identity.roles.includes("super_admin") || identity.roles.includes("admin"),
    estimateRows: null,
    judge: () => Promise.reject(new Error("AI judges do not apply to MCP results")),
    record: (e) => events.push(e),
  });
  const stage = runner.at("tool_result", null);
  try {
    const content: CallToolResult["content"] = [];
    for (const block of result.content) {
      content.push(block.type === "text" ? { ...block, text: await runner.checkToolResult(stage, block.text, { agentPath: null, tool: toolName }) } : block);
    }
    return { ...result, content };
  } catch (error) {
    if (error instanceof GuardrailBlockedError || error instanceof GuardrailFailedError) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    throw error;
  } finally {
    if (events.length > 0) {
      await writeMcpGuardrailEvents(events, identity.userId).catch((err: unknown) => {
        logger.error({ module: "MCP", tool: toolName, err: err instanceof Error ? err.message : String(err) }, "Failed to record guardrail triggers");
      });
    }
  }
}
