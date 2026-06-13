/**
 * Signed SAML Response fixture generator for tests. Generates a fresh IdP
 * self-signed keypair (Bun WebCrypto + @peculiar/x509 — selfsigned/node-forge
 * does NOT work under Bun), builds a minimal SAML Response, and signs the
 * Assertion with xml-crypto the way @node-saml/node-saml expects. Returns the
 * base64 SAMLResponse plus the IdP cert PEM the SP must trust.
 */
import "reflect-metadata"; // @peculiar/x509 v2 (tsyringe) requires this polyfill before import
import { X509CertificateGenerator, cryptoProvider } from "@peculiar/x509";
import { SignedXml } from "xml-crypto";

cryptoProvider.set(crypto as Crypto); // Bun global WebCrypto

const RSA_ALG = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
} as const;

async function generateIdpKey(): Promise<{ certPem: string; privateKeyPem: string }> {
  const keys = await crypto.subtle.generateKey(RSA_ALG, true, ["sign", "verify"]);
  const cert = await X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: "CN=idp.test",
    notBefore: new Date("2020-01-01T00:00:00Z"),
    notAfter: new Date("2040-01-01T00:00:00Z"),
    keys,
    signingAlgorithm: RSA_ALG,
  });
  const certPem = cert.toString("pem");
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keys.privateKey);
  const b64 = Buffer.from(pkcs8).toString("base64").match(/.{1,64}/g)!.join("\n");
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----`;
  return { certPem, privateKeyPem };
}

export interface SamlFixture {
  samlResponseB64: string;
  idpCertPem: string;
}

export interface FixtureOpts {
  issuer?: string; // IdP entityID
  audience?: string; // SP entityID
  recipient?: string; // ACS URL
  nameId?: string;
  nameIdFormat?: string;
  attributes?: Record<string, string | string[]>;
  inResponseTo?: string; // omit for IdP-initiated
  notOnOrAfter?: string; // ISO; default 2030-01-01T00:05:00Z
  notBefore?: string; // ISO; default 2030-01-01T00:00:00Z
  sign?: boolean; // default true; false → unsigned (negative tests)
  tamperAfterSign?: boolean; // default false; flip a value to break the signature
}

export async function makeSignedSamlResponse(opts: FixtureOpts = {}): Promise<SamlFixture> {
  const { certPem, privateKeyPem } = await generateIdpKey();
  const issueInstant = "2030-01-01T00:00:00.000Z";
  const notBefore = opts.notBefore ?? issueInstant;
  const notOnOrAfter = opts.notOnOrAfter ?? "2030-01-01T00:05:00.000Z";
  const issuer = opts.issuer ?? "https://idp.test/entity";
  const audience = opts.audience ?? "https://app.test/sp";
  const recipient = opts.recipient ?? "https://app.test/auth/sso/saml/acs";
  const nameId = opts.nameId ?? "alice@corp.test";
  const nameIdFormat = opts.nameIdFormat ?? "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";
  const inResponseTo = opts.inResponseTo ? ` InResponseTo="${opts.inResponseTo}"` : "";
  const attrs = Object.entries(opts.attributes ?? { groups: "ch-dev" })
    .map(([name, val]) => {
      const vals = Array.isArray(val) ? val : [val];
      return `<saml:Attribute Name="${name}">${vals.map((v) => `<saml:AttributeValue>${v}</saml:AttributeValue>`).join("")}</saml:Attribute>`;
    })
    .join("");

  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_resp1" Version="2.0" IssueInstant="${issueInstant}"${inResponseTo} Destination="${recipient}"><saml:Issuer>${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_assert1" Version="2.0" IssueInstant="${issueInstant}"><saml:Issuer>${issuer}</saml:Issuer><saml:Subject><saml:NameID Format="${nameIdFormat}">${nameId}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData${inResponseTo} NotOnOrAfter="${notOnOrAfter}" Recipient="${recipient}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}"><saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${issueInstant}" SessionIndex="_sess1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement>${attrs}</saml:AttributeStatement></saml:Assertion></samlp:Response>`;

  let finalXml = xml;
  if (opts.sign !== false) {
    const sig = new SignedXml({ privateKey: privateKeyPem });
    sig.addReference({
      xpath: "//*[local-name(.)='Assertion']",
      digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
      transforms: [
        "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
        "http://www.w3.org/2001/10/xml-exc-c14n#",
      ],
    });
    sig.signatureAlgorithm = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
    sig.canonicalizationAlgorithm = "http://www.w3.org/2001/10/xml-exc-c14n#";
    sig.computeSignature(xml, {
      location: {
        reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']",
        action: "after",
      },
    });
    finalXml = sig.getSignedXml();
  }
  if (opts.tamperAfterSign) finalXml = finalXml.replace(nameId, "mallory@corp.test");
  return { samlResponseB64: Buffer.from(finalXml).toString("base64"), idpCertPem: certPem };
}
