/**
 * MCP authentication middleware (ADR 0013 §2, ADR 0028).
 *
 * The MCP port is a machine surface: it takes personal access tokens and, when
 * an administrator turns OAuth on, the access tokens agents get by signing in.
 * JWTs (browser sessions) are rejected with a clear message before any tool
 * runs. Verification goes through the single `verifyBearer()` choke point so
 * identity is the user's *live* roles ∩ token scopes — revoke, demotion, or
 * deactivation takes effect on the very next tool call (ADR 0011/0010).
 *
 * With OAuth on, every 401 carries `WWW-Authenticate: Bearer resource_metadata`
 * so an agent given only the URL can find where to sign in (RFC 9728 §5.1).
 *
 * The verifier is injectable so tests can exercise the middleware without a
 * database; production always uses `verifyIdentity`.
 */

import type { Context, Next } from "hono";
import { verifyBearer } from "../rbac/services/patAuth";
import { PAT_PREFIX } from "../rbac/services/personalAccessTokens";
import { AppError } from "../types";
import { resolveIssuer, resourceMetadataUrl } from "./oauth/issuer";
import { OAUTH_ACCESS_PREFIX } from "./oauth/secrets";
import type { McpSettings } from "./settings";
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
    const identity = await verifyBearer(token, { allowOAuth: true });
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
    throw AppError.unauthorized(token.startsWith(OAUTH_ACCESS_PREFIX) ? "Invalid or expired OAuth access token" : "Invalid personal access token");
  }
}

type AuthSettings = Pick<McpSettings, "oauthEnabled" | "oauthPatsAllowed" | "publicUrl">;

/** The `WWW-Authenticate` value for a 401, or null when OAuth is off or has no address. */
export function oauthChallenge(settings: AuthSettings | undefined, tokenPresented: boolean): string | null {
  if (!settings?.oauthEnabled) return null;
  const issuer = resolveIssuer(settings);
  if (!issuer.ok) return null;
  const error = tokenPresented ? `, error="invalid_token"` : "";
  return `Bearer resource_metadata="${resourceMetadataUrl(issuer.value)}"${error}`;
}

function unauthorized(c: Context, settings: AuthSettings | undefined, tokenPresented: boolean, message: string): AppError {
  const challenge = oauthChallenge(settings, tokenPresented);
  if (challenge) c.header("WWW-Authenticate", challenge);
  return AppError.unauthorized(message);
}

export function createMcpAuthMiddleware(
  verify: McpTokenVerifier = verifyIdentity
): (c: Context, next: Next) => Promise<void> {
  return async (c: Context, next: Next): Promise<void> => {
    const settings: AuthSettings | undefined = c.get("mcpSettings");
    const oauth = settings?.oauthEnabled === true;
    const header = c.req.header("Authorization") || "";
    if (!header.startsWith("Bearer ")) {
      throw unauthorized(c, settings, false, oauth
        ? "MCP requires sign-in: connect your agent to this URL and it will open CHouse to sign in, or send Authorization: Bearer ch_pat_…"
        : "MCP requires Authorization: Bearer ch_pat_… (mint a personal access token in the UI: Preferences → Personal access tokens)");
    }
    const token = header.slice("Bearer ".length).trim();
    if (token.startsWith(OAUTH_ACCESS_PREFIX)) {
      if (!oauth) throw unauthorized(c, settings, true, "Signing in with OAuth is turned off for MCP. An administrator can turn it on in AI Governance › MCP.");
    } else if (token.startsWith(PAT_PREFIX)) {
      if (oauth && settings?.oauthPatsAllowed === false) {
        throw unauthorized(c, settings, true, "Personal access tokens are turned off for MCP. Connect your agent with sign-in instead.");
      }
    } else {
      throw unauthorized(c, settings, true, oauth
        ? "MCP accepts OAuth access tokens and personal access tokens (ch_pat_…). Browser session tokens are not valid on the MCP port."
        : "MCP accepts personal access tokens only (ch_pat_…). Browser session tokens are not valid on the MCP port.");
    }

    let identity: McpIdentity;
    try {
      identity = await verify(token);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid token";
      throw unauthorized(c, settings, true, message);
    }
    c.set("mcpIdentity", identity);
    c.set("mcpToken", token);

    await next();
  };
}

export const mcpAuthMiddleware = createMcpAuthMiddleware();
