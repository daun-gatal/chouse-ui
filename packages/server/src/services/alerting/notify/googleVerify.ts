/**
 * Google Chat request verification (ADR 0026 §3). A Chat app's HTTP endpoint
 * gets a Google-signed bearer token with every event. Two shapes exist,
 * depending on the app's "Authentication audience" setting:
 *
 * - project number: issuer `chat@system.gserviceaccount.com`, audience = the
 *   Cloud project number, signed with that account's keys;
 * - endpoint URL: a Google ID token (issuer accounts.google.com) whose email is
 *   `chat@system.gserviceaccount.com`, audience = the endpoint URL.
 */

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

import { platformHost } from "./hosts";

export const CHAT_SYSTEM_ACCOUNT = "chat@system.gserviceaccount.com";

let chatKeys: JWTVerifyGetKey | null = null;
let idTokenKeys: JWTVerifyGetKey | null = null;

function keys(): { chat: JWTVerifyGetKey; idToken: JWTVerifyGetKey } {
  chatKeys ??= createRemoteJWKSet(new URL(`${platformHost("googleCerts")}/service_accounts/v1/jwk/${CHAT_SYSTEM_ACCOUNT}`));
  idTokenKeys ??= createRemoteJWKSet(new URL(`${platformHost("googleCerts")}/oauth2/v3/certs`));
  return { chat: chatKeys, idToken: idTokenKeys };
}

/** For tests that change the hosts between cases. */
export function resetGoogleKeys(): void {
  chatKeys = null;
  idTokenKeys = null;
}

/** The audience a token was valid for, or null when it is not a Google Chat token for any of them. */
export async function verifyGoogleChatToken(token: string, audiences: string[]): Promise<string | null> {
  const { chat, idToken } = keys();
  for (const audience of [...new Set(audiences)]) {
    try {
      await jwtVerify(token, chat, { issuer: CHAT_SYSTEM_ACCOUNT, audience });
      return audience;
    } catch {
      // Not this shape or audience; try the next.
    }
    try {
      const { payload } = await jwtVerify(token, idToken, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience });
      if (payload.email === CHAT_SYSTEM_ACCOUNT && payload.email_verified === true) return audience;
    } catch {
      // Not this shape or audience.
    }
  }
  return null;
}
