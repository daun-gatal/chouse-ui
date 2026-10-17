/**
 * The guardrail middleware installed on every agent and subagent (ADR 0022 §3).
 *
 * | Stage       | Hook                                   |
 * |-------------|----------------------------------------|
 * | input       | beforeAgent, root agent only           |
 * | tool_call   | wrapToolCall before the tool, and model-call limits in wrapModelCall |
 * | tool_result | wrapToolCall after the tool            |
 * | output      | afterModel                             |
 *
 * Message rewrites return the same message id, so LangGraph's message reducer
 * replaces the original instead of appending a copy.
 */

import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { createMiddleware, type AgentMiddleware } from "langchain";

import type { GuardrailRunner, StageMeta } from "./runner";

interface ToolCallLike {
  name: string;
  args: Record<string, unknown>;
}

/** Text of a message whose content is a string or text blocks; null for other block types only. */
function contentText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts = content.filter((b): b is { type: "text"; text: string } => Boolean(b) && typeof b === "object" && (b as { type?: unknown }).type === "text" && typeof (b as { text?: unknown }).text === "string");
  return parts.length > 0 ? parts.map((p) => p.text).join("\n") : null;
}

/** Rewrite the text parts of a message's content with `fn`, keeping other blocks. */
async function rewriteContent(content: unknown, fn: (text: string) => Promise<string>): Promise<unknown> {
  if (typeof content === "string") return fn(content);
  if (!Array.isArray(content)) return content;
  const out: unknown[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string") {
      out.push({ ...block, text: await fn((block as { text: string }).text) });
    } else {
      out.push(block);
    }
  }
  return out;
}

async function guardToolMessage(message: ToolMessage, rewrite: (text: string) => Promise<string>): Promise<ToolMessage> {
  const content = await rewriteContent(message.content, rewrite);
  if (content === message.content) return message;
  return new ToolMessage({
    content: content as ToolMessage["content"],
    tool_call_id: message.tool_call_id,
    name: message.name,
    id: message.id,
    status: message.status,
    artifact: message.artifact,
    additional_kwargs: message.additional_kwargs,
    response_metadata: message.response_metadata,
  });
}

export interface GuardrailNode {
  agentId: string;
  agentSlug: string;
  path: string;
  isRoot: boolean;
}

/** The node's guardrail middleware, or null when no guardrail applies to it. */
export function guardrailMiddleware(runner: GuardrailRunner, node: GuardrailNode): AgentMiddleware | null {
  const input = node.isRoot ? runner.at("input", node.agentId) : [];
  const toolCall = runner.at("tool_call", node.agentId);
  const toolResult = runner.at("tool_result", node.agentId);
  const output = runner.at("output", node.agentId);
  if (input.length + toolCall.length + toolResult.length + output.length === 0) return null;
  const meta = (tool: string | null): StageMeta => ({ agentPath: node.path, tool });

  return createMiddleware({
    name: `ChouseGuardrails_${node.agentSlug.replace(/[^A-Za-z0-9]/g, "_")}`,
    ...(input.length > 0 ? {
      beforeAgent: async (state: { messages: BaseMessage[] }) => {
        const updates: BaseMessage[] = [];
        for (const message of state.messages) {
          if (!HumanMessage.isInstance(message)) continue;
          const content = await rewriteContent(message.content, (text) => runner.checkText("input", input, text, meta(null)));
          if (content !== message.content && JSON.stringify(content) !== JSON.stringify(message.content)) {
            updates.push(new HumanMessage({ content: content as HumanMessage["content"], id: message.id, name: message.name, additional_kwargs: message.additional_kwargs }));
          }
        }
        return updates.length > 0 ? { messages: updates } : undefined;
      },
    } : {}),
    ...(toolCall.length > 0 ? {
      wrapModelCall: async (request, handler) => {
        await runner.checkModelCall(toolCall, meta(null));
        return handler(request);
      },
    } : {}),
    ...(output.length > 0 ? {
      afterModel: async (state: { messages: BaseMessage[] }) => {
        const last = state.messages[state.messages.length - 1];
        if (!last || !AIMessage.isInstance(last) || contentText(last.content) === null) return undefined;
        const content = await rewriteContent(last.content, (text) => runner.checkText("output", output, text, meta(null)));
        if (JSON.stringify(content) === JSON.stringify(last.content)) return undefined;
        return {
          messages: [new AIMessage({
            content: content as AIMessage["content"],
            id: last.id,
            name: last.name,
            tool_calls: last.tool_calls,
            invalid_tool_calls: last.invalid_tool_calls,
            usage_metadata: last.usage_metadata,
            additional_kwargs: last.additional_kwargs,
            response_metadata: last.response_metadata,
          })],
        };
      },
    } : {}),
    ...(toolCall.length + toolResult.length > 0 ? {
      wrapToolCall: async (request, handler) => {
        const call = request.toolCall as ToolCallLike;
        const notes = toolCall.length > 0 ? await runner.checkToolCall(toolCall, call.name, call.args ?? {}, meta(call.name)) : [];
        const result = await handler(request);
        if (toolResult.length === 0 && notes.length === 0) return result;
        const rewrite = (text: string): Promise<string> => runner.checkToolResult(toolResult, text, meta(call.name), notes);
        if (ToolMessage.isInstance(result)) return guardToolMessage(result, rewrite);
        // A subagent hand-off returns a LangGraph Command whose update carries the ToolMessage.
        const update = (result as { update?: unknown }).update;
        if (update && typeof update === "object" && Array.isArray((update as { messages?: unknown }).messages)) {
          const messages: unknown[] = [];
          for (const m of (update as { messages: unknown[] }).messages) messages.push(ToolMessage.isInstance(m) ? await guardToolMessage(m, rewrite) : m);
          return Object.assign(Object.create(Object.getPrototypeOf(result) as object) as object, result, { update: { ...update, messages } }) as typeof result;
        }
        return result;
      },
    } : {}),
  }) as AgentMiddleware;
}
