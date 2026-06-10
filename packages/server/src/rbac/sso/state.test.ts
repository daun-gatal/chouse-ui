import { describe, it, expect } from 'bun:test';
import { signStatePayload, verifyStatePayload, SSO_STATE_COOKIE } from './state';

describe('SSO state cookie payload', () => {
  const payload = { provider: 'okta', state: 'st1', nonce: 'n1', codeVerifier: 'cv1', redirect: '/fleet' };

  it('round-trips a signed payload', async () => {
    const jwt = await signStatePayload(payload);
    expect(typeof jwt).toBe('string');
    const back = await verifyStatePayload(jwt);
    expect(back).toMatchObject(payload);
  });

  it('rejects tampered tokens', async () => {
    const jwt = await signStatePayload(payload);
    await expect(verifyStatePayload(jwt.slice(0, -2) + 'xx')).rejects.toThrow();
  });

  it('rejects structurally valid JWTs missing required fields', async () => {
    // sign a JWT with the same secret but wrong shape using jose directly
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'dev-jwt-secret-min-32-chars-do-not-use-in-production');
    const bad = await new SignJWT({ provider: 'okta' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('10m').sign(secret);
    await expect(verifyStatePayload(bad)).rejects.toThrow(/Malformed/);
  });

  it('exports a cookie name', () => {
    expect(SSO_STATE_COOKIE).toBe('chouse_sso_state');
  });
});
