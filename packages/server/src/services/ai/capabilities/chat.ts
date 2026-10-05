/**
 * Feature: chat — the conversational assistant.
 *
 * The only invoked feature. The engine runs the thread's chosen agent — or the
 * agent bound to `chat` — over the conversation; the route persists and
 * returns the final answer and the tool trail (with each call's agent path).
 */

import { z } from "zod";
import { PERMISSIONS } from "../../../rbac/schema/base";
import type { InvokeCapability } from "../types";

export interface ChatInput {
  /** Conversation history is supplied to the engine as AgentMessage[] by the route. */
  threadId?: string;
}

export const chatCapability: InvokeCapability<ChatInput> = {
  id: "chat",
  title: "Chat",
  description: "The chat bubble. The bound agent answers when a thread has no agent picked; users can pick any top-level chat agent they may use.",
  surface: "chat",
  delivery: "invoke",
  permission: PERMISSIONS.AI_CHAT,
  // ClickHouse tools run on the user's session; CHouse management tools call the API as the user.
  contexts: ["session", "userApi"],
  variables: {},
  inputSchema: z.object({ threadId: z.string().optional() }),
};
