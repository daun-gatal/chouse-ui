import { describe, it, expect } from "vitest";
import { resolveSsoBrand } from "./ssoBrand";

const provider = (
  id: string,
  displayName: string,
  type: "oidc" | "oauth2" | "saml" = "oidc",
) => ({ id, displayName, type });

describe("resolveSsoBrand", () => {
  it("matches well-known brands by id", () => {
    expect(resolveSsoBrand(provider("google-workspace", "Sign in"))).toBe("google");
    expect(resolveSsoBrand(provider("okta-prod", "Corp"))).toBe("okta");
    expect(resolveSsoBrand(provider("gh", "GitHub"))).toBe("github");
    expect(resolveSsoBrand(provider("gitlab", "GitLab"))).toBe("gitlab");
  });

  it("matches by display name when the id is opaque", () => {
    expect(resolveSsoBrand(provider("idp1", "Continue with Google"))).toBe("google");
    expect(resolveSsoBrand(provider("idp2", "Apple"))).toBe("apple");
  });

  it("maps Microsoft aliases (azure / entra) to microsoft", () => {
    expect(resolveSsoBrand(provider("azure-ad", "AzureAD"))).toBe("microsoft");
    expect(resolveSsoBrand(provider("entra", "Entra ID"))).toBe("microsoft");
    expect(resolveSsoBrand(provider("o365", "Office 365"))).toBe("microsoft");
  });

  it("maps AWS / Cognito to amazon", () => {
    expect(resolveSsoBrand(provider("cognito", "AWS"))).toBe("amazon");
  });

  it("is case-insensitive", () => {
    expect(resolveSsoBrand(provider("OKTA", "OKTA"))).toBe("okta");
  });

  it("falls back to a generic glyph keyed on protocol type", () => {
    expect(resolveSsoBrand(provider("acme", "ACME Corp", "oidc"))).toBe("generic-oidc");
    expect(resolveSsoBrand(provider("acme", "ACME Corp", "oauth2"))).toBe("generic-oidc");
    expect(resolveSsoBrand(provider("acme", "ACME Corp", "saml"))).toBe("generic-saml");
  });
});
