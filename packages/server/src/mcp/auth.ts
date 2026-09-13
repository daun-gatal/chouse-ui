/**
 * MCP authentication middleware (ADR 0013 §2).
 *
 * The MCP port is a machine surface: only personal access tokens are accepted.
 * JWTs (browser sessions) are rejected with a clear message before any tool
 * runs. Verification goes through the single `verifyBearer()` choke point so
 * identity is the user's *live* roles ∩ token scopes — revoke, demotion, or
 * deactivation takes effect on the very next tool call (ADR 0011/0010).
 *
 * The verifier is injectable so tests can exercise the middleware without a
 * database; production always uses `verifyIdentity`.
 */

import type { Context, Next } from "hono";
import { verifyBearer } from "../rbac/services/patAuth";
import { PAT_PREFIX } from "../rbac/services/personalAccessTokens";
import { AppError } from "../types";
import type { McpIdentity } from "./types";

declare module "hono" {
  interface ContextVariableMap {
    mcpIdentity: McpIdentity;
    mcpToken: string;
  }
}

export type McpTokenVerifier = (token: string) => Promise<McpIdentity>;

/** Production verifier: verifyBearer() with a 401 (not 500) on any failure. */
export async function verifyIdentity(token: string): Promise<McpIdentity> {
  try {
    const identity = await verifyBearer(token);
    return {
      userId: identity.userId,
      email: identity.email,
      username: identity.username,
      roles: identity.roles,
      permissions: identity.permissions,
      patId: identity.patId,
      patName: identity.patName,
    };
  } catch {
    throw AppError.unauthorized("Invalid personal access token");
  }
}

export function createMcpAuthMiddleware(
  verify: McpTokenVerifier = verifyIdentity
): (c: Context, next: Next) => Promise<void> {
  return async (c: Context, next: Next): Promise<void> => {
    const header = c.req.header("Authorization") || "";
    if (!header.startsWith("Bearer ")) {
      throw AppError.unauthorized(
        "MCP requires Authorization: Bearer ch_pat_… (mint a personal access token in the UI: Preferences → Personal access tokens)"
      );
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token.startsWith(PAT_PREFIX)) {
      throw AppError.unauthorized(
        "MCP accepts personal access tokens only (ch_pat_…). Browser session tokens are not valid on the MCP port."
      );
    }

    const identity = await verify(token);
    c.set("mcpIdentity", identity);
    c.set("mcpToken", token);

    await next();
  };
}

export const mcpAuthMiddleware = createMcpAuthMiddleware();
