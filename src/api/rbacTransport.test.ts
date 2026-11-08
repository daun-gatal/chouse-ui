/**
 * The RBAC transport honours VITE_API_URL and sends credentials, like client.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function okFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response(JSON.stringify({ success: true, data: { providers: [], status: 'ok' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('rbac transport', () => {
  it('builds URLs on VITE_API_URL when it is set', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com/api');
    const { apiUrl } = await import('./client');
    const { ssoApi } = await import('./rbac');
    expect(apiUrl('/rbac/health')).toBe('https://api.example.com/api/rbac/health');
    expect(ssoApi.startUrl('okta', '/home')).toBe('https://api.example.com/api/rbac/auth/sso/okta/start?redirect=%2Fhome');
  });

  it('defaults to same-origin /api', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const { apiUrl } = await import('./client');
    expect(apiUrl('/rbac/health')).toBe('/api/rbac/health');
  });

  it('sends rbacFetch and direct calls to the configured base with credentials included', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.com/api');
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const { ssoApi, rbacUsersApi } = await import('./rbac');

    await ssoApi.getProviders();
    await rbacUsersApi.list().catch(() => undefined);

    expect(fetchMock).toHaveBeenCalled();
    for (const [url, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      expect(String(url).startsWith('https://api.example.com/api/rbac/')).toBe(true);
      expect(init.credentials).toBe('include');
    }
  });
});
