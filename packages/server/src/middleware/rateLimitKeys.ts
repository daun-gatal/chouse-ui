/**
 * Rate-limit keys for the login and SSO limiters.
 *
 * The client controls the whole X-Forwarded-For header it sends, so keying on
 * the header as-is (or its leftmost entry) let one client rotate fake values
 * and get a fresh login budget per request. Each proxy *appends* the address it
 * saw, so the rightmost entry is the one the nearest proxy vouches for.
 *
 * With no proxy in front, every X-Forwarded-For value is client-chosen, which
 * is why login also has a per-account limit that no header can change.
 */
import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { extractTokenFromHeader, verifyAccessToken } from "../rbac/services/jwt";
import { PAT_PREFIX, patOwner } from "../rbac/services/personalAccessTokens";
import { OAUTH_ACCESS_PREFIX } from "../mcp/oauth/secrets";
import { oauthAccessTokenOwner } from "../mcp/oauth/store";

/** Best available client address for rate limiting. */
export function rateLimitClientKey(c: Context): string {
  const forwarded = c.req.header("X-Forwarded-For");
  if (forwarded) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
    const nearest = hops[hops.length - 1];
    if (nearest) return nearest;
  }

  const realIp = c.req.header("X-Real-IP")?.trim();
  if (realIp) return realIp;

  try {
    const address = getConnInfo(c).remote.address;
    if (address) return address;
  } catch {
    // Not served by Bun.serve (e.g. app.request in tests): no socket to read.
  }
  return "unknown";
}

/**
 * Key a login attempt by the account it targets, so guessing one account's
 * password is capped however many addresses the guesses come from.
 */
export async function loginAccountKey(c: Context): Promise<string> {
  try {
    const body: unknown = await c.req.json();
    if (body && typeof body === "object" && "identifier" in body && typeof body.identifier === "string") {
      const identifier = body.identifier.trim().toLowerCase();
      if (identifier) return identifier;
    }
  } catch {
    // Malformed body: the route's validator rejects it; share one bucket.
  }
  return "invalid-body";
}

/**
 * Key a request by who sent it, for the per-user limiters (`/api/query/*`,
 * `/api/ai/*`, `/api/*`).
 *
 * These limiters run before any route's auth middleware, so `rbacUserId` is not
 * set yet and keying on it put every caller in one shared bucket. Instead the
 * key comes from the bearer token itself, always as the owning user, so a user
 * can't multiply their budget by opening sessions or minting tokens:
 *
 * - a session JWT is verified (signature and expiry, no database read);
 * - a personal access or OAuth token is looked up by its hash (one indexed
 *   read, no writes). Expiry and revocation are left to the route's auth, which
 *   rejects such a token anyway;
 * - anything else (no token, a bad JWT, an unknown token) counts by client
 *   address, so made-up tokens neither spend a real user's budget nor escape the
 *   per-address limit.
 */
export async function rateLimitUserKey(c: Context): Promise<string> {
  const token = extractTokenFromHeader(c.req.header("Authorization"));
  if (token) {
    let userId: string | null = null;
    if (token.startsWith(PAT_PREFIX)) {
      userId = await patOwner(token);
    } else if (token.startsWith(OAUTH_ACCESS_PREFIX)) {
      userId = await oauthAccessTokenOwner(token);
    } else {
      try {
        userId = (await verifyAccessToken(token)).sub || null;
      } catch {
        // Invalid or expired: the route rejects it; meanwhile count it by address.
      }
    }
    if (userId) return `user:${userId}`;
  }
  return `addr:${rateLimitClientKey(c)}`;
}
