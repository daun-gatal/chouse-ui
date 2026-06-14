/**
 * SSO brand inference.
 *
 * The public provider payload only gives us an id, a display name, and the
 * protocol type (oidc/oauth2/saml). To show a recognisable logo on the login
 * page we infer a *brand* from the id + display name (e.g. "okta-prod" →
 * `okta`), falling back to a generic protocol glyph when nothing matches.
 */

/**
 * Minimal shape needed to infer a brand: a stable id/slug, a human label, and
 * (optionally) the protocol type used only for the generic fallback glyph.
 */
export interface SsoBrandInput {
  id: string;
  displayName: string;
  type?: "oidc" | "oauth2" | "saml";
}

/** Known brands we ship a logo for, plus generic protocol fallbacks. */
export type SsoBrand =
  | "google"
  | "microsoft"
  | "okta"
  | "github"
  | "gitlab"
  | "auth0"
  | "keycloak"
  | "apple"
  | "slack"
  | "amazon"
  | "generic-oidc"
  | "generic-saml";

// Keyword → brand. Order matters: more specific tokens come first so e.g.
// "azure"/"entra" resolve to Microsoft before anything broader.
const BRAND_KEYWORDS: ReadonlyArray<readonly [RegExp, SsoBrand]> = [
  [/google|gsuite|gws|workspace/, "google"],
  [/microsoft|azure|entra|aad|office365|o365|msft/, "microsoft"],
  [/okta/, "okta"],
  [/github/, "github"],
  [/gitlab/, "gitlab"],
  [/auth0/, "auth0"],
  [/keycloak/, "keycloak"],
  [/apple/, "apple"],
  [/slack/, "slack"],
  [/amazon|cognito|aws/, "amazon"],
];

/**
 * Resolve the brand for a provider from its id and display name, falling back
 * to a generic glyph keyed on the protocol type.
 */
export function resolveSsoBrand(provider: SsoBrandInput): SsoBrand {
  const haystack = `${provider.id} ${provider.displayName}`.toLowerCase();
  for (const [pattern, brand] of BRAND_KEYWORDS) {
    if (pattern.test(haystack)) return brand;
  }
  return provider.type === "saml" ? "generic-saml" : "generic-oidc";
}
