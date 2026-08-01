import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { closeDatabase } from "../../db";
import { runMigrations } from "../../db/migrations";
import { freshDatabase } from "../../db/migrationTestHarness";
import { makeSignedSamlResponse } from "../testFixtures/samlFixtures";
import {
  validateSamlResponse,
  buildSamlAuthnRequest,
  resolveSamlProviderByIssuer,
  extractSamlIssuer,
  summarizeSamlResponse,
  resetSamlRequestCache,
  seedSamlRequestId,
  type SamlProviderConfig,
} from "./client";

// The request-ID cache is database-backed (ADR 0010), so each test needs a
// migrated database rather than just a cleared Map.
beforeEach(async () => {
  await freshDatabase("sqlite");
  await runMigrations();
  await resetSamlRequestCache();
});

afterEach(async () => {
  await closeDatabase();
});

function provider(overrides: Partial<SamlProviderConfig> = {}): SamlProviderConfig {
  return {
    id: "okta",
    type: "saml",
    source: "database",
    displayName: "Okta",
    samlIdpEntityId: "https://idp.test/entity",
    samlIdpSsoUrl: "https://idp.test/sso",
    samlIdpCertificate: overrides.samlIdpCertificate ?? "",
    samlSpEntityId: "https://app.test/sp",
    samlNameIdFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    samlAllowIdpInitiated: true,
    claimMapping: undefined,
    roleMappingClaim: "groups",
    roleMapping: undefined,
    ...overrides,
  };
}
const ACS = "https://app.test/auth/sso/saml/acs";

describe("validateSamlResponse", () => {
  it("verifies a signed assertion and maps NameID + attributes to SsoIdentity", async () => {
    const { samlResponseB64, idpCertPem } = await makeSignedSamlResponse({
      attributes: { groups: ["ch-dev", "all"] },
    });
    const { identity, inResponseTo, assertionId, notOnOrAfter } = await validateSamlResponse(
      provider({ samlIdpCertificate: idpCertPem, samlTrustEmailVerified: true }),
      { SAMLResponse: samlResponseB64 },
      ACS
    );
    expect(identity.subject).toBe("alice@corp.test");
    expect(identity.email).toBe("alice@corp.test");
    expect(identity.emailVerified).toBe(true);
    expect(identity.claims.groups).toEqual(["ch-dev", "all"]);
    // No InResponseTo on this fixture → IdP-initiated shape.
    expect(inResponseTo).toBeNull();
    // assertionId + notOnOrAfter come from the VALIDATED assertion XML.
    expect(assertionId).toBe("_assert1");
    expect(notOnOrAfter).toBeInstanceOf(Date);
  });

  it("defaults emailVerified to false when samlTrustEmailVerified is not set", async () => {
    const { samlResponseB64, idpCertPem } = await makeSignedSamlResponse({
      attributes: { groups: ["ch-dev", "all"] },
    });
    const { identity } = await validateSamlResponse(
      provider({ samlIdpCertificate: idpCertPem }),
      { SAMLResponse: samlResponseB64 },
      ACS
    );
    expect(identity.email).toBe("alice@corp.test");
    expect(identity.emailVerified).toBe(false);
  });

  it("rejects a tampered assertion", async () => {
    const { samlResponseB64, idpCertPem } = await makeSignedSamlResponse({ tamperAfterSign: true });
    await expect(
      validateSamlResponse(
        provider({ samlIdpCertificate: idpCertPem }),
        { SAMLResponse: samlResponseB64 },
        ACS
      )
    ).rejects.toThrow();
  });

  it("rejects an unsigned assertion", async () => {
    const { samlResponseB64, idpCertPem } = await makeSignedSamlResponse({ sign: false });
    await expect(
      validateSamlResponse(
        provider({ samlIdpCertificate: idpCertPem }),
        { SAMLResponse: samlResponseB64 },
        ACS
      )
    ).rejects.toThrow();
  });

  it("rejects wrong audience", async () => {
    const { samlResponseB64, idpCertPem } = await makeSignedSamlResponse({ audience: "https://evil/sp" });
    await expect(
      validateSamlResponse(
        provider({ samlIdpCertificate: idpCertPem }),
        { SAMLResponse: samlResponseB64 },
        ACS
      )
    ).rejects.toThrow();
  });

  it("rejects an expired assertion", async () => {
    const { samlResponseB64, idpCertPem } = await makeSignedSamlResponse({
      notBefore: new Date(Date.now() - 2 * 3600_000).toISOString(),
      notOnOrAfter: new Date(Date.now() - 3600_000).toISOString(), // expired 1h ago
    });
    await expect(
      validateSamlResponse(
        provider({ samlIdpCertificate: idpCertPem }),
        { SAMLResponse: samlResponseB64 },
        ACS
      )
    ).rejects.toThrow();
  });

  it("rejects a provider with no IdP certificate configured (fail-closed, clear error)", async () => {
    const { samlResponseB64 } = await makeSignedSamlResponse({});
    await expect(
      validateSamlResponse(provider({ samlIdpCertificate: "" }), { SAMLResponse: samlResponseB64 }, ACS),
    ).rejects.toThrow(/no IdP certificate/i);
  });

  it("applies claimMapping to override email/username source", async () => {
    const { samlResponseB64, idpCertPem } = await makeSignedSamlResponse({
      attributes: { mail: "a@b.co", uid: "alice", groups: "ch-dev" },
    });
    const { identity } = await validateSamlResponse(
      provider({
        samlIdpCertificate: idpCertPem,
        claimMapping: { email: "mail", username: "uid" },
      }),
      { SAMLResponse: samlResponseB64 },
      ACS
    );
    expect(identity.email).toBe("a@b.co");
    expect(identity.username).toBe("alice");
  });

  // ── InResponseTo enforcement against the shared request-ID cache ───────────

  it("accepts an SP-initiated response whose InResponseTo matches a cached request id", async () => {
    const requestId = "_req-cached-1";
    const { samlResponseB64, idpCertPem } = await makeSignedSamlResponse({
      inResponseTo: requestId,
    });
    // Mirror what /start does: stash the request id node-saml issued.
    await seedSamlRequestId(requestId);

    const { identity, inResponseTo } = await validateSamlResponse(
      provider({ samlIdpCertificate: idpCertPem }),
      { SAMLResponse: samlResponseB64 },
      ACS
    );
    expect(identity.subject).toBe("alice@corp.test");
    // The VALIDATED InResponseTo is surfaced for downstream flow-gating.
    expect(inResponseTo).toBe(requestId);
  });

  it("rejects an SP-initiated response whose InResponseTo was never issued (cache miss)", async () => {
    const { samlResponseB64, idpCertPem } = await makeSignedSamlResponse({
      inResponseTo: "_req-never-issued",
    });
    // Cache intentionally empty → node-saml's ifPresent check must reject.
    await expect(
      validateSamlResponse(
        provider({ samlIdpCertificate: idpCertPem }),
        { SAMLResponse: samlResponseB64 },
        ACS
      )
    ).rejects.toThrow();
  });

  it("rejects a response carrying more than one Assertion (signature-wrapping defence)", async () => {
    const requestId = "_req-wrap-1";
    const { samlResponseB64, idpCertPem } = await makeSignedSamlResponse({
      inResponseTo: requestId,
    });
    await seedSamlRequestId(requestId);
    // Inject a second, unsigned Assertion alongside the signed one.
    const decoded = Buffer.from(samlResponseB64, "base64").toString("utf8");
    const injected = decoded.replace(
      "</samlp:Response>",
      '<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_evil"><saml:Issuer>https://idp.test/entity</saml:Issuer></saml:Assertion></samlp:Response>'
    );
    const tampered = Buffer.from(injected).toString("base64");
    await expect(
      validateSamlResponse(
        provider({ samlIdpCertificate: idpCertPem }),
        { SAMLResponse: tampered },
        ACS
      )
    ).rejects.toThrow();
  });
});

describe("buildSamlAuthnRequest", () => {
  it("returns a redirect URL to the IdP SSO endpoint carrying RelayState + SAMLRequest", async () => {
    const { url } = await buildSamlAuthnRequest(provider(), ACS, "relay-xyz");
    expect(url.startsWith("https://idp.test/sso")).toBe(true);
    expect(url).toContain("RelayState=relay-xyz");
    expect(url).toContain("SAMLRequest=");
  });
});

describe("resolveSamlProviderByIssuer", () => {
  it("matches a saml provider by its IdP entityID; ignores non-saml", () => {
    const list = [
      { id: "o", type: "oidc" },
      { id: "s", type: "saml", samlIdpEntityId: "https://idp.test/entity" },
    ] as never[];
    expect(resolveSamlProviderByIssuer(list, "https://idp.test/entity")?.id).toBe("s");
    expect(resolveSamlProviderByIssuer(list, "https://other")).toBeUndefined();
  });
});

describe("extractSamlIssuer", () => {
  // Real IdPs always declare the SAML namespaces; cases mirror that (well-formed XML).
  const SAMLP = "urn:oasis:names:tc:SAML:2.0:protocol";
  const SAML = "urn:oasis:names:tc:SAML:2.0:assertion";
  const cases: Array<[string, string]> = [
    ["saml: prefix", `<samlp:Response xmlns:samlp="${SAMLP}" xmlns:saml="${SAML}"><saml:Issuer>https://idp/entity</saml:Issuer></samlp:Response>`],
    ["saml2: prefix (Okta)", `<saml2p:Response xmlns:saml2p="${SAMLP}" xmlns:saml2="${SAML}"><saml2:Issuer Format="urn:oasis:names:tc:SAML:2.0:nameid-format:entity">https://idp/entity</saml2:Issuer></saml2p:Response>`],
    ["no prefix (default ns)", `<Response xmlns="${SAMLP}"><Issuer xmlns="${SAML}">https://idp/entity</Issuer></Response>`],
    ["surrounding whitespace", `<saml2:Issuer xmlns:saml2="${SAML}">\n  https://idp/entity\n</saml2:Issuer>`],
  ];
  it.each(cases)("extracts the issuer with %s", (_label, xml) => {
    expect(extractSamlIssuer(xml)).toBe("https://idp/entity");
  });

  it("returns undefined when no Issuer element is present", () => {
    expect(extractSamlIssuer(`<samlp:Response xmlns:samlp="${SAMLP}"><samlp:Status/></samlp:Response>`)).toBeUndefined();
  });
});

describe("summarizeSamlResponse", () => {
  const SAMLP = "urn:oasis:names:tc:SAML:2.0:protocol";
  const SAML = "urn:oasis:names:tc:SAML:2.0:assertion";
  const xml = `<saml2p:Response xmlns:saml2p="${SAMLP}" xmlns:saml2="${SAML}" Destination="https://app/acs" InResponseTo="_req1"><saml2:Issuer>https://idp/entity</saml2:Issuer><saml2:Assertion><saml2:Subject><saml2:NameID>secret@user.test</saml2:NameID></saml2:Subject><saml2:Conditions NotBefore="2030-01-01T00:00:00Z" NotOnOrAfter="2030-01-01T00:05:00Z"><saml2:AudienceRestriction><saml2:Audience>https://app/sp</saml2:Audience></saml2:AudienceRestriction></saml2:Conditions><saml2:AttributeStatement><saml2:Attribute Name="email"><saml2:AttributeValue>secret@user.test</saml2:AttributeValue></saml2:Attribute></saml2:AttributeStatement></saml2:Assertion></saml2p:Response>`;

  it("extracts the non-sensitive envelope fields", () => {
    expect(summarizeSamlResponse(xml)).toEqual({
      issuer: "https://idp/entity",
      destination: "https://app/acs",
      inResponseTo: "_req1",
      audience: "https://app/sp",
      notBefore: "2030-01-01T00:00:00Z",
      notOnOrAfter: "2030-01-01T00:05:00Z",
    });
  });

  it("never includes PII (NameID / attribute values)", () => {
    expect(JSON.stringify(summarizeSamlResponse(xml))).not.toContain("secret@user.test");
  });
});
