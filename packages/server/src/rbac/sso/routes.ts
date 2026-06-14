/**
 * SSO Routes — /rbac/auth/sso/*
 */

import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getSsoConfig } from "./config";
import { buildAuthorizationRedirect, exchangeCodeForIdentity } from "./client";
import { buildSamlAuthnRequest, validateSamlResponse, resolveSamlProviderByIssuer, extractSamlIssuer, summarizeSamlResponse } from "./saml/client";
import { stashTokens, claimTokens, markAssertionSeen } from "./saml/handoff";
import { provisionSsoUser, type SsoProvisionOutcome } from "./service";
import { describeSsoError } from "./errors";
import {
  signStatePayload,
  verifyStatePayload,
  SSO_STATE_COOKIE,
  SSO_STATE_TTL_SECONDS,
  type SsoStatePayload,
} from "./state";
import { createAuditLogWithContext } from "../services/rbac";
import { AUDIT_ACTIONS } from "../schema/base";
import { getClientIp } from "../middleware/rbacAuth";
import { requestLogger } from "../../utils/logger";
import { AppError } from "../../types";

const ssoRoutes = new Hono();

/**
 * Browser-binding cookie for SP-initiated SAML. Set at /start to the RelayState
 * (the signed state JWT), checked at the ACS so a signed Response can only be
 * consumed by the browser that initiated the flow — closing login-CSRF /
 * assertion injection. HttpOnly, one-time, 10-minute lifetime.
 */
const SAML_RELAY_COOKIE = "chouse_saml_relay";
const SAML_RELAY_TTL_SECONDS = 600;

/**
 * Public path of the SAML ACS endpoint, relative to the app's base URL. The IdP
 * POSTs the SAMLResponse here (a cross-site browser POST). The handler is also
 * mounted at this clean top-level path in index.ts (POST-only, so it doesn't
 * shadow the OIDC GET callback SPA page). This is the URL the admin registers at
 * the IdP and what node-saml validates Destination against, so it MUST stay in
 * sync with the index.ts mount + the wizard's displayed ACS URL + the CORS bypass.
 */
export const SAML_ACS_PATH = "/auth/sso/saml/acs";

const CallbackSchema = z.object({
  // Raw query string from the IdP redirect (code, state, iss, ...).
  // Forwarded verbatim because openid-client validates the full
  // authorization response, including the iss parameter when the
  // IdP advertises authorization_response_iss_parameter_supported.
  params: z.string().min(1).max(8192),
});

/** Only allow same-app relative redirect targets. */
function safeRedirect(target: string | undefined): string {
  if (!target || !target.startsWith("/")) return "/";
  // Reject //host and /\host (browsers treat both as protocol-relative).
  if (target[1] === "/" || target[1] === "\\") return "/";
  return target;
}

const isProduction = (): boolean =>
  (process.env.NODE_ENV || "development") === "production";

/**
 * Record the security-relevant outcome of an SSO sign-in (a JIT-provisioned
 * account, or an identity auto-linked to an existing user) in the audit log,
 * alongside the SSO_LOGIN entry. A plain successful login on an existing link
 * adds nothing here. Audit failures must never block sign-in.
 */
async function auditProvisionOutcome(
  c: Context,
  outcome: SsoProvisionOutcome,
  userId: string,
  details: Record<string, unknown>,
  ipAddress?: string,
): Promise<void> {
  let action: typeof AUDIT_ACTIONS.SSO_USER_PROVISION | typeof AUDIT_ACTIONS.SSO_IDENTITY_LINK;
  if (outcome === "created") action = AUDIT_ACTIONS.SSO_USER_PROVISION;
  else if (outcome === "linked") action = AUDIT_ACTIONS.SSO_IDENTITY_LINK;
  else return;
  try {
    await createAuditLogWithContext(c, action, userId, {
      resourceType: "user",
      resourceId: userId,
      details,
      ipAddress,
      status: "success",
    });
  } catch (error) {
    requestLogger(c.get("requestId")).warn(
      { module: "SSO", action, userId, err: error instanceof Error ? error.message : String(error) },
      "Failed to write SSO provisioning audit entry",
    );
  }
}

/**
 * GET /rbac/auth/sso/providers — public list for the login page.
 */
ssoRoutes.get("/providers", (c) => {
  const config = getSsoConfig();
  const providers = config.enabled
    ? [...config.providers.values()].map((p) => ({
        id: p.id,
        displayName: p.displayName,
      }))
    : [];
  return c.json({ success: true, data: { providers } });
});

/**
 * GET /rbac/auth/sso/:provider/start — begin the authorization code flow.
 */
ssoRoutes.get("/:provider/start", async (c) => {
  const config = getSsoConfig();
  const providerId = c.req.param("provider");
  const provider = config.providers.get(providerId);
  if (!config.enabled) {
    requestLogger(c.get("requestId")).warn(
      { module: "SSO", provider: providerId, enabled: false, providerCount: config.providers.size },
      "SSO start rejected — SSO is disabled",
    );
    return c.redirect("/login?ssoError=" + encodeURIComponent("SSO is currently disabled."), 302);
  }
  if (!provider) {
    requestLogger(c.get("requestId")).warn(
      { module: "SSO", provider: providerId, known: [...config.providers.keys()] },
      "SSO start rejected — unknown provider",
    );
    return c.redirect("/login?ssoError=" + encodeURIComponent(`Unknown SSO provider "${providerId}".`), 302);
  }

  if (provider.type === "saml") {
    const redirect = safeRedirect(c.req.query("redirect"));
    const acsUrl = `${config.baseUrl}${SAML_ACS_PATH}`;
    // RelayState carries our signed state (provider id + redirect) for SP-initiated correlation.
    const relayState = await signStatePayload({
      provider: provider.id,
      state: "saml",
      nonce: "saml",
      codeVerifier: "saml",
      redirect,
    });
    try {
      const { url } = await buildSamlAuthnRequest(provider, acsUrl, relayState);
      // Bind this browser to the flow: the ACS requires the POSTed RelayState to
      // equal this cookie, so an attacker-supplied (validly-signed) assertion +
      // RelayState injected into a victim's browser can't be consumed.
      //
      // SameSite=None is REQUIRED: the IdP returns the assertion via a cross-site
      // POST (SAML HTTP-POST binding), and browsers drop SameSite=Lax cookies on
      // cross-site POSTs. SameSite=None mandates Secure — so always Secure here
      // (honored on localhost too, which browsers treat as a secure context).
      setCookie(c, SAML_RELAY_COOKIE, relayState, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        path: "/",
        maxAge: SAML_RELAY_TTL_SECONDS,
      });
      return c.redirect(url, 302);
    } catch (error) {
      requestLogger(c.get("requestId")).error(
        { module: "SSO", provider: provider.id, ...describeSsoError(error) },
        "SAML AuthnRequest build failed"
      );
      return c.redirect(
        "/login?ssoError=" +
          encodeURIComponent("SSO provider is currently unavailable."),
        302
      );
    }
  }

  const redirect = safeRedirect(c.req.query("redirect"));
  // Provider-less redirect_uri — must match the IdP-registered URI exactly.
  // The provider id travels in the signed state cookie instead; a query string
  // here would be stripped by openid-client when it derives the token-exchange
  // redirect_uri, breaking exact-match validation at the IdP.
  const redirectUri = `${config.baseUrl}/auth/sso/callback`;

  let auth;
  try {
    auth = await buildAuthorizationRedirect(provider, redirectUri);
  } catch (error) {
    // Discovery/metadata failure: degrade gracefully, never crash the server.
    requestLogger(c.get("requestId")).error(
      { module: "SSO", provider: provider.id, ...describeSsoError(error) },
      "SSO provider discovery failed"
    );
    return c.redirect(
      "/login?ssoError=" +
        encodeURIComponent(
          "SSO provider is currently unavailable. Please try again later or use password login."
        ),
      302
    );
  }

  const stateJwt = await signStatePayload({
    provider: provider.id,
    state: auth.state,
    nonce: auth.nonce,
    codeVerifier: auth.codeVerifier,
    redirect,
  });

  setCookie(c, SSO_STATE_COOKIE, stateJwt, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "Lax",
    path: "/",
    maxAge: SSO_STATE_TTL_SECONDS,
  });

  return c.redirect(auth.url, 302);
});

/**
 * POST /rbac/auth/sso/callback — finish the flow, mint tokens.
 *
 * Provider-less by design: the provider id comes from the VERIFIED state
 * cookie payload (signed, audience-bound), not from the URL or the body.
 */
ssoRoutes.post("/callback", zValidator("json", CallbackSchema), async (c) => {
  const { params } = c.req.valid("json");
  const ipAddress = getClientIp(c);
  const config = getSsoConfig();

  const query = new URLSearchParams(params);
  const state = query.get("state");
  const code = query.get("code");

  const stateCookie = getCookie(c, SSO_STATE_COOKIE);
  // One-time use: always clear, even on failure.
  deleteCookie(c, SSO_STATE_COOKIE, { path: "/" });

  let payload: SsoStatePayload | undefined;
  try {
    if (!code || !state)
      throw AppError.unauthorized(
        "Sign-in response is incomplete. Please try again."
      );

    if (!stateCookie)
      throw AppError.unauthorized("Sign-in session expired. Please try again.");

    try {
      payload = await verifyStatePayload(stateCookie);
    } catch {
      throw AppError.unauthorized(
        "Sign-in session is invalid. Please try again."
      );
    }

    // The signed cookie is the provider authority.
    const providerId = payload.provider;
    if (!config.enabled) throw AppError.badRequest("SSO is currently disabled.");
    const provider = config.providers.get(providerId);
    if (!provider) {
      throw AppError.notFound(`Unknown SSO provider "${providerId}".`);
    }

    if (payload.state !== state) {
      throw AppError.unauthorized("Sign-in state mismatch. Please try again.");
    }

    // openid-client validates the full authorization response from this URL
    // (code, state, and iss when the IdP advertises
    // authorization_response_iss_parameter_supported), but derives the
    // token-exchange redirect_uri by stripping the ENTIRE query string —
    // leaving exactly the bare callback URL /start registered with the IdP.
    // That stripParams behavior is why the redirect_uri carries no provider.
    // The query is re-serialized through URLSearchParams, never interpolated.
    const callbackUrl = new URL(`${config.baseUrl}/auth/sso/callback`);
    callbackUrl.search = query.toString();

    const identity = await exchangeCodeForIdentity(provider, callbackUrl, {
      codeVerifier: payload.codeVerifier,
      state: payload.state,
      nonce: payload.nonce,
    });

    const result = await provisionSsoUser(
      provider,
      identity,
      ipAddress,
      c.req.header("User-Agent")
    );

    await createAuditLogWithContext(c, AUDIT_ACTIONS.SSO_LOGIN, result.user.id, {
      details: { provider: providerId },
      ipAddress,
      status: "success",
    });
    await auditProvisionOutcome(c, result.outcome, result.user.id, { provider: providerId }, ipAddress);

    return c.json({
      success: true,
      data: {
        user: result.user,
        tokens: result.tokens,
        redirect: payload.redirect,
      },
    });
  } catch (error) {
    // Flatten the provider's own diagnostics once; reuse for audit + log.
    const detail = describeSsoError(error);
    await createAuditLogWithContext(
      c,
      AUDIT_ACTIONS.SSO_LOGIN_FAILED,
      undefined,
      {
        details: { provider: payload?.provider ?? "unknown", ...detail },
        ipAddress,
        status: "failure",
        errorMessage:
          error instanceof Error ? error.message : "SSO login failed",
      }
    );
    // Warn with provider context for ALL failures, AppError or not.
    requestLogger(c.get("requestId")).warn(
      { module: "SSO", provider: payload?.provider ?? "unknown", ...detail },
      "SSO callback failed"
    );
    if (error instanceof AppError) throw error;
    throw AppError.unauthorized("SSO sign-in failed. Please try again.");
  }
});

/**
 * POST /rbac/auth/sso/saml/acs — SAML 2.0 Assertion Consumer Service.
 *
 * A single endpoint for all SAML providers. The provider is resolved by the
 * assertion Issuer; node-saml then validates the signature against THAT
 * provider's certificate, so Issuer-based routing is safe (a forged Issuer
 * routes to a provider whose cert won't match → validation fails). The Issuer
 * regex here is for ROUTING ONLY — not a security boundary; node-saml
 * re-validates the signature against the resolved provider's cert.
 *
 * Security ordering:
 *  1. Signature + InResponseTo (against the shared request-ID cache) are
 *     enforced inside node-saml BEFORE we trust any field.
 *  2. SP-vs-IdP-initiated is decided from the VALIDATED profile.inResponseTo,
 *     never from raw XML — a forged InResponseTo can't flip the gate (if
 *     present, node-saml validated it against the cache and rejected a value we
 *     never issued).
 *  3. SP-initiated responses are bound to the browser that started the flow via
 *     the SAML_RELAY_COOKIE (closes login-CSRF / assertion injection).
 *  4. Replay check uses the VALIDATED assertion id and fails closed if absent.
 *
 * Tokens never appear in the redirect URL — only a one-time handoff code.
 *
 * Exported so index.ts can also mount it at the clean top-level `/auth/sso/saml/acs`
 * (the IdP-registered URL), in addition to the /api/rbac mount.
 */
export const samlAcsHandler = async (c: Context): Promise<Response> => {
  const config = getSsoConfig();
  const ipAddress = getClientIp(c);
  const form = await c.req.parseBody();
  const SAMLResponse = typeof form.SAMLResponse === "string" ? form.SAMLResponse : "";
  const RelayState = typeof form.RelayState === "string" ? form.RelayState : undefined;
  // The browser-binding cookie set at /start. Always one-time: clear it below.
  const relayCookie = getCookie(c, SAML_RELAY_COOKIE);
  deleteCookie(c, SAML_RELAY_COOKIE, { path: "/" });
  let providerId = "unknown";
  try {
    if (!config.enabled) throw AppError.badRequest("SSO is currently disabled.");
    if (!SAMLResponse) throw AppError.badRequest("Missing SAMLResponse.");

    // Issuer extraction is for ROUTING ONLY (pick the provider/cert) — NOT a
    // security boundary. node-saml re-validates the signature against the
    // resolved provider's certificate below; a forged Issuer routes to a cert
    // that won't verify.
    const decoded = Buffer.from(SAMLResponse, "base64").toString("utf8");

    // Troubleshooting aid: the non-sensitive envelope fields that cause most
    // validation failures (audience/destination/InResponseTo/clock). Off unless
    // LOG_LEVEL=debug. Deliberately NOT the raw XML — no PII (NameID/attributes)
    // and no signature here; the validated claim set is logged separately on the
    // success path by provisionSsoUser.
    requestLogger(c.get("requestId")).debug(
      { module: "SSO", binding: "saml", relayStatePresent: Boolean(RelayState), ...summarizeSamlResponse(decoded) },
      "SAML response received (debug only)"
    );

    const issuer = extractSamlIssuer(decoded);
    if (!issuer) throw AppError.badRequest("SAMLResponse has no Issuer.");
    const provider = resolveSamlProviderByIssuer(config.providers.values(), issuer);
    if (!provider || provider.type !== "saml") {
      throw AppError.notFound(`No SAML provider for issuer "${issuer}".`);
    }
    providerId = provider.id;

    const acsUrl = `${config.baseUrl}${SAML_ACS_PATH}`;
    // Signature + InResponseTo-against-cache enforced inside node-saml here.
    const { identity, inResponseTo, assertionId, notOnOrAfter } =
      await validateSamlResponse(provider, { SAMLResponse, RelayState }, acsUrl);

    // Flow gating from VALIDATED data: a present InResponseTo means SP-initiated
    // (and node-saml already proved it was a request id we issued).
    const isSpInitiated = inResponseTo != null;
    if (!isSpInitiated && !provider.samlAllowIdpInitiated) {
      throw AppError.badRequest("IdP-initiated SSO is disabled for this provider.");
    }

    // Browser-binding check (SP-initiated only): the POSTed RelayState must be
    // present AND equal the cookie set at /start. This binds the response to the
    // browser that began the flow → closes login-CSRF / assertion injection.
    // IdP-initiated flows have no /start, hence no cookie — they are gated solely
    // by samlAllowIdpInitiated (documented accepted risk, off by default).
    if (isSpInitiated) {
      if (!RelayState || !relayCookie || RelayState !== relayCookie) {
        throw AppError.unauthorized("Sign-in session is invalid. Please try again.");
      }
    }

    // Replay protection (post-validation) using the VALIDATED assertion id. Fail
    // CLOSED if the validated assertion id is absent — never silently skip.
    if (assertionId && notOnOrAfter) {
      if (!markAssertionSeen(assertionId, notOnOrAfter)) {
        throw AppError.unauthorized("This sign-in response was already used.");
      }
    } else {
      throw AppError.unauthorized("Sign-in response missing a usable assertion id.");
    }

    // Redirect target from the VERIFIED RelayState (SP-initiated); default "/".
    let redirect = "/";
    if (RelayState) {
      try {
        redirect = safeRedirect((await verifyStatePayload(RelayState)).redirect);
      } catch {
        /* opaque IdP-initiated RelayState — keep default */
      }
    }

    const result = await provisionSsoUser(
      provider,
      identity,
      ipAddress,
      c.req.header("User-Agent")
    );
    await createAuditLogWithContext(c, AUDIT_ACTIONS.SSO_LOGIN, result.user.id, {
      details: { provider: providerId, binding: "saml" },
      ipAddress,
      status: "success",
    });
    await auditProvisionOutcome(
      c,
      result.outcome,
      result.user.id,
      { provider: providerId, binding: "saml" },
      ipAddress,
    );

    const code = stashTokens(
      { user: result.user, tokens: result.tokens, redirect },
      60_000
    );
    return c.redirect(`/login/sso-complete?code=${encodeURIComponent(code)}`, 302);
  } catch (error) {
    const detail = describeSsoError(error);
    await createAuditLogWithContext(c, AUDIT_ACTIONS.SSO_LOGIN_FAILED, undefined, {
      details: { provider: providerId, ...detail },
      ipAddress,
      status: "failure",
      errorMessage: error instanceof Error ? error.message : "SAML login failed",
    });
    requestLogger(c.get("requestId")).warn(
      { module: "SSO", provider: providerId, ...detail },
      "SAML ACS failed"
    );
    const msg =
      error instanceof AppError
        ? error.message
        : "SSO sign-in failed. Please try again.";
    return c.redirect("/login?ssoError=" + encodeURIComponent(msg), 302);
  }
};

ssoRoutes.post("/saml/acs", samlAcsHandler);

/**
 * POST /rbac/auth/sso/saml/exchange — trade a one-time ACS handoff code for the
 * minted session tokens. Single-use and short-lived; never returns tokens in a
 * redirect URL.
 */
ssoRoutes.post(
  "/saml/exchange",
  zValidator("json", z.object({ code: z.string().min(1) })),
  async (c) => {
    const { code } = c.req.valid("json");
    const payload = claimTokens(code);
    if (!payload) throw AppError.unauthorized("Sign-in handoff expired. Please try again.");
    return c.json({
      success: true,
      data: { user: payload.user, tokens: payload.tokens, redirect: payload.redirect },
    });
  }
);

export default ssoRoutes;
