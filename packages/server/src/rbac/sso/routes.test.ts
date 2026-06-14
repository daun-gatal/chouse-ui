/**
 * SSO Routes Tests
 *
 * Tests for /rbac/auth/sso/providers, /:provider/start, /callback
 */

import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { Hono } from "hono";
import { errorHandler } from "../../middleware/error";
import { signStatePayload, SSO_STATE_COOKIE, SSO_STATE_TTL_SECONDS } from "./state";
import type { SsoConfig, SsoProviderConfig } from "./config";
import { makeSignedSamlResponse } from "./testFixtures/samlFixtures";
import { stashTokens, resetHandoffState } from "./saml/handoff";
import { resetSamlRequestCache, seedSamlRequestId } from "./saml/client";
import { signStatePayload as signRelayState } from "./state";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetSsoConfig = mock<() => SsoConfig>();

mock.module("./config", () => ({
  getSsoConfig: mockGetSsoConfig,
}));

const mockBuildAuthorizationRedirect = mock();
const mockExchangeCodeForIdentity = mock();

mock.module("./client", () => ({
  buildAuthorizationRedirect: mockBuildAuthorizationRedirect,
  exchangeCodeForIdentity: mockExchangeCodeForIdentity,
}));

const mockProvisionSsoUser = mock();

mock.module("./service", () => ({
  provisionSsoUser: mockProvisionSsoUser,
}));

const mockCreateAuditLogWithContext = mock(async () => {});

mock.module("../services/rbac", () => ({
  createAuditLogWithContext: mockCreateAuditLogWithContext,
}));

mock.module("../middleware/rbacAuth", () => ({
  getClientIp: () => "127.0.0.1",
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROVIDER_ID = "testidp";
const PROVIDER_DISPLAY_NAME = "Test IDP";

function makeEnabledConfig(): SsoConfig {
  return {
    enabled: true,
    baseUrl: "http://localhost:5173",
    defaultRole: "viewer",
    autoLinkByEmail: true,
    providers: new Map([
      [
        PROVIDER_ID,
        {
          id: PROVIDER_ID,
          displayName: PROVIDER_DISPLAY_NAME,
          type: "oidc",
          issuer: "https://idp.example.com",
          clientId: "client-id",
          clientSecret: "client-secret",
          scopes: "openid email profile",
        },
      ],
    ]),
  };
}

function makeDisabledConfig(): SsoConfig {
  return {
    enabled: false,
    baseUrl: "",
    defaultRole: "viewer",
    autoLinkByEmail: true,
    providers: new Map(),
  };
}

function buildApp(): Hono {
  // Dynamic import after mocks are registered
  const ssoRoutes = require("./routes").default;
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/sso", ssoRoutes);
  return app;
}

// Helper: build a valid state cookie using the real signStatePayload
async function buildStateCookie(
  overrides: Partial<{
    provider: string;
    state: string;
    nonce: string;
    codeVerifier: string;
    redirect: string;
  }> = {}
): Promise<string> {
  return signStatePayload({
    provider: overrides.provider ?? PROVIDER_ID,
    state: overrides.state ?? "random-state-value",
    nonce: overrides.nonce ?? "random-nonce-value",
    codeVerifier: overrides.codeVerifier ?? "random-verifier-value",
    redirect: overrides.redirect ?? "/dashboard",
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SSO Routes", () => {
  let app: Hono;

  beforeEach(() => {
    mockGetSsoConfig.mockClear();
    mockBuildAuthorizationRedirect.mockClear();
    mockExchangeCodeForIdentity.mockClear();
    mockProvisionSsoUser.mockClear();
    mockCreateAuditLogWithContext.mockClear();

    // Fresh app instance to pick up any mock changes
    app = buildApp();
  });

  afterAll(() => {
    mock.restore();
  });

  // ── GET /providers ─────────────────────────────────────────────────────────

  describe("GET /sso/providers", () => {
    it("returns enabled providers as [{id, displayName}] — no secrets", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());

      const res = await app.request("/sso/providers");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.providers).toEqual([
        { id: PROVIDER_ID, displayName: PROVIDER_DISPLAY_NAME },
      ]);
      // Ensure secrets are NOT present
      const providerJson = JSON.stringify(body.data.providers[0]);
      expect(providerJson).not.toContain("clientSecret");
      expect(providerJson).not.toContain("client-secret");
    });

    it("returns empty array when SSO is disabled", async () => {
      mockGetSsoConfig.mockReturnValue(makeDisabledConfig());

      const res = await app.request("/sso/providers");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.providers).toEqual([]);
    });
  });

  // ── GET /:provider/start ────────────────────────────────────────────────────

  describe("GET /sso/:provider/start", () => {
    it("redirects 302 to authorization URL", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());
      mockBuildAuthorizationRedirect.mockResolvedValue({
        url: "https://idp.example.com/authorize?response_type=code&state=abc",
        state: "abc",
        nonce: "nonce-val",
        codeVerifier: "verifier-val",
      });

      const res = await app.request(`/sso/${PROVIDER_ID}/start`);

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toContain("https://idp.example.com/authorize");
    });

    it("passes a provider-less redirect_uri (no query string) to buildAuthorizationRedirect", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());
      mockBuildAuthorizationRedirect.mockResolvedValue({
        url: "https://idp.example.com/authorize?response_type=code&state=abc",
        state: "abc",
        nonce: "nonce-val",
        codeVerifier: "verifier-val",
      });

      const res = await app.request(`/sso/${PROVIDER_ID}/start`);

      expect(res.status).toBe(302);
      expect(mockBuildAuthorizationRedirect).toHaveBeenCalledTimes(1);
      const redirectUri: string = mockBuildAuthorizationRedirect.mock.calls[0][1];
      // Must be the exact registered URI — openid-client strips query params
      // when deriving the token-exchange redirect_uri, so any query here would
      // break exact-match validation at the IdP.
      expect(redirectUri).toBe("http://localhost:5173/auth/sso/callback");
    });

    it("sets state cookie with correct attributes", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());
      mockBuildAuthorizationRedirect.mockResolvedValue({
        url: "https://idp.example.com/authorize?state=abc",
        state: "abc",
        nonce: "nonce-val",
        codeVerifier: "verifier-val",
      });

      const res = await app.request(`/sso/${PROVIDER_ID}/start`);

      const setCookie = res.headers.get("Set-Cookie") ?? "";
      expect(setCookie).toContain(`${SSO_STATE_COOKIE}=`);
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain(`Max-Age=${SSO_STATE_TTL_SECONDS}`);
      expect(setCookie).toContain("Path=/");
    });

    it("redirects to /login?ssoError= for unknown provider", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());

      const res = await app.request("/sso/unknown-provider/start");

      expect(res.status).toBe(302);
      const location = res.headers.get("Location") ?? "";
      expect(location.startsWith("/login?ssoError=")).toBe(true);
    });

    it("redirects to /login?ssoError= when SSO is disabled", async () => {
      mockGetSsoConfig.mockReturnValue(makeDisabledConfig());

      const res = await app.request(`/sso/${PROVIDER_ID}/start`);

      expect(res.status).toBe(302);
      const location = res.headers.get("Location") ?? "";
      expect(location.startsWith("/login?ssoError=")).toBe(true);
    });

    it("sanitizes open-redirect: ?redirect=/\\evil.com (backslash) becomes /", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());
      mockBuildAuthorizationRedirect.mockResolvedValue({
        url: "https://idp.example.com/authorize?state=state-bs1",
        state: "state-bs1",
        nonce: "nonce-bs1",
        codeVerifier: "verifier-bs1",
      });
      mockExchangeCodeForIdentity.mockResolvedValue({
        provider: PROVIDER_ID,
        subject: "sub-bs1",
        email: "bs1@example.com",
        emailVerified: true,
        username: "bs1",
        displayName: "BS1",
        claims: {},
      });
      mockProvisionSsoUser.mockResolvedValue({
        user: { id: "user-bs1", username: "bs1" },
        tokens: { accessToken: "at-bs1", refreshToken: "rt-bs1" },
      });

      const startRes = await app.request(
        `/sso/${PROVIDER_ID}/start?redirect=/\\evil.com`
      );
      expect(startRes.status).toBe(302);

      const setCookieHeader = startRes.headers.get("Set-Cookie") ?? "";
      const cookieMatch = setCookieHeader.match(new RegExp(`${SSO_STATE_COOKIE}=([^;]+)`));
      expect(cookieMatch).not.toBeNull();
      const stateCookieValue = cookieMatch![1];

      const callbackRes = await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "code=code-bs1&state=state-bs1" }),
      });

      expect(callbackRes.status).toBe(200);
      const callbackBody = await callbackRes.json();
      expect(callbackBody.data.redirect).toBe("/");
    });

    it("sanitizes open-redirect: ?redirect=/\\\\/evil.com (double-backslash) becomes /", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());
      mockBuildAuthorizationRedirect.mockResolvedValue({
        url: "https://idp.example.com/authorize?state=state-bs2",
        state: "state-bs2",
        nonce: "nonce-bs2",
        codeVerifier: "verifier-bs2",
      });
      mockExchangeCodeForIdentity.mockResolvedValue({
        provider: PROVIDER_ID,
        subject: "sub-bs2",
        email: "bs2@example.com",
        emailVerified: true,
        username: "bs2",
        displayName: "BS2",
        claims: {},
      });
      mockProvisionSsoUser.mockResolvedValue({
        user: { id: "user-bs2", username: "bs2" },
        tokens: { accessToken: "at-bs2", refreshToken: "rt-bs2" },
      });

      const startRes = await app.request(
        `/sso/${PROVIDER_ID}/start?redirect=/\\/evil.com`
      );
      expect(startRes.status).toBe(302);

      const setCookieHeader = startRes.headers.get("Set-Cookie") ?? "";
      const cookieMatch = setCookieHeader.match(new RegExp(`${SSO_STATE_COOKIE}=([^;]+)`));
      expect(cookieMatch).not.toBeNull();
      const stateCookieValue = cookieMatch![1];

      const callbackRes = await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "code=code-bs2&state=state-bs2" }),
      });

      expect(callbackRes.status).toBe(200);
      const callbackBody = await callbackRes.json();
      expect(callbackBody.data.redirect).toBe("/");
    });

    it("sanitizes open-redirect: ?redirect=//evil.com (double-slash) becomes /", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());
      mockBuildAuthorizationRedirect.mockResolvedValue({
        url: "https://idp.example.com/authorize?state=state-ds1",
        state: "state-ds1",
        nonce: "nonce-ds1",
        codeVerifier: "verifier-ds1",
      });
      mockExchangeCodeForIdentity.mockResolvedValue({
        provider: PROVIDER_ID,
        subject: "sub-ds1",
        email: "ds1@example.com",
        emailVerified: true,
        username: "ds1",
        displayName: "DS1",
        claims: {},
      });
      mockProvisionSsoUser.mockResolvedValue({
        user: { id: "user-ds1", username: "ds1" },
        tokens: { accessToken: "at-ds1", refreshToken: "rt-ds1" },
      });

      const startRes = await app.request(
        `/sso/${PROVIDER_ID}/start?redirect=//evil.com`
      );
      expect(startRes.status).toBe(302);

      const setCookieHeader = startRes.headers.get("Set-Cookie") ?? "";
      const cookieMatch = setCookieHeader.match(new RegExp(`${SSO_STATE_COOKIE}=([^;]+)`));
      expect(cookieMatch).not.toBeNull();
      const stateCookieValue = cookieMatch![1];

      const callbackRes = await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "code=code-ds1&state=state-ds1" }),
      });

      expect(callbackRes.status).toBe(200);
      const callbackBody = await callbackRes.json();
      expect(callbackBody.data.redirect).toBe("/");
    });

    it("sanitizes open-redirect: ?redirect=\\\\evil.com (bare backslash, no leading slash) becomes /", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());
      mockBuildAuthorizationRedirect.mockResolvedValue({
        url: "https://idp.example.com/authorize?state=state-nsl",
        state: "state-nsl",
        nonce: "nonce-nsl",
        codeVerifier: "verifier-nsl",
      });
      mockExchangeCodeForIdentity.mockResolvedValue({
        provider: PROVIDER_ID,
        subject: "sub-nsl",
        email: "nsl@example.com",
        emailVerified: true,
        username: "nsl",
        displayName: "NSL",
        claims: {},
      });
      mockProvisionSsoUser.mockResolvedValue({
        user: { id: "user-nsl", username: "nsl" },
        tokens: { accessToken: "at-nsl", refreshToken: "rt-nsl" },
      });

      const startRes = await app.request(
        `/sso/${PROVIDER_ID}/start?redirect=\\evil.com`
      );
      expect(startRes.status).toBe(302);

      const setCookieHeader = startRes.headers.get("Set-Cookie") ?? "";
      const cookieMatch = setCookieHeader.match(new RegExp(`${SSO_STATE_COOKIE}=([^;]+)`));
      expect(cookieMatch).not.toBeNull();
      const stateCookieValue = cookieMatch![1];

      const callbackRes = await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "code=code-nsl&state=state-nsl" }),
      });

      expect(callbackRes.status).toBe(200);
      const callbackBody = await callbackRes.json();
      expect(callbackBody.data.redirect).toBe("/");
    });

    it("sanitizes open-redirect: ?redirect=https://evil.com becomes /", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());

      let capturedPayloadRedirect: string | undefined;
      mockBuildAuthorizationRedirect.mockResolvedValue({
        url: "https://idp.example.com/authorize?state=state1",
        state: "state1",
        nonce: "nonce1",
        codeVerifier: "verifier1",
      });

      // We let signStatePayload run for real, then follow through the callback
      // to verify the redirect in the JWT payload is '/'. Simpler: because
      // buildAuthorizationRedirect is called before signStatePayload, we can
      // complete the start request and then do a callback with the cookie to
      // check the redirect field in the returned data.
      const startRes = await app.request(
        `/sso/${PROVIDER_ID}/start?redirect=https://evil.com`
      );
      expect(startRes.status).toBe(302);

      // Extract state cookie
      const setCookieHeader = startRes.headers.get("Set-Cookie") ?? "";
      const cookieMatch = setCookieHeader.match(new RegExp(`${SSO_STATE_COOKIE}=([^;]+)`));
      expect(cookieMatch).not.toBeNull();
      const stateCookieValue = cookieMatch![1];

      // Provide callback mock and verify redirect in response payload is '/'
      mockExchangeCodeForIdentity.mockResolvedValue({
        provider: PROVIDER_ID,
        subject: "sub-123",
        email: "user@example.com",
        emailVerified: true,
        username: "user",
        displayName: "User",
        claims: {},
      });
      mockProvisionSsoUser.mockResolvedValue({
        user: { id: "user-1", username: "user" },
        tokens: { accessToken: "at", refreshToken: "rt" },
      });

      const callbackRes = await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "code=auth-code-xyz&state=state1" }),
      });

      expect(callbackRes.status).toBe(200);
      const callbackBody = await callbackRes.json();
      expect(callbackBody.data.redirect).toBe("/");
    });

    it("allows valid relative redirect path", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());
      mockBuildAuthorizationRedirect.mockResolvedValue({
        url: "https://idp.example.com/authorize?state=state2",
        state: "state2",
        nonce: "nonce2",
        codeVerifier: "verifier2",
      });
      mockExchangeCodeForIdentity.mockResolvedValue({
        provider: PROVIDER_ID,
        subject: "sub-456",
        email: "user2@example.com",
        emailVerified: true,
        username: "user2",
        displayName: "User 2",
        claims: {},
      });
      mockProvisionSsoUser.mockResolvedValue({
        user: { id: "user-2", username: "user2" },
        tokens: { accessToken: "at2", refreshToken: "rt2" },
      });

      const startRes = await app.request(
        `/sso/${PROVIDER_ID}/start?redirect=/workspace/my-db`
      );
      expect(startRes.status).toBe(302);

      const setCookieHeader = startRes.headers.get("Set-Cookie") ?? "";
      const cookieMatch = setCookieHeader.match(new RegExp(`${SSO_STATE_COOKIE}=([^;]+)`));
      const stateCookieValue = cookieMatch![1];

      const callbackRes = await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "code=auth-code&state=state2" }),
      });

      expect(callbackRes.status).toBe(200);
      const callbackBody = await callbackRes.json();
      expect(callbackBody.data.redirect).toBe("/workspace/my-db");
    });

    it("redirects to /login?ssoError= when buildAuthorizationRedirect rejects (discovery failure)", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());
      mockBuildAuthorizationRedirect.mockRejectedValue(
        new Error("OIDC discovery endpoint unreachable")
      );

      const res = await app.request(`/sso/${PROVIDER_ID}/start`);

      // Must degrade gracefully — no crash, no raw JSON 500 in the browser.
      expect(res.status).toBe(302);
      const location = res.headers.get("Location") ?? "";
      expect(location.startsWith("/login?ssoError=")).toBe(true);
      expect(decodeURIComponent(location)).toContain("unavailable");
    });
  });

  // ── POST /callback ──────────────────────────────────────────────────────────

  describe("POST /sso/callback", () => {
    it("happy path: exchanges code, provisions user, returns user+tokens+redirect", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());

      const stateCookieValue = await buildStateCookie({
        state: "state-happy",
        redirect: "/dashboard",
      });
      mockExchangeCodeForIdentity.mockResolvedValue({
        provider: PROVIDER_ID,
        subject: "sub-happy",
        email: "happy@example.com",
        emailVerified: true,
        username: "happyuser",
        displayName: "Happy User",
        claims: {},
      });
      mockProvisionSsoUser.mockResolvedValue({
        user: { id: "user-happy", username: "happyuser" },
        tokens: { accessToken: "access-tok", refreshToken: "refresh-tok" },
        outcome: "authenticated",
      });

      const res = await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "code=code-happy&state=state-happy" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.user.id).toBe("user-happy");
      expect(body.data.tokens.accessToken).toBe("access-tok");
      expect(body.data.redirect).toBe("/dashboard");
      expect(mockExchangeCodeForIdentity).toHaveBeenCalled();
      expect(mockProvisionSsoUser).toHaveBeenCalled();
      expect(mockCreateAuditLogWithContext).toHaveBeenCalledWith(
        expect.anything(),
        "auth.sso_login",
        "user-happy",
        expect.objectContaining({ status: "success" })
      );
      // A plain sign-in on an existing link records only SSO_LOGIN.
      const actions = mockCreateAuditLogWithContext.mock.calls.map((args) => args[1]);
      expect(actions).not.toContain("sso.user_provision");
      expect(actions).not.toContain("sso.identity_link");
    });

    it("records sso.user_provision alongside SSO_LOGIN when a user is JIT-provisioned", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());

      const stateCookieValue = await buildStateCookie({ state: "state-jit" });
      mockExchangeCodeForIdentity.mockResolvedValue({
        provider: PROVIDER_ID,
        subject: "sub-jit",
        email: "jit@example.com",
        emailVerified: true,
        username: "jituser",
        displayName: "JIT User",
        claims: {},
      });
      mockProvisionSsoUser.mockResolvedValue({
        user: { id: "user-jit", username: "jituser" },
        tokens: { accessToken: "at-jit", refreshToken: "rt-jit" },
        outcome: "created",
      });

      const res = await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "code=code-jit&state=state-jit" }),
      });

      expect(res.status).toBe(200);
      expect(mockCreateAuditLogWithContext).toHaveBeenCalledWith(
        expect.anything(),
        "sso.user_provision",
        "user-jit",
        expect.objectContaining({ status: "success", details: expect.objectContaining({ provider: PROVIDER_ID }) })
      );
    });

    it("records sso.identity_link alongside SSO_LOGIN when an identity is auto-linked by email", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());

      const stateCookieValue = await buildStateCookie({ state: "state-link" });
      mockExchangeCodeForIdentity.mockResolvedValue({
        provider: PROVIDER_ID,
        subject: "sub-link",
        email: "link@example.com",
        emailVerified: true,
        username: "linkuser",
        displayName: "Link User",
        claims: {},
      });
      mockProvisionSsoUser.mockResolvedValue({
        user: { id: "user-link", username: "linkuser" },
        tokens: { accessToken: "at-link", refreshToken: "rt-link" },
        outcome: "linked",
      });

      const res = await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "code=code-link&state=state-link" }),
      });

      expect(res.status).toBe(200);
      expect(mockCreateAuditLogWithContext).toHaveBeenCalledWith(
        expect.anything(),
        "sso.identity_link",
        "user-link",
        expect.objectContaining({ status: "success" })
      );
    });

    it("clears the state cookie on success", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());

      const stateCookieValue = await buildStateCookie({ state: "state-clear-success" });
      mockExchangeCodeForIdentity.mockResolvedValue({
        provider: PROVIDER_ID,
        subject: "sub-c",
        email: "c@example.com",
        emailVerified: true,
        username: "cu",
        displayName: "CU",
        claims: {},
      });
      mockProvisionSsoUser.mockResolvedValue({
        user: { id: "user-c", username: "cu" },
        tokens: { accessToken: "at-c", refreshToken: "rt-c" },
      });

      const res = await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "code=code-c&state=state-clear-success" }),
      });

      expect(res.status).toBe(200);
      const setCookie = res.headers.get("Set-Cookie") ?? "";
      // Cookie should be cleared — either Max-Age=0 or an expires in the past
      expect(setCookie).toMatch(/Max-Age=0|expires=Thu, 01 Jan 1970/i);
    });

    it("returns 401 when state in params does not match cookie state", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());

      const stateCookieValue = await buildStateCookie({ state: "state-real" });

      const res = await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "code=code-x&state=state-tampered" }),
      });

      expect(res.status).toBe(401);
      expect(mockCreateAuditLogWithContext).toHaveBeenCalledWith(
        expect.anything(),
        "auth.sso_login_failed",
        undefined,
        expect.objectContaining({ status: "failure" })
      );
    });

    it("clears the state cookie on failure (state mismatch)", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());

      const stateCookieValue = await buildStateCookie({ state: "state-mismatch" });

      const res = await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "code=code-x&state=wrong-state" }),
      });

      expect(res.status).toBe(401);
      const setCookie = res.headers.get("Set-Cookie") ?? "";
      expect(setCookie).toMatch(/Max-Age=0|expires=Thu, 01 Jan 1970/i);
    });

    it("returns 401 when state cookie is missing", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());

      const res = await app.request(`/sso/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params: "code=code-x&state=some-state" }),
      });

      expect(res.status).toBe(401);
      expect(mockCreateAuditLogWithContext).toHaveBeenCalledWith(
        expect.anything(),
        "auth.sso_login_failed",
        undefined,
        expect.objectContaining({ status: "failure" })
      );
    });

    it("returns 404 when the cookie's provider is not configured", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());

      const stateCookieValue = await buildStateCookie({ provider: "unknown-provider" });

      const res = await app.request("/sso/callback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "code=code-x&state=some-state" }),
      });

      expect(res.status).toBe(404);
      expect(mockExchangeCodeForIdentity).not.toHaveBeenCalled();
    });

    it("exchangeCodeForIdentity is called with URL containing code+state and NO provider param", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());

      const stateCookieValue = await buildStateCookie({
        state: "state-verify-url",
        nonce: "nonce-verify-url",
        codeVerifier: "verifier-verify-url",
        redirect: "/",
      });
      mockExchangeCodeForIdentity.mockResolvedValue({
        provider: PROVIDER_ID,
        subject: "sub-v",
        email: "v@example.com",
        emailVerified: true,
        username: "vu",
        displayName: "VU",
        claims: {},
      });
      mockProvisionSsoUser.mockResolvedValue({
        user: { id: "user-v", username: "vu" },
        tokens: { accessToken: "at-v", refreshToken: "rt-v" },
      });

      await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "code=the-auth-code&state=state-verify-url" }),
      });

      expect(mockExchangeCodeForIdentity).toHaveBeenCalled();
      const callArgs = mockExchangeCodeForIdentity.mock.calls[0];
      const callbackUrl: URL = callArgs[1];

      // code+state are parsed from currentUrl by openid-client; the derived
      // redirect_uri is this URL minus its query, so it must NOT carry a
      // provider param — that would change the registered redirect_uri.
      expect(callbackUrl.searchParams.get("provider")).toBeNull();
      expect(callbackUrl.searchParams.get("code")).toBe("the-auth-code");
      expect(callbackUrl.searchParams.get("state")).toBe("state-verify-url");
      const strippedUrl = new URL(callbackUrl.href);
      strippedUrl.search = "";
      expect(strippedUrl.href).toBe("http://localhost:5173/auth/sso/callback");

      // The checks object must carry the values from the cookie payload
      const checks = callArgs[2];
      expect(checks.codeVerifier).toBe("verifier-verify-url");
      expect(checks.state).toBe("state-verify-url");
      expect(checks.nonce).toBe("nonce-verify-url");
    });

    it("preserves extra authorization-response params (iss) in the reconstructed URL", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());

      const stateCookieValue = await buildStateCookie({ state: "state-iss" });
      mockExchangeCodeForIdentity.mockResolvedValue({
        provider: PROVIDER_ID,
        subject: "sub-iss",
        email: "iss@example.com",
        emailVerified: true,
        username: "issuser",
        displayName: "Iss User",
        claims: {},
      });
      mockProvisionSsoUser.mockResolvedValue({
        user: { id: "user-iss", username: "issuser" },
        tokens: { accessToken: "at-iss", refreshToken: "rt-iss" },
      });

      // Google appends iss because it advertises
      // authorization_response_iss_parameter_supported — openid-client
      // refuses the exchange if it goes missing.
      const res = await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({
          params:
            "code=code-iss&state=state-iss&iss=https%3A%2F%2Faccounts.google.com&authuser=0",
        }),
      });

      expect(res.status).toBe(200);
      expect(mockExchangeCodeForIdentity).toHaveBeenCalled();
      const callbackUrl: URL = mockExchangeCodeForIdentity.mock.calls[0][1];
      expect(callbackUrl.searchParams.get("code")).toBe("code-iss");
      expect(callbackUrl.searchParams.get("state")).toBe("state-iss");
      expect(callbackUrl.searchParams.get("iss")).toBe("https://accounts.google.com");
      expect(callbackUrl.searchParams.get("authuser")).toBe("0");
    });

    it("returns 401 when params lack a code", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());

      const stateCookieValue = await buildStateCookie({ state: "state-no-code" });

      const res = await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "state=state-no-code" }),
      });

      expect(res.status).toBe(401);
      expect(mockExchangeCodeForIdentity).not.toHaveBeenCalled();
      expect(mockCreateAuditLogWithContext).toHaveBeenCalledWith(
        expect.anything(),
        "auth.sso_login_failed",
        undefined,
        expect.objectContaining({ status: "failure" })
      );
    });

    it("returns 401 when params lack a state", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());

      const stateCookieValue = await buildStateCookie({ state: "state-no-state" });

      const res = await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "code=code-only" }),
      });

      expect(res.status).toBe(401);
      expect(mockExchangeCodeForIdentity).not.toHaveBeenCalled();
    });

    it("returns 400 when body is missing required fields", async () => {
      mockGetSsoConfig.mockReturnValue(makeEnabledConfig());

      const res = await app.request(`/sso/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params: "" }),
      });

      expect(res.status).toBe(400);
    });

    it("replay with stale provider: cookie minted for 'okta' rejected when config only has another provider", async () => {
      // Config knows only "otheridp"; the (signed) cookie claims "okta".
      const OTHER_PROVIDER_ID = "otheridp";
      const configWithOther: SsoConfig = {
        enabled: true,
        baseUrl: "http://localhost:5173",
        defaultRole: "viewer",
        autoLinkByEmail: true,
        providers: new Map([
          [
            OTHER_PROVIDER_ID,
            {
              id: OTHER_PROVIDER_ID,
              displayName: "Other IDP",
              type: "oidc",
              issuer: "https://other-idp.example.com",
              clientId: "other-client-id",
              clientSecret: "other-client-secret",
              scopes: "openid email profile",
            },
          ],
        ]),
      };
      mockGetSsoConfig.mockReturnValue(configWithOther);

      // Mint a state cookie for a provider that is no longer configured
      const stateCookieValue = await buildStateCookie({
        provider: "okta",
        state: "state-replay",
      });

      const res = await app.request(`/sso/callback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SSO_STATE_COOKIE}=${stateCookieValue}`,
        },
        body: JSON.stringify({ params: "code=code-replay&state=state-replay" }),
      });

      // Provider lookup from the verified cookie fails → 404, no exchange
      expect(res.status).toBe(404);
      expect(mockExchangeCodeForIdentity).not.toHaveBeenCalled();
    });
  });
});

// ─── SAML Routes ────────────────────────────────────────────────────────────────

const SAML_PROVIDER_ID = "samlidp";
const SAML_ISSUER = "https://idp.test/entity";
const SAML_SP_ENTITY = "https://app.test/sp";
const SAML_BASE_URL = "https://app.test";

/**
 * Register a mock SAML provider into a fresh enabled config. The provider's
 * idpCertificate must be the fixture's idpCertPem so node-saml validates the
 * signed assertion against the real key.
 */
function makeSamlConfig(
  idpCertPem: string,
  overrides: Partial<Pick<SsoProviderConfig, "samlAllowIdpInitiated">> = {}
): SsoConfig {
  const provider = {
    id: SAML_PROVIDER_ID,
    source: "config",
    type: "saml",
    displayName: "SAML IDP",
    samlIdpEntityId: SAML_ISSUER,
    samlIdpSsoUrl: "https://idp.test/sso",
    samlIdpCertificate: idpCertPem,
    samlSpEntityId: SAML_SP_ENTITY,
    samlAllowIdpInitiated: overrides.samlAllowIdpInitiated ?? false,
  } as unknown as SsoProviderConfig;
  return {
    enabled: true,
    baseUrl: SAML_BASE_URL,
    defaultRole: "viewer",
    autoLinkByEmail: true,
    providers: new Map([[SAML_PROVIDER_ID, provider]]),
  };
}

describe("SAML routes", () => {
  let app: Hono;

  beforeEach(() => {
    mockGetSsoConfig.mockClear();
    mockBuildAuthorizationRedirect.mockClear();
    mockExchangeCodeForIdentity.mockClear();
    mockProvisionSsoUser.mockClear();
    mockCreateAuditLogWithContext.mockClear();
    // Module-level caches shared across tests; fixtures reuse a fixed assertion
    // ID + request id, so reset all of them to keep each test independent.
    resetHandoffState();
    resetSamlRequestCache();
    app = buildApp();
  });

  afterAll(() => {
    mock.restore();
  });

  // The ACS cookie name + relay-state audience are internal to routes.ts; mirror
  // them here. The relay cookie value is the signed state JWT we POST as RelayState.
  const SAML_RELAY_COOKIE = "chouse_saml_relay";

  /**
   * Build a browser-bound SP-initiated request: seed the request id node-saml
   * would have issued at /start, and produce a matching RelayState JWT + cookie.
   */
  async function spInitiated(requestId: string, redirect = "/"): Promise<{
    relayState: string;
    cookie: string;
  }> {
    await seedSamlRequestId(requestId);
    const relayState = await signRelayState({
      provider: SAML_PROVIDER_ID,
      state: "saml",
      nonce: "saml",
      codeVerifier: "saml",
      redirect,
    });
    return { relayState, cookie: `${SAML_RELAY_COOKIE}=${relayState}` };
  }

  // ── GET /:provider/start (SAML branch) ─────────────────────────────────────

  it("GET /:provider/start redirects 302 to the IdP SSO URL with a SAMLRequest + sets the relay cookie", async () => {
    const { idpCertPem } = await makeSignedSamlResponse({ inResponseTo: "_x" });
    mockGetSsoConfig.mockReturnValue(makeSamlConfig(idpCertPem));

    const res = await app.request(`/sso/${SAML_PROVIDER_ID}/start`);

    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location.startsWith("https://idp.test/sso")).toBe(true);
    expect(location).toContain("SAMLRequest=");
    // Browser-binding cookie is set HttpOnly + SameSite=None/Secure so it survives
    // the IdP's cross-site POST back to the ACS (SAML POST binding).
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(`${SAML_RELAY_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=None");
    expect(setCookie).toContain("Secure");
  });

  // ── POST /saml/acs ─────────────────────────────────────────────────────────

  it("ACS happy path: SP-initiated assertion WITH matching cookie + RelayState → 302 sso-complete, provisions + audits", async () => {
    const requestId = "_req-happy";
    const { samlResponseB64, idpCertPem } = await makeSignedSamlResponse({ inResponseTo: requestId });
    mockGetSsoConfig.mockReturnValue(makeSamlConfig(idpCertPem));
    mockProvisionSsoUser.mockResolvedValue({
      user: { id: "user-saml", username: "alice" },
      tokens: { accessToken: "at-saml", refreshToken: "rt-saml" },
    });
    const { relayState, cookie } = await spInitiated(requestId, "/dashboard");

    const res = await app.request("/sso/saml/acs", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
      body: new URLSearchParams({ SAMLResponse: samlResponseB64, RelayState: relayState }).toString(),
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location.startsWith("/login/sso-complete?code=")).toBe(true);
    expect(mockProvisionSsoUser).toHaveBeenCalledTimes(1);
    expect(mockCreateAuditLogWithContext).toHaveBeenCalledWith(
      expect.anything(),
      "auth.sso_login",
      "user-saml",
      expect.objectContaining({ status: "success" })
    );
  });

  it("ACS login-CSRF: valid SP-initiated response WITHOUT the binding cookie → rejected, no provisioning", async () => {
    const requestId = "_req-csrf";
    const { samlResponseB64, idpCertPem } = await makeSignedSamlResponse({ inResponseTo: requestId });
    mockGetSsoConfig.mockReturnValue(makeSamlConfig(idpCertPem));
    mockProvisionSsoUser.mockResolvedValue({
      user: { id: "user-csrf", username: "victim" },
      tokens: { accessToken: "at", refreshToken: "rt" },
    });
    // Attacker injects a validly-signed assertion + RelayState into the victim's
    // browser, but the victim never ran /start → no binding cookie present.
    const { relayState } = await spInitiated(requestId);

    const res = await app.request("/sso/saml/acs", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ SAMLResponse: samlResponseB64, RelayState: relayState }).toString(),
    });

    expect(res.status).toBe(302);
    expect((res.headers.get("Location") ?? "").startsWith("/login?ssoError=")).toBe(true);
    expect(mockProvisionSsoUser).not.toHaveBeenCalled();
  });

  it("ACS forged InResponseTo IdP-bypass: signed response with an InResponseTo never issued → rejected (cache miss), no provisioning", async () => {
    const { samlResponseB64, idpCertPem } = await makeSignedSamlResponse({
      inResponseTo: "_req-forged-never-issued",
    });
    mockGetSsoConfig.mockReturnValue(makeSamlConfig(idpCertPem, { samlAllowIdpInitiated: false }));
    mockProvisionSsoUser.mockResolvedValue({
      user: { id: "user-forge", username: "x" },
      tokens: { accessToken: "at", refreshToken: "rt" },
    });
    // Cache intentionally NOT seeded → node-saml's ifPresent check rejects the
    // forged InResponseTo, so the attacker can't flip the IdP-initiated gate.

    const res = await app.request("/sso/saml/acs", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ SAMLResponse: samlResponseB64 }).toString(),
    });

    expect(res.status).toBe(302);
    expect((res.headers.get("Location") ?? "").startsWith("/login?ssoError=")).toBe(true);
    expect(mockProvisionSsoUser).not.toHaveBeenCalled();
  });

  it("ACS IdP-initiated allowed: signed response with NO InResponseTo + no cookie → 302 sso-complete", async () => {
    const { samlResponseB64, idpCertPem } = await makeSignedSamlResponse({});
    mockGetSsoConfig.mockReturnValue(makeSamlConfig(idpCertPem, { samlAllowIdpInitiated: true }));
    mockProvisionSsoUser.mockResolvedValue({
      user: { id: "user-idp", username: "alice" },
      tokens: { accessToken: "at-idp", refreshToken: "rt-idp" },
    });

    const res = await app.request("/sso/saml/acs", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ SAMLResponse: samlResponseB64 }).toString(),
    });

    expect(res.status).toBe(302);
    expect((res.headers.get("Location") ?? "").startsWith("/login/sso-complete?code=")).toBe(true);
    expect(mockProvisionSsoUser).toHaveBeenCalledTimes(1);
  });

  it("ACS IdP-initiated blocked when samlAllowIdpInitiated=false → 302 to /login?ssoError=, no provisioning", async () => {
    const { samlResponseB64, idpCertPem } = await makeSignedSamlResponse({});
    mockGetSsoConfig.mockReturnValue(makeSamlConfig(idpCertPem, { samlAllowIdpInitiated: false }));
    mockProvisionSsoUser.mockResolvedValue({
      user: { id: "user-x", username: "x" },
      tokens: { accessToken: "at", refreshToken: "rt" },
    });

    const res = await app.request("/sso/saml/acs", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ SAMLResponse: samlResponseB64 }).toString(),
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location.startsWith("/login?ssoError=")).toBe(true);
    expect(mockProvisionSsoUser).not.toHaveBeenCalled();
  });

  it("ACS unknown Issuer (no matching provider) → 302 to /login?ssoError=", async () => {
    const { samlResponseB64 } = await makeSignedSamlResponse({
      inResponseTo: "_x",
      issuer: "https://other-idp.test/entity",
    });
    // Provider configured for SAML_ISSUER only; fixture issuer differs.
    const { idpCertPem } = await makeSignedSamlResponse({ inResponseTo: "_x" });
    mockGetSsoConfig.mockReturnValue(makeSamlConfig(idpCertPem));

    const res = await app.request("/sso/saml/acs", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ SAMLResponse: samlResponseB64 }).toString(),
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location.startsWith("/login?ssoError=")).toBe(true);
    expect(mockProvisionSsoUser).not.toHaveBeenCalled();
  });

  it("ACS replay: same valid SP-initiated SAMLResponse twice → first succeeds, second rejected", async () => {
    const requestId = "_req-replay";
    const { samlResponseB64, idpCertPem } = await makeSignedSamlResponse({ inResponseTo: requestId });
    mockGetSsoConfig.mockReturnValue(makeSamlConfig(idpCertPem));
    mockProvisionSsoUser.mockResolvedValue({
      user: { id: "user-replay", username: "alice" },
      tokens: { accessToken: "at-r", refreshToken: "rt-r" },
    });
    const { relayState, cookie } = await spInitiated(requestId);
    const body = new URLSearchParams({ SAMLResponse: samlResponseB64, RelayState: relayState }).toString();
    const headers = { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie };

    const first = await app.request("/sso/saml/acs", { method: "POST", headers, body });
    expect(first.status).toBe(302);
    expect((first.headers.get("Location") ?? "").startsWith("/login/sso-complete?code=")).toBe(true);

    // Re-seed the request id (node-saml consumed it on the first validate) so the
    // second attempt fails on the REPLAY check, not the InResponseTo cache.
    await seedSamlRequestId(requestId);
    const second = await app.request("/sso/saml/acs", { method: "POST", headers, body });
    expect(second.status).toBe(302);
    expect((second.headers.get("Location") ?? "").startsWith("/login?ssoError=")).toBe(true);
  });

  // ── POST /saml/exchange ────────────────────────────────────────────────────

  it("POST /saml/exchange returns user+tokens+redirect for a fresh code, then 401 on reuse", async () => {
    mockGetSsoConfig.mockReturnValue(makeSamlConfig("placeholder"));
    const code = stashTokens(
      {
        user: { id: "user-ex", username: "ex" } as never,
        tokens: { accessToken: "at-ex", refreshToken: "rt-ex" } as never,
        redirect: "/dashboard",
      },
      60_000
    );

    const res = await app.request("/sso/saml/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.user.id).toBe("user-ex");
    expect(body.data.tokens.accessToken).toBe("at-ex");
    expect(body.data.redirect).toBe("/dashboard");

    const reuse = await app.request("/sso/saml/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(reuse.status).toBe(401);
  });
});
