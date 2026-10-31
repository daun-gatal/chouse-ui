/**
 * Random secrets, hashing and PKCE for MCP OAuth (ADR 0028 §2). Codes and
 * tokens are 256-bit random values stored only as SHA-256 hashes.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";

/** OAuth access token: works on /mcp only. */
export const OAUTH_ACCESS_PREFIX = "ch_oat_";
/** OAuth refresh token: works on /oauth/token only. */
export const OAUTH_REFRESH_PREFIX = "ch_ort_";
const CLIENT_ID_PREFIX = "chc_";

export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function newClientId(): string {
  return `${CLIENT_ID_PREFIX}${randomSecret(16)}`;
}

export function hashSecret(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** RFC 7636 §4.1: 43–128 characters from the unreserved set. */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
/** A base64url SHA-256 digest: 43 characters, no padding. */
const CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

export function isValidChallenge(challenge: string): boolean {
  return CHALLENGE.test(challenge);
}

/** S256 only: base64url(SHA-256(verifier)) must equal the challenge sent to /authorize. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier) || !CHALLENGE.test(challenge)) return false;
  const computed = Buffer.from(createHash("sha256").update(verifier, "ascii").digest("base64url"));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}
