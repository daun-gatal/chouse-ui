/**
 * useQueryLogs: the statement log comes from the server, already scoped, and
 * each row's CHouse account is the one the server read from its query id.
 */

import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';

import { server } from '@/test/mocks/server';
import { useQueryLogs } from './useQuery';

const row = (over: Record<string, unknown>): Record<string, unknown> => ({
  type: 'QueryFinish', event_date: '2026-11-14', event_time: '10:00:00', event_timestamp: 1_800_000_000,
  query_id: 'q', query: 'SELECT 1', query_duration_ms: 3, read_rows: 1, read_bytes: 1, memory_usage: 0,
  user: 'default', exception: '', rbac_user_id: null, ...over,
});

function wrapper({ children }: { children: ReactNode }): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function serve(rows: Array<Record<string, unknown>>, seen: { body?: unknown; typed: number }): void {
  server.use(
    http.post('/api/metrics/query-logs', async ({ request }) => {
      seen.body = await request.json();
      return HttpResponse.json({ success: true, data: rows });
    }),
    // The page must no longer send its own SELECT on system.query_log.
    http.post('/api/query/execute', () => {
      seen.typed += 1;
      return HttpResponse.json({ success: false, error: { code: 'TABLE_DENIED', message: 'refused' } }, { status: 403 });
    }),
    http.get('/api/rbac/audit', () => HttpResponse.json({ success: true, data: { logs: [], total: 0 } })),
    http.get('/api/rbac/connections', () => HttpResponse.json({ success: true, data: { connections: [], total: 0 } })),
    http.get('/api/rbac/connections/my', () => HttpResponse.json({ success: true, data: [] })),
    http.get('/api/rbac/users/:id', ({ params }) =>
      HttpResponse.json({ success: true, data: { user: { id: params.id, username: `name-${String(params.id)}`, email: `${String(params.id)}@test.local`, displayName: null } } })),
  );
}

describe('useQueryLogs', () => {
  it('asks the server for the window and sort, and sends no statement of its own', async () => {
    const seen: { body?: unknown; typed: number } = { typed: 0 };
    serve([row({ query_id: 'chouse:p:u1:n', rbac_user_id: 'u1' })], seen);

    const { result } = renderHook(() => useQueryLogs(50, undefined, undefined, 6, 'query_duration_ms', 'asc'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(seen.body).toEqual({ limit: 50, hoursBack: 6, sortBy: 'query_duration_ms', sortDir: 'asc' });
    expect(seen.typed).toBe(0);
    expect(result.current.data).toHaveLength(1);
  });

  it('names the account the server resolved for each row', async () => {
    const seen: { body?: unknown; typed: number } = { typed: 0 };
    serve([row({ query_id: 'chouse:p:u1:n', rbac_user_id: 'u1' }), row({ query_id: 'other', rbac_user_id: null })], seen);

    const { result } = renderHook(() => useQueryLogs(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0]).toMatchObject({ rbacUserId: 'u1', rbacUser: 'name-u1' });
    expect(result.current.data?.[1].rbacUserId ?? null).toBeNull();
  });

  it('passes an absolute range, and falls back to the default sort for an unknown column', async () => {
    const seen: { body?: unknown; typed: number } = { typed: 0 };
    serve([], seen);

    const range = { start: '2026-11-14 00:00:00', end: '2026-11-14 12:00:00' };
    const { result } = renderHook(() => useQueryLogs(10, undefined, undefined, 24, 'not_a_column', 'desc', range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(seen.body).toEqual({ limit: 10, hoursBack: 24, sortBy: 'event_time', sortDir: 'desc', range });
  });

  it('keeps only the caller\'s rows when an account filter is given', async () => {
    const seen: { body?: unknown; typed: number } = { typed: 0 };
    serve([row({ query_id: 'chouse:p:u1:n', rbac_user_id: 'u1' }), row({ query_id: 'chouse:p:u2:n', rbac_user_id: 'u2' })], seen);

    const { result } = renderHook(() => useQueryLogs(100, undefined, 'u1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.map((r) => r.rbacUserId)).toEqual(['u1']);
  });

  it('reports the server\'s refusal', async () => {
    server.use(http.post('/api/metrics/query-logs', () =>
      HttpResponse.json({ success: false, error: { code: 'FORBIDDEN', message: "Permission 'query:history:view' is required to read the query log" } }, { status: 403 })));

    const { result } = renderHook(() => useQueryLogs(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toContain('query:history:view');
  });
});
