/**
 * Which redirect URIs an agent may register, and when a requested one matches
 * (ADR 0028 §1). An administrator can narrow them to a list of hosts.
 */

import { isLoopbackHost } from "./issuer";

const MAX_REDIRECT_URI_LENGTH = 2000;
/** Schemes that would run code or read files instead of reaching an agent. */
const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "about:", "blob:", "vbscript:", "ftp:", "ws:", "wss:", "mailto:", "tel:"]);

/** `example.com` matches only itself; `*.example.com` matches its subdomains. */
export function hostMatches(hostname: string, pattern: string): boolean {
  const host = hostname.toLowerCase();
  if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1));
  return host === pattern;
}

/**
 * Why a redirect URI can't be registered, or null when it can: https anywhere
 * (or on an allowed host), plain http on this machine only, or an app's own
 * scheme (cursor://…) when no host list is set.
 */
export function redirectUriProblem(uri: string, allowedHosts: string[]): string | null {
  if (uri.length > MAX_REDIRECT_URI_LENGTH) return "is too long";
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return "is not a valid URL";
  }
  if (url.hash || uri.includes("#")) return "must not have a fragment";
  if (url.username || url.password) return "must not include credentials";
  const restricted = allowedHosts.length > 0;
  if (url.protocol === "https:") {
    if (restricted && !allowedHosts.some((pattern) => hostMatches(url.hostname, pattern))) return `points at ${url.hostname}, which is not an allowed host`;
    return null;
  }
  if (url.protocol === "http:") {
    if (!isLoopbackHost(url.hostname)) return "must use https (plain http is allowed for localhost only)";
    if (restricted && !allowedHosts.some((pattern) => hostMatches(url.hostname, pattern))) return `points at ${url.hostname}, which is not an allowed host`;
    return null;
  }
  if (BLOCKED_SCHEMES.has(url.protocol)) return `uses ${url.protocol}, which is not allowed`;
  if (restricted) return "uses an app scheme, which is not allowed while redirect hosts are restricted";
  return null;
}

function isLoopbackHttp(url: URL): boolean {
  return url.protocol === "http:" && isLoopbackHost(url.hostname);
}

/**
 * The registered URI a requested one matches: exactly, or for a loopback
 * address on any port (RFC 8252 §7.3, desktop agents pick a free port).
 */
export function matchRegisteredUri(requested: string, registered: string[]): string | null {
  if (registered.includes(requested)) return requested;
  let asked: URL;
  try {
    asked = new URL(requested);
  } catch {
    return null;
  }
  if (!isLoopbackHttp(asked) || asked.hash) return null;
  for (const candidate of registered) {
    let known: URL;
    try {
      known = new URL(candidate);
    } catch {
      continue;
    }
    if (isLoopbackHttp(known) && known.hostname === asked.hostname && known.pathname === asked.pathname && known.search === asked.search) {
      return requested;
    }
  }
  return null;
}

/** What the consent page shows as "returns to": the host, or the app scheme. */
export function redirectLabel(uri: string): string {
  try {
    const url = new URL(uri);
    if (url.protocol === "https:" || url.protocol === "http:") return url.hostname;
    return `${url.protocol}//${url.hostname}`.replace(/\/\/$/, "");
  } catch {
    return uri;
  }
}
