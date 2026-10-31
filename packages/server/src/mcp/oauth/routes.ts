/**
 * Public MCP OAuth endpoints (ADR 0028 §1): discovery metadata, dynamic client
 * registration, the authorization endpoint (which hands over to the consent
 * page), the token endpoint and revocation.
 *
 * All of them answer 404 unless MCP and OAuth are both on and CHouse has a
 * public address. They take no cookies; CORS for them is `*` without
 * credentials (middleware/cors.ts). Errors follow RFC 6749 §5.2.
 */

import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { AUDIT_ACTIONS } from "../../rbac/schema/base";
import { createAuditLog } from "../../rbac/services/rbac";
import { getClientIp } from "../../rbac/middleware/rbacAuth";
import { logger } from "../../utils/logger";
import { getMcpSettings, type StoredMcpSettings } from "../settings";
import { resolveIssuer, sameResource, type OAuthIssuer } from "./issuer";
import { matchRegisteredUri, redirectUriProblem } from "./redirects";
import { isValidChallenge } from "./secrets";
import { createRequest, getClient, purgeExpired, redeemCode, registerClient, revokeToken, rotateRefreshToken, issueTokens, type IssuedTokens } from "./store";

/** Where the consent page lives in the SPA (ADR 0028 §4). */
export const CONSENT_PATH = "/preferences/connect";
export const OAUTH_SCOPE = "mcp";
const MAX_REDIRECT_URIS = 10;
const MAX_CLIENT_NAME = 100;

type Env = { Variables: { oauthSettings: StoredMcpSettings; oauthIssuer: OAuthIssuer } };

function oauthError(c: Context, status: ContentfulStatusCode, error: string, description: string): Response {
  c.header("Cache-Control", "no-store");
  return c.json({ error, error_description: description }, status);
}

/** A client-chosen display name: printable, single line, bounded. */
export function cleanClientName(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || "Unnamed agent").slice(0, MAX_CLIENT_NAME);
}

function optionalString(raw: unknown, max: number): string | null {
  return typeof raw === "string" && raw.trim() && raw.length <= max ? raw.trim() : null;
}

function httpsUrlOrNull(raw: unknown): string | null {
  const value = optionalString(raw, 500);
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** `redirect_uri` with the response parameters appended (RFC 9207 adds `iss`). */
export function withParams(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

/** A request problem we can't send back to the agent: show it on CHouse instead. */
function consentError(c: Context<Env>, code: string): Response {
  const base = new URL(c.get("oauthIssuer").issuer).pathname.replace(/\/+$/, "");
  return c.redirect(`${base}${CONSENT_PATH}?error=${encodeURIComponent(code)}`, 302);
}

async function readParams(c: Context): Promise<Record<string, string>> {
  const type = c.req.header("Content-Type") ?? "";
  const out: Record<string, string> = {};
  if (type.includes("application/json")) {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [key, value] of Object.entries(body)) if (typeof value === "string") out[key] = value;
    return out;
  }
  const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
  for (const [key, value] of Object.entries(form)) if (typeof value === "string") out[key] = value;
  return out;
}

function tokenResponse(c: Context, tokens: IssuedTokens): Response {
  c.header("Cache-Control", "no-store");
  c.header("Pragma", "no-cache");
  return c.json({
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: tokens.expiresIn,
    refresh_token: tokens.refreshToken,
    scope: OAUTH_SCOPE,
  });
}

export interface OAuthRoutesOptions {
  /** Test seam: overrides the database-backed settings. */
  loadSettings?: () => Promise<StoredMcpSettings>;
}

export function createOAuthRoutes(options: OAuthRoutesOptions = {}): Hono<Env> {
  const app = new Hono<Env>();
  const loadSettings = options.loadSettings ?? (() => getMcpSettings());

  // Per route, not app.use("*"): this app is mounted at "/" and must not touch any other path.
  const gate: MiddlewareHandler<Env> = async (c, next) => {
    const settings = await loadSettings();
    const issuer = resolveIssuer(settings);
    if (!settings.enabled || !settings.oauthEnabled || !issuer.ok) {
      return c.json({ error: "not_found", error_description: "Signing in to MCP with OAuth is not turned on." }, 404);
    }
    c.set("oauthSettings", settings);
    c.set("oauthIssuer", issuer.value);
    await next();
  };

  app.onError((error, c) => {
    logger.error({ module: "McpOAuth", err: error instanceof Error ? error.message : String(error) }, "OAuth endpoint failed");
    return oauthError(c, 500, "server_error", "Something went wrong. Try again.");
  });

  // --- Discovery -------------------------------------------------------------

  const protectedResource = (c: Context<Env>): Response => {
    const issuer = c.get("oauthIssuer");
    return c.json({
      resource: issuer.resource,
      authorization_servers: [issuer.issuer],
      scopes_supported: [OAUTH_SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "CHouse UI",
    });
  };
  app.get("/.well-known/oauth-protected-resource", gate, protectedResource);
  app.get("/.well-known/oauth-protected-resource/*", gate, protectedResource);

  const authorizationServer = (c: Context<Env>): Response => {
    const { issuer } = c.get("oauthIssuer");
    return c.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [OAUTH_SCOPE],
      authorization_response_iss_parameter_supported: true,
    });
  };
  app.get("/.well-known/oauth-authorization-server", gate, authorizationServer);
  app.get("/.well-known/oauth-authorization-server/*", gate, authorizationServer);

  // --- Registration (RFC 7591) -----------------------------------------------

  app.post("/oauth/register", gate, async (c) => {
    const settings = c.get("oauthSettings");
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return oauthError(c, 400, "invalid_client_metadata", "Send the client metadata as a JSON object.");

    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS || !uris.every((u): u is string => typeof u === "string")) {
      return oauthError(c, 400, "invalid_redirect_uri", `redirect_uris must list 1 to ${MAX_REDIRECT_URIS} URIs.`);
    }
    for (const uri of uris) {
      const problem = redirectUriProblem(uri, settings.oauthRedirectHosts);
      if (problem) return oauthError(c, 400, "invalid_redirect_uri", `${uri} ${problem}.`);
    }
    const grantTypes = body.grant_types;
    if (grantTypes !== undefined && (!Array.isArray(grantTypes) || !grantTypes.includes("authorization_code") || grantTypes.some((g) => g !== "authorization_code" && g !== "refresh_token"))) {
      return oauthError(c, 400, "invalid_client_metadata", "grant_types may only be authorization_code and refresh_token.");
    }
    const responseTypes = body.response_types;
    if (responseTypes !== undefined && (!Array.isArray(responseTypes) || responseTypes.some((r) => r !== "code"))) {
      return oauthError(c, 400, "invalid_client_metadata", "response_types may only be code.");
    }

    const client = await registerClient({
      name: cleanClientName(body.client_name),
      redirectUris: [...new Set(uris)],
      status: settings.oauthRegistration === "approval" ? "pending" : "allowed",
      clientUri: httpsUrlOrNull(body.client_uri),
      softwareId: optionalString(body.software_id, 200),
    });
    void purgeExpired();
    await createAuditLog(AUDIT_ACTIONS.OAUTH_CLIENT_REGISTER, undefined, {
      resourceType: "oauth_client",
      resourceId: client.id,
      details: { name: client.name, redirectUris: client.redirectUris, status: client.status },
      ipAddress: getClientIp(c),
      userAgent: c.req.header("User-Agent"),
      status: "success",
    });

    c.header("Cache-Control", "no-store");
    return c.json({
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(client.clientUri ? { client_uri: client.clientUri } : {}),
      ...(client.softwareId ? { software_id: client.softwareId } : {}),
    }, 201);
  });

  // --- Authorization ---------------------------------------------------------

  app.get("/oauth/authorize", gate, async (c) => {
    const settings = c.get("oauthSettings");
    const issuer = c.get("oauthIssuer");
    const q = c.req.query();
    const client = q.client_id ? await getClient(q.client_id) : null;
    if (!client) return consentError(c, "unknown_client");

    // Always required, so the token request can be held to the same URI (OAuth 2.1 §4.1.3).
    const redirectUri = q.redirect_uri ? matchRegisteredUri(q.redirect_uri, client.redirectUris) : null;
    if (!redirectUri) return consentError(c, "redirect_mismatch");
    // The host list may have narrowed since the agent registered.
    if (redirectUriProblem(redirectUri, settings.oauthRedirectHosts)) return consentError(c, "redirect_not_allowed");
    if (client.status === "blocked") return consentError(c, "client_blocked");
    if (client.status === "pending") return consentError(c, "client_pending");

    // From here the redirect URI is trusted, so problems go back to the agent (RFC 6749 §4.1.2.1).
    const back = (error: string, description: string): Response =>
      c.redirect(withParams(redirectUri, { error, error_description: description, state: q.state, iss: issuer.issuer }), 302);
    if (q.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
    if (!q.code_challenge || q.code_challenge_method !== "S256" || !isValidChallenge(q.code_challenge)) {
      return back("invalid_request", "PKCE is required: send code_challenge with code_challenge_method=S256.");
    }
    if (q.resource && !sameResource(q.resource, issuer.resource)) return back("invalid_target", `resource must be ${issuer.resource}.`);
    if (q.state && q.state.length > 1000) return back("invalid_request", "state is too long.");

    const request = await createRequest({
      clientId: client.id,
      redirectUri,
      state: q.state ?? null,
      codeChallenge: q.code_challenge,
      resource: issuer.resource,
    });
    const base = new URL(issuer.issuer).pathname.replace(/\/+$/, "");
    return c.redirect(`${base}${CONSENT_PATH}?request=${encodeURIComponent(request.id)}`, 302);
  });

  // --- Token -----------------------------------------------------------------

  app.post("/oauth/token", gate, async (c) => {
    const issuer = c.get("oauthIssuer");
    const p = await readParams(c);
    const client = p.client_id ? await getClient(p.client_id) : null;
    if (!client) return oauthError(c, 401, "invalid_client", "Unknown client_id.");
    if (client.status !== "allowed") return oauthError(c, 401, "invalid_client", "This agent is not allowed to sign in.");
    if (p.resource && !sameResource(p.resource, issuer.resource)) return oauthError(c, 400, "invalid_target", `resource must be ${issuer.resource}.`);
    void purgeExpired();

    if (p.grant_type === "authorization_code") {
      if (!p.code || !p.code_verifier || !p.redirect_uri) return oauthError(c, 400, "invalid_request", "code, code_verifier and redirect_uri are required.");
      const redeemed = await redeemCode({ code: p.code, clientId: client.id, redirectUri: p.redirect_uri, verifier: p.code_verifier });
      if (!redeemed.ok) {
        if (redeemed.revokedGrantId) {
          await createAuditLog(AUDIT_ACTIONS.OAUTH_TOKEN_REUSE, undefined, {
            resourceType: "oauth_grant", resourceId: redeemed.revokedGrantId, details: { clientId: client.id, kind: "code" },
            ipAddress: getClientIp(c), userAgent: c.req.header("User-Agent"), status: "failure",
          });
        }
        return oauthError(c, 400, "invalid_grant", redeemed.reason);
      }
      let tokens: IssuedTokens;
      try {
        tokens = await issueTokens(redeemed.grantId);
      } catch {
        return oauthError(c, 400, "invalid_grant", "The grant is no longer valid.");
      }
      return tokenResponse(c, tokens);
    }

    if (p.grant_type === "refresh_token") {
      if (!p.refresh_token) return oauthError(c, 400, "invalid_request", "refresh_token is required.");
      const outcome = await rotateRefreshToken(p.refresh_token, client.id);
      if (!outcome.ok) {
        if (outcome.reused) {
          await createAuditLog(AUDIT_ACTIONS.OAUTH_TOKEN_REUSE, outcome.reused.userId, {
            resourceType: "oauth_grant", resourceId: outcome.reused.grantId, details: { clientId: client.id, kind: "refresh_token" },
            ipAddress: getClientIp(c), userAgent: c.req.header("User-Agent"), status: "failure",
          });
        }
        return oauthError(c, 400, "invalid_grant", outcome.reason);
      }
      return tokenResponse(c, outcome.tokens);
    }

    return oauthError(c, 400, "unsupported_grant_type", "grant_type must be authorization_code or refresh_token.");
  });

  // --- Revocation (RFC 7009) -------------------------------------------------

  app.post("/oauth/revoke", gate, async (c) => {
    const p = await readParams(c);
    const client = p.client_id ? await getClient(p.client_id) : null;
    if (!client) return oauthError(c, 401, "invalid_client", "Unknown client_id.");
    if (p.token) {
      const revoked = await revokeToken(p.token, client.id);
      if (revoked.revokedGrantId) {
        await createAuditLog(AUDIT_ACTIONS.OAUTH_GRANT_REVOKE, revoked.userId ?? undefined, {
          resourceType: "oauth_grant", resourceId: revoked.revokedGrantId, details: { clientId: client.id, by: "agent" },
          ipAddress: getClientIp(c), userAgent: c.req.header("User-Agent"), status: "success",
        });
      }
    }
    c.header("Cache-Control", "no-store");
    return c.body(null, 200);
  });

  return app;
}
