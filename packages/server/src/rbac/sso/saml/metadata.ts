import { DOMParser } from "@xmldom/xmldom";
import * as xpath from "xpath";

export interface ParsedIdpMetadata {
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string; // PEM
}

const select = xpath.useNamespaces({
  md: "urn:oasis:names:tc:SAML:2.0:metadata",
  ds: "http://www.w3.org/2000/09/xmldsig#",
});

export function parseIdpMetadataXml(xml: string): ParsedIdpMetadata {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const entity = select(
    "string(/md:EntityDescriptor/@entityID)",
    doc as never,
  ) as string;
  const sso = select(
    "string(//md:IDPSSODescriptor/md:SingleSignOnService[@Binding='urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect']/@Location)",
    doc as never,
  ) as string;
  const certRaw = select(
    "string((//md:IDPSSODescriptor/md:KeyDescriptor[not(@use) or @use='signing']//ds:X509Certificate)[1])",
    doc as never,
  ) as string;
  if (!entity || !sso || !certRaw) {
    throw new Error(
      "[SAML] Metadata missing entityID, HTTP-Redirect SSO URL, or signing certificate",
    );
  }
  const body = certRaw.replace(/\s/g, "").match(/.{1,64}/g)?.join("\n") ?? certRaw;
  const idpCertificate = `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----`;
  return { idpEntityId: entity, idpSsoUrl: sso, idpCertificate };
}

export async function fetchIdpMetadata(url: string): Promise<ParsedIdpMetadata> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`[SAML] Metadata fetch failed: HTTP ${res.status}`);
  }
  return parseIdpMetadataXml(await res.text());
}
