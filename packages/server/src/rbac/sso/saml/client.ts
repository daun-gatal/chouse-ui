/**
 * SAML client — wraps @node-saml/node-saml. Builds AuthnRequests (SP-initiated)
 * and validates SAMLResponses (both flows), producing the shared SsoIdentity.
 * Signature verification is mandatory (wantAssertionsSigned) and delegated to
 * node-saml's vetted XML-DSig — never bypassed.
 *
 * InResponseTo is enforced via a database-backed request-ID cache shared by the
 * /start build path and the ACS validate path — across replicas, not just
 * across SAML() instances (ADR 0010): the request id issued when the
 * AuthnRequest is built is found again at the ACS. node-saml's
 * `ValidateInResponseTo.ifPresent` validates InResponseTo against this cache
 * when present (closing assertion-injection / login-CSRF) while allowing it to
 * be absent for genuinely IdP-initiated flows.
 */
import { DOMParser } from "@xmldom/xmldom";
import * as xpath from "xpath";
import {
  SAML,
  ValidateInResponseTo,
  type SamlConfig,
  type CacheProvider,
  type CacheItem,
} from "@node-saml/node-saml";
import { sql } from "drizzle-orm";
import type { SsoIdentity } from "../client";
import { rawAll, rawRun } from "../../db/raw";

export interface SamlProviderConfig {
  id: string;
  type: "saml";
  source: "config" | "database";
  displayName: string;
  samlIdpEntityId: string;
  samlIdpSsoUrl: string;
  samlIdpCertificate: string;
  samlSpEntityId: string;
  samlNameIdFormat?: string;
  samlAllowIdpInitiated?: boolean;
  samlTrustEmailVerified?: boolean;
  claimMapping?: Record<string, string>;
  roleMappingClaim?: string;
  roleMapping?: Record<string, string>;
}

/**
 * Result of a signature-validated SAML Response. The correlation fields come
 * from node-saml's VALIDATED profile / validated assertion XML — never from a
 * regex over the raw (partly unsigned) bytes.
 */
export interface SamlValidationResult {
  identity: SsoIdentity;
  inResponseTo: string | null; // VALIDATED profile.inResponseTo; null for IdP-initiated
  assertionId: string | null; // the validated assertion's ID attribute
  notOnOrAfter: Date | null; // the validated assertion's Conditions/@NotOnOrAfter
}

// node-saml asserts idpCert is present at construction time, even for building
// an AuthnRequest (which needs no IdP trust anchor). Supply a harmless empty-PEM
// placeholder so SP-initiated requests can be built without a configured cert.
// This placeholder can never validate a real signed response — any tampered or
// genuinely-signed assertion fails verification against it, which is the desired
// fail-closed behaviour.
const NO_VERIFY_CERT_PLACEHOLDER =
  "-----BEGIN CERTIFICATE-----\nMA==\n-----END CERTIFICATE-----";

// ONE module-level request-ID cache shared by every SAML() instance. Request IDs
// saved when an AuthnRequest is built at /start must still be present when the
// matching Response is validated at the ACS (which constructs a fresh SAML()
// instance). @node-saml/node-saml does NOT export its InMemoryCacheProvider, so
// we implement the tiny CacheProvider contract over a module-level Map with a TTL
// sweep — mirroring saml/handoff.ts. Entries live comfortably longer than the
// state cookie TTL (600s). node-saml stores `id -> issueInstant` and removes the
// entry on a successful validate, so a request id is effectively one-time-use.
const REQUEST_ID_TTL_MS = 10 * 60 * 1000;

async function sweepRequestIds(now: number): Promise<void> {
  await rawRun(sql`DELETE FROM rbac_saml_request_ids WHERE expires_at <= ${now}`);
}

/**
 * Backed by `rbac_saml_request_ids` rather than a Map (ADR 0010): the
 * AuthnRequest is built at /start on one replica and the matching Response is
 * validated at the ACS on another, so a process-local cache made SP-initiated
 * SAML fail roughly (N-1)/N of the time behind multiple replicas.
 *
 * node-saml stores `id -> issueInstant` and removes the entry on successful
 * validation, which makes a request id one-time-use — a property that only
 * actually holds if the store is shared.
 */
const samlRequestCache: CacheProvider = {
  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    const now = Date.now();
    await sweepRequestIds(now);
    // node-saml semantics: never overwrite an existing entry. ON CONFLICT DO
    // NOTHING makes that atomic, so two replicas cannot both claim one id.
    const rows = await rawAll(sql`
      INSERT INTO rbac_saml_request_ids (request_id, value, expires_at)
      VALUES (${key}, ${value}, ${now + REQUEST_ID_TTL_MS})
      ON CONFLICT (request_id) DO NOTHING
      RETURNING request_id
    `);
    if (rows.length === 0) return null;
    return { value, createdAt: now };
  },
  async getAsync(key: string): Promise<string | null> {
    await sweepRequestIds(Date.now());
    const rows = await rawAll(sql`SELECT value FROM rbac_saml_request_ids WHERE request_id = ${key}`);
    return rows.length > 0 ? String(rows[0].value) : null;
  },
  async removeAsync(key: string | null): Promise<string | null> {
    if (key == null) return null;
    await rawRun(sql`DELETE FROM rbac_saml_request_ids WHERE request_id = ${key}`);
    return key; // contract: return the removed key
  },
};

/** Test-only: clear the shared request-ID table between tests. */
export async function resetSamlRequestCache(): Promise<void> {
  await rawRun(sql`DELETE FROM rbac_saml_request_ids`);
}

/** Test-only: pre-seed a request id into the shared cache (mirrors /start). */
export async function seedSamlRequestId(
  id: string,
  instant: string = new Date().toISOString()
): Promise<void> {
  await samlRequestCache.saveAsync(id, instant);
}

function instance(p: SamlProviderConfig, acsUrl: string): SAML {
  const cfg: SamlConfig = {
    issuer: p.samlSpEntityId,
    callbackUrl: acsUrl,
    entryPoint: p.samlIdpSsoUrl,
    idpCert: p.samlIdpCertificate || NO_VERIFY_CERT_PLACEHOLDER,
    audience: p.samlSpEntityId,
    identifierFormat: p.samlNameIdFormat ?? null,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs: 5000,
    // 'ifPresent': validate InResponseTo against the shared cache when present,
    // allow it to be absent for IdP-initiated flows. Never 'always' — that
    // would break IdP-initiated entirely.
    validateInResponseTo: ValidateInResponseTo.ifPresent,
    cacheProvider: samlRequestCache,
  };
  return new SAML(cfg);
}

export async function buildSamlAuthnRequest(
  p: SamlProviderConfig,
  acsUrl: string,
  relayState: string
): Promise<{ url: string }> {
  const url = await instance(p, acsUrl).getAuthorizeUrlAsync(relayState, undefined, {});
  return { url };
}

// Namespace-aware selector for the validated assertion XML.
const selectAssertion = xpath.useNamespaces({
  saml: "urn:oasis:names:tc:SAML:2.0:assertion",
});

/**
 * Parse the assertion ID and Conditions/@NotOnOrAfter from the VALIDATED
 * assertion XML returned by node-saml. This runs ONLY after
 * validatePostResponseAsync has succeeded, and asserts there is EXACTLY ONE
 * <Assertion> element — rejecting zero or >1 defeats signature-wrapping. Uses a
 * real XML parser (no string regex on security-relevant fields).
 */
function parseValidatedAssertion(assertionXml: string): {
  assertionId: string | null;
  notOnOrAfter: Date | null;
} {
  const doc = new DOMParser().parseFromString(assertionXml, "text/xml");
  const assertions = selectAssertion(
    "//saml:Assertion",
    doc as never
  ) as unknown[];
  if (!Array.isArray(assertions) || assertions.length !== 1) {
    throw new Error(
      `[SAML] Expected exactly one Assertion in the validated response, found ${
        Array.isArray(assertions) ? assertions.length : 0
      }`
    );
  }
  const id = selectAssertion("string(//saml:Assertion/@ID)", doc as never) as string;
  const noa = selectAssertion(
    "string(//saml:Assertion/saml:Conditions/@NotOnOrAfter)",
    doc as never
  ) as string;
  const parsedDate = noa ? new Date(noa) : null;
  return {
    assertionId: id && id.trim() ? id.trim() : null,
    notOnOrAfter: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
  };
}

export async function validateSamlResponse(
  p: SamlProviderConfig,
  body: { SAMLResponse: string; RelayState?: string },
  acsUrl: string
): Promise<SamlValidationResult> {
  if (!p.samlIdpCertificate || !p.samlIdpCertificate.trim()) {
    throw new Error(`[SAML] Provider ${p.id} has no IdP certificate configured; cannot validate assertions`);
  }
  const { profile } = await instance(p, acsUrl).validatePostResponseAsync(body);
  if (!profile) throw new Error("[SAML] No profile in validated response");

  const attributes =
    profile.attributes && typeof profile.attributes === "object"
      ? (profile.attributes as Record<string, unknown>)
      : {};
  const claims: Record<string, unknown> = { ...attributes };

  const pick = (key: string | undefined): string | null => {
    if (!key) return null;
    const v = claims[key];
    if (Array.isArray(v)) return v.length ? String(v[0]) : null;
    return v == null ? null : String(v);
  };

  const m = p.claimMapping ?? {};
  const nameID = typeof profile.nameID === "string" ? profile.nameID : String(profile.nameID ?? "");
  const subject = pick(m.subject) ?? nameID;
  if (!subject) throw new Error("[SAML] Assertion has no usable subject");
  const mappedEmail = pick(m.email);
  const email = mappedEmail ?? (nameID.includes("@") ? nameID : null);
  const username = pick(m.username);

  const identity: SsoIdentity = {
    provider: p.id,
    subject,
    email: email ? email.toLowerCase() : null,
    // Opt-in per-provider trust (default false): only when the admin explicitly
    // trusts this IdP to assert email truthfully do we treat the email as verified.
    // When false, provisionSsoUser will NOT auto-link this SAML identity into an
    // existing account by email (prevents account-takeover via a forged email);
    // a brand-new SAML user is still JIT-created, so login keeps working.
    emailVerified: p.samlTrustEmailVerified === true,
    username: username ? username.toLowerCase() : null,
    displayName: pick(m.displayName),
    claims: { ...claims, nameID },
  };

  // InResponseTo from the VALIDATED profile (node-saml reads it from the Response
  // after the assertion signature is verified). null ⇒ IdP-initiated.
  const inResponseTo =
    typeof profile.inResponseTo === "string" && profile.inResponseTo
      ? profile.inResponseTo
      : null;

  // assertionId / notOnOrAfter come from the VALIDATED assertion XML (node-saml
  // exposes the verified assertion via getAssertionXml). The profile itself does
  // NOT expose the assertion's ID, so we parse the validated XML with a real XML
  // parser and assert a single Assertion element.
  let assertionId: string | null = null;
  let notOnOrAfter: Date | null = null;
  const getAssertionXml = profile.getAssertionXml;
  if (typeof getAssertionXml === "function") {
    const assertionXml = getAssertionXml.call(profile);
    if (typeof assertionXml === "string" && assertionXml.trim()) {
      ({ assertionId, notOnOrAfter } = parseValidatedAssertion(assertionXml));
    }
  }

  return { identity, inResponseTo, assertionId, notOnOrAfter };
}

export function resolveSamlProviderByIssuer<
  T extends { samlIdpEntityId?: string | null; type: string }
>(providers: Iterable<T>, issuer: string): T | undefined {
  for (const p of providers) {
    if (p.type === "saml" && p.samlIdpEntityId === issuer) return p;
  }
  return undefined;
}

/**
 * Extract the SAML Issuer (IdP entityID) from a decoded SAMLResponse, for ROUTING
 * ONLY (pick the provider whose certificate validates the signature) — never a
 * security boundary; node-saml re-validates the signature against the resolved
 * provider's cert. Parsed with the same XML library node-saml uses, selecting by
 * `local-name()` so it is namespace-prefix-agnostic (the SAML assertion namespace
 * prefix isn't fixed: Okta emits `saml2:Issuer`, others `saml:Issuer` or an
 * unprefixed `Issuer`). Returns the first Issuer found (Response- or
 * Assertion-level — both carry the IdP entityID).
 */
export function extractSamlIssuer(decodedXml: string): string | undefined {
  let doc;
  try {
    doc = new DOMParser().parseFromString(decodedXml, "text/xml");
  } catch {
    return undefined;
  }
  const node = xpath.select1("(//*[local-name()='Issuer'])[1]", doc as never) as
    | { textContent?: string | null }
    | undefined;
  const issuer = node?.textContent?.trim() ?? "";
  return issuer || undefined;
}

/**
 * Non-sensitive envelope fields of a decoded SAMLResponse for DEBUG-LEVEL
 * troubleshooting — the values that cause most validation failures
 * (audience/destination/InResponseTo/clock mismatches). Deliberately EXCLUDES
 * PII: no NameID, no AttributeStatement, no signature. The user-facing
 * attribute/claim set is logged separately on the success path by
 * provisionSsoUser. Namespace-prefix-agnostic (selects by local-name()).
 */
export function summarizeSamlResponse(
  decodedXml: string,
): { issuer?: string; destination?: string; inResponseTo?: string; audience?: string; notBefore?: string; notOnOrAfter?: string } {
  let doc;
  try {
    doc = new DOMParser().parseFromString(decodedXml, "text/xml");
  } catch {
    return {};
  }
  const val = (expr: string): string | undefined => {
    const n = xpath.select1(expr, doc as never) as
      | { value?: string | null; nodeValue?: string | null; textContent?: string | null }
      | undefined;
    const v = (n && (n.value ?? n.nodeValue ?? n.textContent)) ?? "";
    return v.trim() || undefined;
  };
  return {
    issuer: extractSamlIssuer(decodedXml),
    destination: val("(//*[local-name()='Response'])[1]/@Destination"),
    inResponseTo: val("(//*[local-name()='Response'])[1]/@InResponseTo"),
    audience: val("(//*[local-name()='Audience'])[1]"),
    notBefore: val("(//*[local-name()='Conditions'])[1]/@NotBefore"),
    notOnOrAfter: val("(//*[local-name()='Conditions'])[1]/@NotOnOrAfter"),
  };
}
