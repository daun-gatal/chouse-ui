/**
 * Tests for RBAC API — ssoApi
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { ssoApi, rbacDataAccessPoliciesApi, rbacUsersApi } from './rbac';
import { RBAC_ACCESS_TOKEN_KEY, RBAC_REFRESH_TOKEN_KEY } from './client';
import { server } from '../test/mocks/server';
import { http, HttpResponse } from 'msw';

// MSW lifecycle (beforeAll/afterAll) is provided by src/test/setup.ts.
// Reset handlers after each test so provider overrides don't bleed.
afterEach(() => server.resetHandlers());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_TOKENS = {
  accessToken: 'sso-access-token',
  refreshToken: 'sso-refresh-token',
  expiresIn: 3600,
  tokenType: 'Bearer' as const,
};

const MOCK_USER = {
  id: 'user-sso-1',
  email: 'sso@example.com',
  username: 'ssouser',
  displayName: 'SSO User',
  avatarUrl: null,
  isActive: true,
  roles: ['viewer'],
  permissions: ['DB_VIEW'],
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// ssoApi.getProviders
// ---------------------------------------------------------------------------

describe('ssoApi.getProviders', () => {
  it('returns the provider list from a 200 response', async () => {
    server.use(
      http.get('/api/rbac/auth/sso/providers', () => {
        return HttpResponse.json({
          success: true,
          data: {
            providers: [
              { id: 'okta', displayName: 'Okta' },
              { id: 'google', displayName: 'Google Workspace' },
            ],
          },
        });
      })
    );

    const providers = await ssoApi.getProviders();

    expect(providers).toHaveLength(2);
    expect(providers[0]).toEqual({ id: 'okta', displayName: 'Okta' });
    expect(providers[1]).toEqual({ id: 'google', displayName: 'Google Workspace' });
  });

  it('returns an empty array when SSO is disabled', async () => {
    server.use(
      http.get('/api/rbac/auth/sso/providers', () => {
        return HttpResponse.json({
          success: true,
          data: { providers: [] },
        });
      })
    );

    const providers = await ssoApi.getProviders();
    expect(providers).toEqual([]);
  });

  it('throws ApiError with the server message on non-OK response', async () => {
    server.use(
      http.get('/api/rbac/auth/sso/providers', () => {
        return HttpResponse.json(
          { success: false, error: { message: 'SSO not configured', code: 'SSO_DISABLED' } },
          { status: 503 }
        );
      })
    );

    await expect(ssoApi.getProviders()).rejects.toMatchObject({
      name: 'ApiError',
      message: 'SSO not configured',
      statusCode: 503,
    });
  });
});

// ---------------------------------------------------------------------------
// ssoApi.startUrl
// ---------------------------------------------------------------------------

describe('ssoApi.startUrl', () => {
  it('builds the correct URL for a provider with a simple redirect path', () => {
    const url = ssoApi.startUrl('okta', '/dashboard');
    expect(url).toBe('/api/rbac/auth/sso/okta/start?redirect=%2Fdashboard');
  });

  it('encodes the redirect path including query params', () => {
    const url = ssoApi.startUrl('okta', '/fleet?x=1');
    expect(url).toBe('/api/rbac/auth/sso/okta/start?redirect=%2Ffleet%3Fx%3D1');
  });

  it('encodes a provider id that contains special characters', () => {
    const url = ssoApi.startUrl('my/provider', '/home');
    expect(url).toBe('/api/rbac/auth/sso/my%2Fprovider/start?redirect=%2Fhome');
  });
});

// ---------------------------------------------------------------------------
// ssoApi.completeCallback
// ---------------------------------------------------------------------------

describe('ssoApi.completeCallback', () => {
  it('POSTs the raw callback query string as { params }, stores tokens, and returns response data', async () => {
    let capturedBody: unknown = null;

    server.use(
      http.post('/api/rbac/auth/sso/callback', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          success: true,
          data: {
            user: MOCK_USER,
            tokens: MOCK_TOKENS,
            redirect: '/dashboard',
          },
        });
      })
    );

    const result = await ssoApi.completeCallback('code=code1&state=state1');

    // The ENTIRE query string is forwarded verbatim under a single key —
    // the server re-parses it to rebuild the authorization response.
    expect(capturedBody).toEqual({ params: 'code=code1&state=state1' });

    // Returns the data object
    expect(result.user).toEqual(MOCK_USER);
    expect(result.tokens).toEqual(MOCK_TOKENS);
    expect(result.redirect).toBe('/dashboard');

    // Tokens are stored in localStorage using the same keys as login
    expect(localStorage.getItem(RBAC_ACCESS_TOKEN_KEY)).toBe('sso-access-token');
    expect(localStorage.getItem(RBAC_REFRESH_TOKEN_KEY)).toBe('sso-refresh-token');
  });

  it('throws ApiError with the server message on 401', async () => {
    server.use(
      http.post('/api/rbac/auth/sso/callback', () => {
        return HttpResponse.json(
          { success: false, error: { message: 'Invalid SSO state', code: 'SSO_STATE_MISMATCH' } },
          { status: 401 }
        );
      })
    );

    await expect(ssoApi.completeCallback('code=bad-code&state=bad-state')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Invalid SSO state',
      statusCode: 401,
    });

    // Tokens must NOT be stored on failure
    expect(localStorage.getItem(RBAC_ACCESS_TOKEN_KEY)).toBeNull();
  });

  it('uses the X-Requested-With header', async () => {
    let capturedHeaders: Headers | null = null;

    server.use(
      http.post('/api/rbac/auth/sso/callback', ({ request }) => {
        capturedHeaders = request.headers;
        return HttpResponse.json({
          success: true,
          data: { user: MOCK_USER, tokens: MOCK_TOKENS, redirect: '/' },
        });
      })
    );

    await ssoApi.completeCallback('code=c&state=s');

    expect(capturedHeaders!.get('x-requested-with')).toBe('XMLHttpRequest');
  });
});

// ---------------------------------------------------------------------------
// rbacDataAccessPoliciesApi
// ---------------------------------------------------------------------------

describe('rbacDataAccessPoliciesApi', () => {
  const POLICY = {
    id: 'p1',
    name: 'Analytics RO',
    description: null,
    isSystem: false,
    rules: [{ id: 'r1', policyId: 'p1', connectionId: null, databasePattern: 'analytics', tablePattern: '*', isAllowed: true, priority: 0, description: null }],
    roleIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdBy: null,
  };

  beforeEach(() => {
    localStorage.setItem(RBAC_ACCESS_TOKEN_KEY, 'access-token');
  });

  it('lists policies (unwraps data)', async () => {
    server.use(
      http.get('/api/rbac/data-access-policies', () =>
        HttpResponse.json({ success: true, data: [POLICY] })
      )
    );
    const policies = await rbacDataAccessPoliciesApi.list();
    expect(policies).toHaveLength(1);
    expect(policies[0].name).toBe('Analytics RO');
  });

  it('creates a policy with the given body', async () => {
    let captured: unknown = null;
    server.use(
      http.post('/api/rbac/data-access-policies', async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ success: true, data: POLICY }, { status: 201 });
      })
    );
    await rbacDataAccessPoliciesApi.create({
      name: 'Analytics RO',
      allConnections: true,
      rules: [{ databasePattern: 'analytics', tablePattern: '*', isAllowed: true, priority: 0 }],
    });
    expect(captured).toMatchObject({ name: 'Analytics RO', allConnections: true });
  });

  it('replaces the policies attached to a role', async () => {
    let captured: unknown = null;
    server.use(
      http.post('/api/rbac/data-access-policies/role/role-1', async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json({ success: true, data: [POLICY] });
      })
    );
    await rbacDataAccessPoliciesApi.setForRole('role-1', ['p1']);
    expect(captured).toEqual({ policyIds: ['p1'] });
  });

  it('browses databases for a connection', async () => {
    server.use(
      http.get('/api/rbac/data-access-policies/schema/conn-1/databases', () =>
        HttpResponse.json({ success: true, data: ['default', 'analytics'] })
      )
    );
    expect(await rbacDataAccessPoliciesApi.listDatabases('conn-1')).toEqual(['default', 'analytics']);
  });

  it('browses tables for a database (lazy, url-encoded)', async () => {
    let capturedUrl = '';
    server.use(
      http.get('/api/rbac/data-access-policies/schema/conn-1/tables', ({ request }) => {
        capturedUrl = new URL(request.url).search;
        return HttpResponse.json({ success: true, data: ['events', 'users'] });
      })
    );
    const tables = await rbacDataAccessPoliciesApi.listTables('conn-1', 'my db');
    expect(tables).toEqual(['events', 'users']);
    expect(capturedUrl).toContain('database=my%20db');
  });
});

// ---------------------------------------------------------------------------
// rbacUsersApi.getIdentities
// ---------------------------------------------------------------------------

describe('rbacUsersApi.getIdentities', () => {
  it('returns the identity list unwrapped from the data envelope', async () => {
    const identity = {
      id: 'idn-1',
      provider: 'google',
      displayName: 'Google',
      email: 'user@example.com',
      createdAt: '2026-06-10T00:00:00.000Z',
      lastLoginAt: '2026-06-12T00:00:00.000Z',
    };

    server.use(
      http.get('/api/rbac/users/user-1/identities', () => {
        return HttpResponse.json({ success: true, data: { identities: [identity] } });
      })
    );

    const identities = await rbacUsersApi.getIdentities('user-1');
    expect(identities).toEqual([identity]);
  });

  it('returns an empty array when the user has no linked identities', async () => {
    server.use(
      http.get('/api/rbac/users/user-2/identities', () => {
        return HttpResponse.json({ success: true, data: { identities: [] } });
      })
    );

    expect(await rbacUsersApi.getIdentities('user-2')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// rbacUsersApi.unlinkIdentity
// ---------------------------------------------------------------------------

describe('rbacUsersApi.unlinkIdentity', () => {
  it('issues a DELETE to the identity endpoint', async () => {
    let capturedMethod: string | null = null;

    server.use(
      http.delete('/api/rbac/users/user-1/identities/idn-1', ({ request }) => {
        capturedMethod = request.method;
        return HttpResponse.json({ success: true, data: { message: 'SSO identity unlinked successfully' } });
      })
    );

    await rbacUsersApi.unlinkIdentity('user-1', 'idn-1');
    expect(capturedMethod).toBe('DELETE');
  });

  it('throws ApiError with the server message when the identity is not found', async () => {
    server.use(
      http.delete('/api/rbac/users/user-1/identities/missing', () => {
        return HttpResponse.json(
          { success: false, error: { message: 'SSO identity not found for this user', code: 'NOT_FOUND' } },
          { status: 404 }
        );
      })
    );

    await expect(rbacUsersApi.unlinkIdentity('user-1', 'missing')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'SSO identity not found for this user',
      statusCode: 404,
    });
  });
});
