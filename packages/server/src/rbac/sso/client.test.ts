import { describe, it, expect, mock, beforeEach } from "bun:test";
import { normalizeOidcClaims, applyClaimMapping, resetProviderConfigurationCache } from "./client";

describe("normalizeOidcClaims", () => {
  it("maps standard claims", () => {
    const id = normalizeOidcClaims("okta", {
      sub: "s1",
      email: "A@B.co",
      email_verified: true,
      preferred_username: "Alice",
      name: "Alice A",
    });
    expect(id).toEqual({
      provider: "okta",
      subject: "s1",
      email: "a@b.co",
      emailVerified: true,
      username: "alice",
      displayName: "Alice A",
      claims: expect.any(Object),
    });
  });

  it("throws without sub", () => {
    expect(() =>
      normalizeOidcClaims("okta", { email: "x@y.z" } as never)
    ).toThrow();
  });

  it("honors a claim_mapping override, falling back to standard names", () => {
    const id = normalizeOidcClaims(
      "okta",
      { sub: "s1", mail: "A@B.co", upn: "Alice", name: "Alice A", email_verified: true },
      { email: "mail", username: "upn" }
    );
    expect(id.subject).toBe("s1"); // sub still standard (not overridden)
    expect(id.email).toBe("a@b.co"); // read from "mail"
    expect(id.username).toBe("alice"); // read from "upn"
    expect(id.emailVerified).toBe(true);
  });
});

describe("applyClaimMapping", () => {
  it("maps userinfo fields per provider claim_mapping", () => {
    const id = applyClaimMapping(
      "github",
      { subject: "id", email: "email", username: "login" },
      { id: 12345, email: "Dev@Example.com", login: "DevUser", name: "Dev User" }
    );
    expect(id.subject).toBe("12345");
    expect(id.email).toBe("dev@example.com");
    expect(id.username).toBe("devuser");
    // plain OAuth2 has no email_verified assertion
    expect(id.emailVerified).toBe(false);
  });

  it("throws when mapped subject field is missing", () => {
    expect(() =>
      applyClaimMapping("github", { subject: "id" }, { login: "x" })
    ).toThrow(/subject/);
  });
});

describe("buildAuthorizationRedirect (oauth2, real openid-client)", () => {
  beforeEach(async () => {
    const { resetProviderConfigurationCache } = await import("./client");
    resetProviderConfigurationCache();
  });

  it("returns url with PKCE, state, redirect_uri and NO nonce for oauth2", async () => {
    const { buildAuthorizationRedirect } = await import("./client");

    const providerCfg = {
      id: "gh",
      type: "oauth2" as const,
      displayName: "GitHub",
      clientId: "client-id",
      clientSecret: "client-secret",
      scopes: "read:user user:email",
      authorizationEndpoint: "https://github.com/login/oauth/authorize",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      userinfoEndpoint: "https://api.github.com/user",
      claimMapping: { subject: "id", email: "email", username: "login" },
    };

    const result = await buildAuthorizationRedirect(
      providerCfg,
      "https://app.example.com/callback"
    );

    const url = new URL(result.url);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/callback"
    );
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // OAuth2 providers should NOT include nonce in the URL
    expect(url.searchParams.has("nonce")).toBe(false);
    // returned state must match url param
    expect(result.state).toBe(url.searchParams.get("state"));
    // codeVerifier is non-empty
    expect(result.codeVerifier.length).toBeGreaterThan(0);
  });
});

describe("buildAuthorizationRedirect (oidc, mocked discovery)", () => {
  it("includes nonce in URL for oidc provider", async () => {
    // Mock openid-client so discovery() does not hit the network.
    // We use a real Configuration with manually-supplied server metadata.
    const oidcReal = await import("openid-client");
    const fakeOidcCfg = new oidcReal.Configuration(
      {
        issuer: "https://accounts.google.com",
        authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token",
      },
      "client-id",
      "client-secret"
    );

    mock.module("openid-client", () => ({
      ...oidcReal,
      discovery: async () => fakeOidcCfg,
    }));

    // Dynamic import so the mock is applied before the module runs.
    const { buildAuthorizationRedirect, resetProviderConfigurationCache } =
      await import("./client");
    resetProviderConfigurationCache();

    const oidcProvider = {
      id: "google",
      type: "oidc" as const,
      displayName: "Google",
      clientId: "client-id",
      clientSecret: "client-secret",
      scopes: "openid email profile",
      issuer: "https://accounts.google.com",
    };

    const result = await buildAuthorizationRedirect(
      oidcProvider,
      "https://app.example.com/callback"
    );
    const url = new URL(result.url);
    expect(url.searchParams.has("nonce")).toBe(true);
    expect(result.nonce).toBe(url.searchParams.get("nonce"));
    expect(url.searchParams.has("code_challenge")).toBe(true);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

// ---------------------------------------------------------------------------
// exchangeCodeForIdentity — mock openid-client to capture argument wiring
// ---------------------------------------------------------------------------

describe("exchangeCodeForIdentity checks wiring", () => {
  // Captured call args so individual tests can assert on them.
  let capturedGrantArgs: unknown[] = [];
  let capturedFetchUserInfoArgs: unknown[] = [];

  // Switchable mock results, set per test.
  let mockTokenClaims: Record<string, unknown> | null = null;
  let mockAccessToken = "at-mock";
  let mockUserinfo: Record<string, unknown> = {};

  beforeEach(() => {
    capturedGrantArgs = [];
    capturedFetchUserInfoArgs = [];
    mockTokenClaims = null;
    mockAccessToken = "at-mock";
    mockUserinfo = {};
    resetProviderConfigurationCache();
  });

  // Common fake openid-client module used by both sub-tests.
  // Re-applied in each test via mock.module so behaviour is controlled
  // by the per-test closures above.
  function setupMock(): void {
    mock.module("openid-client", () => {
      const oidcReal = require("openid-client") as typeof import("openid-client");
      return {
        ...oidcReal,
        discovery: async () =>
          new oidcReal.Configuration(
            {
              issuer: "https://sso.example.com",
              authorization_endpoint: "https://sso.example.com/auth",
              token_endpoint: "https://sso.example.com/token",
              userinfo_endpoint: "https://sso.example.com/userinfo",
            },
            "client-id",
            "client-secret"
          ),
        authorizationCodeGrant: async (
          _cfg: unknown,
          _url: unknown,
          checks: unknown
        ) => {
          capturedGrantArgs = [_cfg, _url, checks];
          return {
            access_token: mockAccessToken,
            claims: () => mockTokenClaims,
          };
        },
        fetchUserInfo: async (
          _cfg: unknown,
          accessToken: unknown,
          subjectCheck: unknown
        ) => {
          capturedFetchUserInfoArgs = [_cfg, accessToken, subjectCheck];
          return mockUserinfo;
        },
      };
    });
  }

  it("oidc: authorizationCodeGrant called with full checks and claims flow through normalizeOidcClaims", async () => {
    mockTokenClaims = {
      sub: "oidc-user-42",
      email: "User@Example.com",
      email_verified: true,
      preferred_username: "OidcUser",
      name: "OIDC User",
    };

    setupMock();
    const { exchangeCodeForIdentity, resetProviderConfigurationCache: reset } =
      await import("./client");
    reset();

    const oidcProvider = {
      id: "okta",
      type: "oidc" as const,
      displayName: "Okta",
      clientId: "client-id",
      clientSecret: "client-secret",
      scopes: "openid email profile",
      issuer: "https://sso.example.com",
    };

    const callbackUrl = new URL(
      "https://app.example.com/callback?code=c&state=st&nonce=n"
    );
    const identity = await exchangeCodeForIdentity(oidcProvider, callbackUrl, {
      codeVerifier: "cv",
      state: "st",
      nonce: "n",
    });

    // Verify checks passed to authorizationCodeGrant
    const checks = capturedGrantArgs[2] as Record<string, unknown>;
    expect(checks.pkceCodeVerifier).toBe("cv");
    expect(checks.expectedState).toBe("st");
    expect(checks.expectedNonce).toBe("n");
    expect(checks.idTokenExpected).toBe(true);

    // Verify identity flows from claims() through normalizeOidcClaims
    expect(identity.subject).toBe("oidc-user-42");
    expect(identity.email).toBe("user@example.com");
    expect(identity.username).toBe("oidcuser");
    expect(identity.emailVerified).toBe(true);
    expect(identity.displayName).toBe("OIDC User");
    expect(identity.provider).toBe("okta");
  });

  it("oauth2: checks have pkceCodeVerifier+expectedState but NOT expectedNonce/idTokenExpected; fetchUserInfo called with access_token+skipSubjectCheck; claimMapping applied", async () => {
    mockAccessToken = "gh-access-token";
    mockUserinfo = {
      id: 9001,
      email: "Dev@GitHub.com",
      login: "DevUser",
      name: "Dev User",
    };

    setupMock();
    const { exchangeCodeForIdentity, resetProviderConfigurationCache: reset } =
      await import("./client");
    reset();

    const oauth2Provider = {
      id: "github",
      type: "oauth2" as const,
      displayName: "GitHub",
      clientId: "client-id",
      clientSecret: "client-secret",
      scopes: "read:user user:email",
      authorizationEndpoint: "https://github.com/login/oauth/authorize",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      userinfoEndpoint: "https://api.github.com/user",
      claimMapping: { subject: "id", email: "email", username: "login" },
    };

    const callbackUrl = new URL(
      "https://app.example.com/callback?code=c&state=st"
    );
    const identity = await exchangeCodeForIdentity(oauth2Provider, callbackUrl, {
      codeVerifier: "cv",
      state: "st",
      nonce: "",
    });

    // Verify checks: PKCE and state present, no nonce/idToken fields
    const checks = capturedGrantArgs[2] as Record<string, unknown>;
    expect(checks.pkceCodeVerifier).toBe("cv");
    expect(checks.expectedState).toBe("st");
    expect("expectedNonce" in checks).toBe(false);
    expect("idTokenExpected" in checks).toBe(false);

    // fetchUserInfo called with the access_token (skipSubjectCheck is a symbol)
    expect(capturedFetchUserInfoArgs[1]).toBe("gh-access-token");
    // third argument is oidc.skipSubjectCheck (a symbol/unique value)
    expect(capturedFetchUserInfoArgs[2]).toBeDefined();

    // claimMapping applied correctly
    expect(identity.subject).toBe("9001");
    expect(identity.email).toBe("dev@github.com");
    expect(identity.username).toBe("devuser");
    expect(identity.emailVerified).toBe(false);
    expect(identity.displayName).toBe("Dev User");
    expect(identity.provider).toBe("github");
  });
});
