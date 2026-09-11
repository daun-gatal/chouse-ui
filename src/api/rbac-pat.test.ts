/**
 * Tests for RBAC API — rbacPatApi (ADR 0011)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { rbacPatApi } from './rbac';
import type { PatToken } from './rbac';
import { server } from '../test/mocks/server';
import { http, HttpResponse } from 'msw';

// MSW lifecycle (beforeAll/afterAll) is provided by src/test/setup.ts.
afterEach(() => server.resetHandlers());

const MOCK_TOKEN: PatToken = {
  id: 'pat-1',
  name: 'ci-runner',
  keyPrefix: 'abcd1234',
  scopes: ['table:select'],
  expiresAt: null,
  lastUsedAt: null,
  createdAt: '2026-09-11T00:00:00.000Z',
  revokedAt: null,
};

describe('rbacPatApi.list', () => {
  it('returns token metadata from a 200 response', async () => {
    server.use(
      http.get('/api/rbac/pats', () => {
        return HttpResponse.json({ success: true, data: { tokens: [MOCK_TOKEN] } });
      })
    );

    const tokens = await rbacPatApi.list();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toEqual(MOCK_TOKEN);
    expect(tokens[0]).not.toHaveProperty('rawToken');
    expect(tokens[0]).not.toHaveProperty('keyHash');
  });

  it('returns an empty array when the user has no tokens', async () => {
    server.use(
      http.get('/api/rbac/pats', () => {
        return HttpResponse.json({ success: true, data: { tokens: [] } });
      })
    );

    await expect(rbacPatApi.list()).resolves.toEqual([]);
  });
});

describe('rbacPatApi.create', () => {
  it('POSTs the input and returns metadata plus the one-time secret', async () => {
    let seenBody: unknown;
    server.use(
      http.post('/api/rbac/pats', async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json(
          { success: true, data: { token: MOCK_TOKEN, rawToken: 'ch_pat_secret' } },
          { status: 201 }
        );
      })
    );

    const created = await rbacPatApi.create({ name: 'ci-runner', scopes: ['table:select'] });
    expect(created.rawToken).toBe('ch_pat_secret');
    expect(created.token).toEqual(MOCK_TOKEN);
    expect(seenBody).toMatchObject({ name: 'ci-runner', scopes: ['table:select'] });
  });

  it('throws with the server message when scopes exceed permissions', async () => {
    server.use(
      http.post('/api/rbac/pats', () => {
        return HttpResponse.json(
          { success: false, error: { message: 'Token scopes exceed your permissions' } },
          { status: 403 }
        );
      })
    );

    await expect(rbacPatApi.create({ name: 'x', scopes: ['users:delete'] })).rejects.toThrow(
      'Token scopes exceed your permissions'
    );
  });
});

describe('rbacPatApi.rotate', () => {
  it('POSTs to the rotate endpoint and returns the replacement plus secret', async () => {
    const replacement: PatToken = { ...MOCK_TOKEN, id: 'pat-2', keyPrefix: 'efgh5678' };
    server.use(
      http.post('/api/rbac/pats/pat-1/rotate', () => {
        return HttpResponse.json(
          { success: true, data: { token: replacement, rawToken: 'ch_pat_new' } },
          { status: 201 }
        );
      })
    );

    const created = await rbacPatApi.rotate('pat-1');
    expect(created.rawToken).toBe('ch_pat_new');
    expect(created.token.id).toBe('pat-2');
    expect(created.token.name).toBe(MOCK_TOKEN.name);
  });

  it('throws a not-found error for unknown ids', async () => {
    server.use(
      http.post('/api/rbac/pats/missing/rotate', () => {
        return HttpResponse.json(
          { success: false, error: { message: 'Token not found' } },
          { status: 404 }
        );
      })
    );

    await expect(rbacPatApi.rotate('missing')).rejects.toThrow('Token not found');
  });
});

describe('rbacPatApi.revoke', () => {
  it('DELETEs the token and returns the revoked record', async () => {
    const revoked = { ...MOCK_TOKEN, revokedAt: '2026-09-11T01:00:00.000Z' };
    server.use(
      http.delete('/api/rbac/pats/pat-1', () => {
        return HttpResponse.json({ success: true, data: { token: revoked } });
      })
    );

    const result = await rbacPatApi.revoke('pat-1');
    expect(result.revokedAt).not.toBeNull();
  });

  it('throws a not-found error for unknown ids', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    server.use(
      http.delete('/api/rbac/pats/missing', () => {
        return HttpResponse.json(
          { success: false, error: { message: 'Token not found' } },
          { status: 404 }
        );
      })
    );

    await expect(rbacPatApi.revoke('missing')).rejects.toThrow('Token not found');
    consoleSpy.mockRestore();
  });
});
