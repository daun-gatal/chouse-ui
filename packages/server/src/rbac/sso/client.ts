/**
 * SSO Client Wrapper
 *
 * Thin layer over openid-client v6: provider Configuration cache,
 * authorization-URL building, code exchange, identity normalization.
 */

import * as oidc from "openid-client";
import type { SsoProviderConfig } from "./config";
import { logger } from "../../utils/logger";

// Authorization-request params the app controls — never overridable via auth_params.
const RESERVED_AUTH_PARAMS = new Set([
  "redirect_uri",
  "scope",
  "state",
  "nonce",
  "response_type",
  "client_id",
  "client_secret",
  "code_challenge",
  "code_challenge_method",
]);

export interface SsoIdentity {
  provider: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  username: string | null;
  displayName: string | null;
  claims: Record<string, unknown>;
}

const configCache = new Map<string, oidc.Configuration>();

export async function getProviderConfiguration(
  p: SsoProviderConfig
): Promise<oidc.Configuration> {
  const hit = configCache.get(p.id);
  if (hit) return hit;

  if (p.type === "saml") {
    throw new Error("[SSO] getProviderConfiguration does not handle SAML providers (use saml/client.ts)");
  }

  let cfg: oidc.Configuration;
  if (p.type === "oidc") {
    cfg = await oidc.discovery(new URL(p.issuer), p.clientId, p.clientSecret);
    // Optional overrides: replace individual discovered endpoints (e.g. a broken
    // or proxied one) while keeping the rest of the discovery document — notably
    // jwks_uri and the iss-parameter support flag, which ID-token validation needs.
    if (p.authorizationEndpoint || p.tokenEndpoint || p.userinfoEndpoint) {
      const merged = {
        ...cfg.serverMetadata(),
        ...(p.authorizationEndpoint && { authorization_endpoint: p.authorizationEndpoint }),
        ...(p.tokenEndpoint && { token_endpoint: p.tokenEndpoint }),
        ...(p.userinfoEndpoint && { userinfo_endpoint: p.userinfoEndpoint }),
      } as unknown as oidc.ServerMetadata;
      cfg = new oidc.Configuration(merged, p.clientId, p.clientSecret);
    }
  } else {
    // Configuration 3rd param accepts a bare string as shorthand for client_secret
    cfg = new oidc.Configuration(
      {
        issuer: `urn:chouse:sso:${p.id}`,
        authorization_endpoint: p.authorizationEndpoint,
        token_endpoint: p.tokenEndpoint,
        userinfo_endpoint: p.userinfoEndpoint,
      },
      p.clientId,
      p.clientSecret
    );
  }
  configCache.set(p.id, cfg);
  return cfg;
}

/** Test-only: clear discovery cache. */
export function resetProviderConfigurationCache(): void {
  configCache.clear();
}

export interface AuthorizationRedirect {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export async function buildAuthorizationRedirect(
  p: SsoProviderConfig,
  redirectUri: string
): Promise<AuthorizationRedirect> {
  if (p.type === "saml") {
    throw new Error("[SSO] buildAuthorizationRedirect does not handle SAML providers (use saml/client.ts)");
  }
  const cfg = await getProviderConfiguration(p);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();

  const params: Record<string, string> = {
    redirect_uri: redirectUri,
    scope: p.scopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  };
  if (p.type === "oidc") params.nonce = nonce;

  // Merge admin-configured extra params (prompt, hd, audience, …). Reserved keys
  // the app controls are dropped so they can't be hijacked.
  if (p.authParams) {
    for (const [key, value] of Object.entries(p.authParams)) {
      if (RESERVED_AUTH_PARAMS.has(key)) {
        logger.warn(
          { module: "SSO", provider: p.id, param: key },
          "Ignoring reserved key in auth_params"
        );
        continue;
      }
      params[key] = value;
    }
  }

  const url = oidc.buildAuthorizationUrl(cfg, params);
  return { url: url.toString(), state, nonce, codeVerifier };
}

export async function exchangeCodeForIdentity(
  p: SsoProviderConfig,
  callbackUrl: URL,
  checks: { codeVerifier: string; state: string; nonce: string }
): Promise<SsoIdentity> {
  if (p.type === "saml") {
    throw new Error("[SSO] exchangeCodeForIdentity does not handle SAML providers (use saml/client.ts)");
  }
  const cfg = await getProviderConfiguration(p);

  const tokens = await oidc.authorizationCodeGrant(cfg, callbackUrl, {
    pkceCodeVerifier: checks.codeVerifier,
    expectedState: checks.state,
    ...(p.type === "oidc"
      ? { expectedNonce: checks.nonce, idTokenExpected: true }
      : {}),
  });

  if (p.type === "oidc") {
    const claims = tokens.claims();
    if (!claims) {
      throw new Error(`[SSO] Provider ${p.id} returned no ID token claims`);
    }
    return normalizeOidcClaims(p.id, claims as Record<string, unknown>, p.claimMapping);
  }

  // Fetch the userinfo endpoint directly rather than via oidc.fetchUserInfo:
  // openid-client enforces OIDC userinfo semantics and rejects any response
  // whose `sub` is not a string. Non-OIDC providers (e.g. GitHub, whose /user
  // returns a numeric `id` and no `sub`) fail that check before claim_mapping
  // can run. The mapped-subject throw in applyClaimMapping is the compensating
  // control for the skipped sub check.
  const userinfo = await fetchOauth2UserInfo(
    p.id,
    p.userinfoEndpoint,
    tokens.access_token
  );
  return applyClaimMapping(p.id, p.claimMapping, userinfo);
}

/**
 * Fetch a plain-OAuth2 provider's userinfo endpoint and return the raw JSON
 * object. Sends a User-Agent because some providers (notably GitHub's API)
 * reject requests without one.
 */
async function fetchOauth2UserInfo(
  providerId: string,
  userinfoEndpoint: string,
  accessToken: string
): Promise<Record<string, unknown>> {
  const res = await fetch(userinfoEndpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "chouse-ui-sso",
    },
  });
  if (!res.ok) {
    throw new Error(
      `[SSO] Provider ${providerId} userinfo request failed (${res.status} ${res.statusText})`
    );
  }
  const body: unknown = await res.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error(`[SSO] Provider ${providerId} userinfo response was not a JSON object`);
  }
  const userinfo = body as Record<string, unknown>;

  // GitHub keeps a user's email private by default, so /user returns
  // email:null. Fall back to /user/emails (granted by the user:email scope)
  // and use the primary verified address so JIT provisioning still has an email.
  const url = new URL(userinfoEndpoint);
  if (url.hostname === "api.github.com" && userinfo.email == null) {
    const email = await fetchGithubPrimaryEmail(url.origin, accessToken);
    if (email) userinfo.email = email;
  }
  return userinfo;
}

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/** Resolve a GitHub account's primary verified email via /user/emails. */
async function fetchGithubPrimaryEmail(
  apiOrigin: string,
  accessToken: string
): Promise<string | null> {
  const res = await fetch(new URL("/user/emails", apiOrigin), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "chouse-ui-sso",
    },
  });
  if (!res.ok) {
    logger.warn(
      { module: "SSO", status: res.status },
      "GitHub /user/emails request failed; proceeding without email"
    );
    return null;
  }
  const body: unknown = await res.json();
  if (!Array.isArray(body)) return null;
  const emails = body.filter(
    (e): e is GithubEmail =>
      typeof e === "object" && e !== null && typeof (e as GithubEmail).email === "string"
  );
  const chosen =
    emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
  return chosen ? chosen.email : null;
}

export function normalizeOidcClaims(
  providerId: string,
  claims: Record<string, unknown>,
  // Optional override: which claim to read for each field. Defaults to the OIDC
  // standard names (sub / email / preferred_username / name).
  mapping?: Record<string, string>
): SsoIdentity {
  const str = (claim: string): string | null =>
    typeof claims[claim] === "string" ? (claims[claim] as string) : null;

  const subject = str(mapping?.subject ?? "sub");
  if (!subject) {
    throw new Error(
      `[SSO] Provider ${providerId} ID token has no ${mapping?.subject ?? "sub"} claim`
    );
  }
  const email = str(mapping?.email ?? "email");
  const username = str(mapping?.username ?? "preferred_username");
  return {
    provider: providerId,
    subject,
    email: email ? email.toLowerCase() : null,
    emailVerified: claims.email_verified === true,
    username: username ? username.toLowerCase() : null,
    displayName: str(mapping?.displayName ?? "name"),
    claims,
  };
}

export function applyClaimMapping(
  providerId: string,
  mapping: Record<string, string>,
  userinfo: Record<string, unknown>
): SsoIdentity {
  const pick = (field: string | undefined): string | null => {
    if (!field) return null;
    const v = userinfo[field];
    if (v === undefined || v === null) return null;
    return String(v);
  };

  const subject = pick(mapping.subject);
  if (!subject) {
    throw new Error(
      `[SSO] Provider ${providerId} userinfo is missing mapped subject field "${mapping.subject}"`
    );
  }
  const email = pick(mapping.email);
  const username = pick(mapping.username);

  return {
    provider: providerId,
    subject,
    email: email ? email.toLowerCase() : null,
    emailVerified: false, // plain OAuth2 cannot assert verification
    username: username ? username.toLowerCase() : null,
    displayName:
      typeof userinfo.name === "string" ? userinfo.name : null,
    claims: userinfo,
  };
}
