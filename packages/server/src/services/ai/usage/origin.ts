/**
 * Who started an AI request (ADR 0020): the browser UI, an MCP agent, or a
 * direct personal-access-token caller such as the `chouse` CLI.
 *
 * AI features start from many routes and services, so the caller is not
 * threaded through each of them: `rbacAuthMiddleware` runs the rest of the
 * request inside `runAsCaller`, and the usage run reads it when it starts.
 * Runs outside a request (schedulers, alerters) have no caller.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { AGENT_CLIENT_HEADER, describeAgentClient } from "../../agents/clients";

export const USAGE_ORIGINS = ["ui", "mcp", "token"] as const;
export type UsageOrigin = (typeof USAGE_ORIGINS)[number];

export interface UsageCaller {
  origin: UsageOrigin;
  /** The personal access token the request used; null for browser sessions. */
  patId: string | null;
  /** Friendly client name (Claude Code, Cursor, chouse CLI, …); null when unknown. */
  clientName: string | null;
}

const callerStore = new AsyncLocalStorage<UsageCaller>();

export function runAsCaller<T>(caller: UsageCaller, fn: () => Promise<T>): Promise<T> {
  return callerStore.run(caller, fn);
}

export function currentCaller(): UsageCaller | null {
  return callerStore.getStore() ?? null;
}

interface CallerRequest {
  authMethod: "jwt" | "pat";
  patId: string | null;
  header(name: string): string | undefined;
}

/**
 * The caller of an authenticated request. PAT requests the MCP endpoint makes
 * on an agent's behalf say so (`X-Chouse-Agent-Source: mcp`) and forward the
 * agent's own name; other PAT callers are named by their User-Agent.
 */
export function callerOf(request: CallerRequest): UsageCaller {
  if (request.authMethod !== "pat") return { origin: "ui", patId: null, clientName: null };
  const viaMcp = request.header("X-Chouse-Agent-Source") === "mcp";
  return {
    origin: viaMcp ? "mcp" : "token",
    patId: request.patId,
    clientName: describeAgentClient(request.header(AGENT_CLIENT_HEADER)) ?? describeAgentClient(request.header("User-Agent")),
  };
}
