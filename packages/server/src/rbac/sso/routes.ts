/**
 * SSO Routes — /rbac/auth/sso/*
 */

import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getSsoConfig } from "./config";
import { buildAuthorizationRedirect, exchangeCodeForIdentity } from "./client";
import { provisionSsoUser } from "./service";
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
  const provider = config.providers.get(c.req.param("provider"));
  if (!config.enabled || !provider) {
    return c.redirect("/login?ssoError=" + encodeURIComponent("Unknown SSO provider."), 302);
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
    const provider = config.enabled
      ? config.providers.get(providerId)
      : undefined;
    if (!provider) throw AppError.notFound("Unknown SSO provider");

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

export default ssoRoutes;
