/**
 * Tests for RBAC API — ssoApi
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ssoApi } from './rbac';
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
  it('POSTs code+state, stores tokens, and returns response data', async () => {
    server.use(
      http.post('/api/rbac/auth/sso/okta/callback', async ({ request }) => {
        const body = await request.json() as { code: string; state: string };
        expect(body.code).toBe('code1');
        expect(body.state).toBe('state1');
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

    const result = await ssoApi.completeCallback('okta', 'code1', 'state1');

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
      http.post('/api/rbac/auth/sso/okta/callback', () => {
        return HttpResponse.json(
          { success: false, error: { message: 'Invalid SSO state', code: 'SSO_STATE_MISMATCH' } },
          { status: 401 }
        );
      })
    );

    await expect(ssoApi.completeCallback('okta', 'bad-code', 'bad-state')).rejects.toMatchObject({
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
      http.post('/api/rbac/auth/sso/okta/callback', ({ request }) => {
        capturedHeaders = request.headers;
        return HttpResponse.json({
          success: true,
          data: { user: MOCK_USER, tokens: MOCK_TOKENS, redirect: '/' },
        });
      })
    );

    await ssoApi.completeCallback('okta', 'c', 's');

    expect(capturedHeaders!.get('x-requested-with')).toBe('XMLHttpRequest');
  });
});
