/**
 * Shared stores for the SAML flow (ADR 0010):
 *  - one-time token-handoff codes (ACS → SPA exchange)
 *  - assertion-ID replay cache
 *
 * These were process-local Maps, which broke two ways behind more than one
 * replica: the ACS POST and the SPA's code exchange are separate requests that
 * can land on different pods (login fails), and — more seriously — per-pod
 * replay protection is not replay protection at all, because the same assertion
 * replays cleanly against a pod that has not seen it.
 *
 * Both now live in the RBAC database. The claim and the replay check are single
 * atomic statements (`DELETE ... RETURNING`, `INSERT ... ON CONFLICT DO NOTHING
 * ... RETURNING`) so two pods racing on the same code or assertion cannot both
 * win, on either dialect.
 */
import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import type { UserResponse } from '../../schema';
import type { TokenPair } from '../../services/jwt';
import { rawAll, rawRun, toNumber } from '../../db/raw';
// AES-256-GCM helpers — generic string encryption despite the password-oriented
// names. The handoff payload carries freshly minted tokens, so it is encrypted
// at rest for the ≤60s it exists rather than sitting in the table as plaintext.
import { encryptPassword, decryptPassword } from '../../services/connections';

export interface HandoffPayload {
  user: UserResponse;
  tokens: TokenPair;
  redirect: string;
}

/**
 * Drop everything already expired. Runs before each write so the tables stay
 * bounded without a separate sweeper, and so an expired assertion id becomes
 * reusable at exactly the moment the in-memory implementation freed it.
 */
async function sweep(now: number): Promise<void> {
  await rawRun(sql`DELETE FROM rbac_saml_handoff_codes WHERE expires_at <= ${now}`);
  await rawRun(sql`DELETE FROM rbac_saml_assertions_seen WHERE expires_at <= ${now}`);
}

export async function stashTokens(
  payload: HandoffPayload,
  ttlMs: number,
  nowDate: Date = new Date()
): Promise<string> {
  const now = nowDate.getTime();
  await sweep(now);
  const code = randomUUID();
  const encrypted = encryptPassword(JSON.stringify(payload));
  await rawRun(sql`
    INSERT INTO rbac_saml_handoff_codes (code, payload, expires_at)
    VALUES (${code}, ${encrypted}, ${now + ttlMs})
  `);
  return code;
}

/**
 * Trade a code for its payload. Single-use regardless of expiry: the row is
 * deleted by the same statement that reads it, so a replayed code finds nothing
 * even if it is still inside its TTL.
 */
export async function claimTokens(
  code: string,
  nowDate: Date = new Date()
): Promise<HandoffPayload | null> {
  const now = nowDate.getTime();
  const rows = await rawAll(sql`
    DELETE FROM rbac_saml_handoff_codes WHERE code = ${code}
    RETURNING payload, expires_at
  `);
  const hit = rows[0];
  if (!hit) return null;
  if (toNumber(hit.expires_at) <= now) return null;
  try {
    return JSON.parse(decryptPassword(String(hit.payload))) as HandoffPayload;
  } catch {
    // Undecryptable or malformed payload (e.g. the encryption key rotated
    // between the ACS POST and the exchange). Fail closed — the row is already
    // consumed, so the user simply signs in again.
    return null;
  }
}

/** True if the assertion id is fresh (and records it); false if already seen (replay). */
export async function markAssertionSeen(
  id: string,
  notOnOrAfter: Date,
  nowDate: Date = new Date()
): Promise<boolean> {
  const now = nowDate.getTime();
  await sweep(now);
  // One atomic statement: the INSERT either lands (fresh — a row comes back) or
  // conflicts with a live row (replay — no rows). Two pods presenting the same
  // assertion concurrently cannot both receive a row.
  const rows = await rawAll(sql`
    INSERT INTO rbac_saml_assertions_seen (assertion_id, expires_at)
    VALUES (${id}, ${notOnOrAfter.getTime()})
    ON CONFLICT (assertion_id) DO NOTHING
    RETURNING assertion_id
  `);
  return rows.length > 0;
}

/** Test-only: clear the handoff-code and replay tables. */
export async function resetHandoffState(): Promise<void> {
  await rawRun(sql`DELETE FROM rbac_saml_handoff_codes`);
  await rawRun(sql`DELETE FROM rbac_saml_assertions_seen`);
}
