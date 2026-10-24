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
