import { describe, it, expect } from "bun:test";
import { parseIdpMetadataXml } from "./metadata";

const XML = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.test/entity"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>MIIBconly</X509Certificate></X509Data></KeyInfo></KeyDescriptor><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.test/sso"/></IDPSSODescriptor></EntityDescriptor>`;

describe("parseIdpMetadataXml", () => {
  it("extracts entityID, SSO URL and signing certificate", () => {
    const r = parseIdpMetadataXml(XML);
    expect(r.idpEntityId).toBe("https://idp.test/entity");
    expect(r.idpSsoUrl).toBe("https://idp.test/sso");
    expect(r.idpCertificate.replace(/\s/g, "")).toContain("MIIBconly");
    expect(r.idpCertificate).toContain("BEGIN CERTIFICATE");
  });

  it("throws on metadata without an IDPSSODescriptor", () => {
    expect(() => parseIdpMetadataXml("<EntityDescriptor/>")).toThrow();
  });
});
