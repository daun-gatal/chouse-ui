/**
 * Who started an AI request (ADR 0020): the browser UI, an MCP agent, or a
 * direct personal-access-token caller such as the `chouse` CLI.
 *
 * AI features start from many routes, and those routes authenticate through
 * different middlewares (`rbacAuthMiddleware`, `connectionContextMiddleware`).
 * So the caller is not threaded through each of them: `requestCallerMiddleware`
 * runs every `/api` request inside a scope that reads the request's auth
 * context when a usage run starts — after whichever middleware authenticated
 * it. Runs outside a request (schedulers, alerters) have no caller.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Context, Next } from "hono";

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

/** Resolves the current request's caller; null while it is not authenticated. */
type CallerResolver = () => UsageCaller | null;

const callerStore = new AsyncLocalStorage<CallerResolver>();

export function runAsCaller<T>(resolve: CallerResolver, fn: () => Promise<T>): Promise<T> {
  return callerStore.run(resolve, fn);
}

export function currentCaller(): UsageCaller | null {
  return callerStore.getStore()?.() ?? null;
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

/** Mounted on the `/api` router: AI usage runs started by the request record its caller. */
export async function requestCallerMiddleware(c: Context, next: Next): Promise<void> {
  await runAsCaller(() => {
    const authMethod = c.get("authMethod");
    if (!authMethod) return null;
    return callerOf({ authMethod, patId: c.get("patId") ?? null, header: (name) => c.req.header(name) });
  }, next);
}
