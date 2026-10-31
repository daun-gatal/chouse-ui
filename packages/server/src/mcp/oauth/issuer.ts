/**
 * Where CHouse signs agents in (ADR 0028 §1): the MCP public address from
 * AI Governance › MCP, else PUBLIC_BASE_URL. OAuth needs it, because tokens are
 * bound to the MCP URL and agents discover the endpoints from it.
 */

import { MCP_PATH } from "../path";
import type { McpSettings } from "../settings";

export interface OAuthIssuer {
  /** The authorization server's identifier, e.g. https://chouse.corp */
  issuer: string;
  /** The protected resource (the MCP endpoint), e.g. https://chouse.corp/mcp */
  resource: string;
}

export type IssuerResult = { ok: true; value: OAuthIssuer } | { ok: false; reason: string };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** A host on this machine: plain http is acceptable there, as OAuth 2.1 allows. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost");
}

export function resolveIssuer(settings: Pick<McpSettings, "publicUrl">, env: Record<string, string | undefined> = process.env): IssuerResult {
  const raw = settings.publicUrl ?? env.PUBLIC_BASE_URL?.trim() ?? "";
  if (!raw) {
    return { ok: false, reason: "Set the public address in AI Governance › MCP (or PUBLIC_BASE_URL) first: agents sign in at that address." };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `The public address "${raw}" is not a valid URL.` };
  }
  if (url.search || url.hash || url.username || url.password) {
    return { ok: false, reason: "The public address must not have a query, fragment or credentials." };
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    return { ok: false, reason: "Agents can only sign in over https (plain http is allowed for localhost only)." };
  }
  const issuer = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  return { ok: true, value: { issuer, resource: `${issuer}${MCP_PATH}` } };
}

/** Where agents find the protected resource metadata (RFC 9728 §3.1: inserted before the resource's path). */
export function resourceMetadataUrl(issuer: OAuthIssuer): string {
  const resource = new URL(issuer.resource);
  return `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;
}

/** Two spellings of the same resource URL compare equal (case of scheme/host, a trailing slash). */
export function sameResource(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.origin === right.origin && left.pathname.replace(/\/+$/, "") === right.pathname.replace(/\/+$/, "") && !left.search && !left.hash;
  } catch {
    return false;
  }
}
