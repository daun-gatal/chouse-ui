/**
 * Marks the API subrequests an MCP tool makes for its caller (ADR 0028 §3).
 *
 * An OAuth access token only works on /mcp, but MCP tools reach the rest of the
 * API in-process with the caller's token. The tool's subrequest runs inside
 * this scope; the bearer middlewares accept an OAuth token only when the scope
 * holds that same token. Nothing outside the process can set an
 * AsyncLocalStorage value, so a request from the network never passes.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const scope = new AsyncLocalStorage<{ token: string }>();

/** Run an MCP tool's subrequest so the bearer check knows it came from /mcp for `token`. */
export function runAsMcpSubrequest<T>(token: string, fn: () => Promise<T>): Promise<T> {
  return scope.run({ token }, fn);
}

/** Whether the current request is an MCP tool's subrequest carrying `token`. */
export function isMcpSubrequestFor(token: string): boolean {
  return scope.getStore()?.token === token;
}
