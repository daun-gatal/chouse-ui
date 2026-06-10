/**
 * SSO State Cookie
 *
 * The /start endpoint packs state + nonce + PKCE verifier + redirect target
 * into a short-lived signed JWT stored in an HttpOnly cookie; /callback
 * verifies it. Signed with the app's JWT_SECRET (HS256), 10-minute TTL.
 */

import { SignJWT, jwtVerify } from 'jose';

export const SSO_STATE_COOKIE = 'chouse_sso_state';
export const SSO_STATE_TTL_SECONDS = 600;

const NODE_ENV = process.env.NODE_ENV || 'development';
const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || (NODE_ENV === 'production' ? '' : 'dev-jwt-secret-min-32-chars-do-not-use-in-production')
);

export interface SsoStatePayload {
  provider: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirect: string;
}

export async function signStatePayload(payload: SsoStatePayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SSO_STATE_TTL_SECONDS}s`)
    .sign(SECRET);
}

export async function verifyStatePayload(token: string): Promise<SsoStatePayload> {
  const { payload } = await jwtVerify(token, SECRET);
  const { provider, state, nonce, codeVerifier, redirect } = payload as Record<string, unknown>;
  if (
    typeof provider !== 'string' || typeof state !== 'string' ||
    typeof nonce !== 'string' || typeof codeVerifier !== 'string' || typeof redirect !== 'string'
  ) {
    throw new Error('[SSO] Malformed state payload');
  }
  return { provider, state, nonce, codeVerifier, redirect };
}
