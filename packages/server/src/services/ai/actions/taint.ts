/**
 * Untrusted data (ADR 0025 §1). Once a run has read rows, query text other
 * people wrote, or another agent's summary, instructions hidden in that
 * content could steer the next write. From then on every T2/T3 call asks
 * again, even under a grant.
 */

import { isInternalUserMessage } from "../runtime/internalMessages";

/** Tools whose results carry user-controlled content. */
export const UNTRUSTED_RESULT_TOOLS: ReadonlySet<string> = new Set([
  // ClickHouse rows and query text
  "run_select_query",
  "get_table_sample",
  "export_query_result",
  "run_bounded_aggregate",
  "query_node",
  "get_running_queries",
  "get_slow_queries",
  "analyze_query",
  "run_saved_query",
  "get_saved_query",
  // Text people wrote in CHouse
  "audit_log",
  "get_investigation_notebook",
  "list_ai_requests",
  "get_ai_request",
  "get_dashboard",
  "get_table_context",
  // Other agents and the analysis sandbox
  "task",
  "js_eval",
]);

interface MessageLike {
  _getType?: () => string;
  getType?: () => string;
  type?: unknown;
  name?: unknown;
  role?: unknown;
  content?: unknown;
}

function textOf(message: unknown): string {
  const content = (message as MessageLike).content;
  return typeof content === "string" ? content : "";
}

function messageType(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const m = message as MessageLike;
  if (typeof m.getType === "function") return m.getType();
  if (typeof m._getType === "function") return m._getType();
  if (typeof m.type === "string") return m.type;
  return typeof m.role === "string" ? m.role : "";
}

/**
 * Whether the current turn (the messages after the last human message) read
 * untrusted content. Earlier turns do not count: the user has spoken since.
 */
export function turnIsTainted(messages: readonly unknown[]): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const type = messageType(message);
    if ((type === "human" || type === "user") && !isInternalUserMessage(textOf(message))) return false;
    if (type === "tool") {
      const name = (message as MessageLike).name;
      if (typeof name === "string" && UNTRUSTED_RESULT_TOOLS.has(name)) return true;
    }
  }
  return false;
}
