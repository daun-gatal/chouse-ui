/**
 * Bearer Verification
 *
 * Single source of truth for `Authorization: Bearer` authentication, shared by
 * the RBAC control plane (`rbacAuthMiddleware`) and the data plane
 * (`optionalRbacMiddleware`). JWTs keep their existing semantics; `ch_pat_`
 * secrets resolve to the owner's *live* permissions (see ADR 0011). An agent's
 * OAuth access token (`ch_oat_`, ADR 0028) resolves the same way, as a token,
 * but only where the caller allows it: on /mcp and in an MCP tool's subrequest.
 */

import {
  verifyAccessToken,
  type TokenPayload,
} from "./jwt";
import {
  PAT_PREFIX,
  verifyPatToken,
  touchPatLastUsed,
} from "./personalAccessTokens";
import { OAUTH_ACCESS_PREFIX } from "../../mcp/oauth/secrets";
import { verifyAccessToken as verifyOAuthAccessToken } from "../../mcp/oauth/store";
import { AppError } from "../../types";

export type AuthMethod = "jwt" | "pat";

export interface BearerIdentity {
  userId: string;
  email: string;
  username: string;
  roles: string[];
  permissions: string[];
  sessionId: string;
  authMethod: AuthMethod;
  patId?: string;
  patName?: string;
}

/**
 * Verify a raw bearer token (header already stripped) as JWT or PAT.
 * PAT usage tracking is fired without awaiting so it never delays the request.
 */
export interface VerifyBearerOptions {
  /** Accept an OAuth access token: only /mcp and its tools' own subrequests pass this (ADR 0028 §3). */
  allowOAuth?: boolean;
}

export async function verifyBearer(rawToken: string, options: VerifyBearerOptions = {}): Promise<BearerIdentity> {
  if (rawToken.startsWith(OAUTH_ACCESS_PREFIX)) {
    if (!options.allowOAuth) {
      throw AppError.unauthorized("OAuth access tokens only work on the MCP endpoint");
    }
    const grant = await verifyOAuthAccessToken(rawToken);
    // A grant is a token row like a PAT, so every token rule (agent sessions, budgets, the session-only fences) applies as is.
    return {
      userId: grant.userId,
      email: grant.email,
      username: grant.username,
      roles: grant.roles,
      permissions: grant.permissions,
      sessionId: `pat:${grant.patId}`,
      authMethod: "pat",
      patId: grant.patId,
      patName: grant.patName,
    };
  }

  if (rawToken.startsWith(PAT_PREFIX)) {
    const pat = await verifyPatToken(rawToken);
    void touchPatLastUsed(pat.patId);
    return {
      userId: pat.userId,
      email: pat.email,
      username: pat.username,
      roles: pat.roles,
      permissions: pat.permissions,
      sessionId: `pat:${pat.patId}`,
      authMethod: "pat",
      patId: pat.patId,
      patName: pat.patName,
    };
  }

  const payload = await verifyAccessToken(rawToken);
  return {
    userId: payload.sub,
    email: payload.email,
    username: payload.username,
    roles: payload.roles,
    permissions: payload.permissions,
    sessionId: payload.sessionId,
    authMethod: "jwt",
  };
}

/**
 * Build a JWT-shaped context payload from a bearer identity so existing
 * `getRbacUser` consumers keep working for PAT-authenticated requests.
 */
export function toTokenPayload(identity: BearerIdentity): TokenPayload {
  return {
    sub: identity.userId,
    email: identity.email,
    username: identity.username,
    roles: identity.roles,
    permissions: identity.permissions,
    sessionId: identity.sessionId,
    type: "access",
  };
}
