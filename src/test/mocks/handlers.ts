/**
 * MSW Request Handlers
 */

import { http, HttpResponse } from 'msw';

const API_BASE = '/api';

export const handlers = [
  // Config
  http.get(`${API_BASE}/config`, () => {
    return HttpResponse.json({
      success: true,
      data: {
        clickhouse: { defaultUrl: 'http://localhost:8123', defaultUser: 'default', presetUrls: ['http://localhost:8123'] },
        app: { name: 'CHouse UI', version: '2.7.5' },
        features: { aiOptimizer: true }
      }
    });
  }),

  // Auth
  http.post(`${API_BASE}/rbac/auth/login`, async ({ request }) => {
    const body = await request.json() as { username: string; password: string };
    if (body.username === 'testuser' && body.password === 'testpass') {
      return HttpResponse.json({
        success: true,
        data: {
          accessToken: 'test-access-token',
          refreshToken: 'test-refresh-token',
          expiresIn: 900,
          user: { id: 'user-123', username: 'testuser', email: 'test@example.com', roles: ['viewer'], permissions: ['DB_VIEW'] }
        }
      });
    }
    return HttpResponse.json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password', category: 'authentication' } }, { status: 401 });
  }),

  // Explorer
  http.get(`${API_BASE}/explorer/databases`, () => {
    return HttpResponse.json({ success: true, data: [{ name: 'default', type: 'database', children: [{ name: 'users', type: 'table' }, { name: 'orders', type: 'view' }] }] });
  }),

  http.get(`${API_BASE}/explorer/table/:database/:table`, () => {
    return HttpResponse.json({
      success: true,
      data: {
        database: 'default', table: 'users', engine: 'MergeTree', total_rows: '1000', total_bytes: '102400',
        columns: [{ name: 'id', type: 'UInt64', default_kind: '', default_expression: '', comment: '' }],
        create_table_query: 'CREATE TABLE default.users ...'
      }
    });
  }),

  http.post(`${API_BASE}/explorer/database`, () => {
    return HttpResponse.json({ success: true, data: { message: 'Database created successfully' } });
  }),

  http.delete(`${API_BASE}/explorer/database/:name`, () => {
    return HttpResponse.json({ success: true, data: { message: 'Database dropped successfully' } });
  }),

  // Saved queries
  http.get(`${API_BASE}/saved-queries`, () => {
    return HttpResponse.json({
      success: true,
      data: [{
        id: 'query-1', userId: 'user-123', connectionId: 'conn-1', connectionName: 'Production',
        name: 'User Stats', query: 'SELECT * FROM users', description: 'Get user statistics',
        isPublic: false, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z'
      }]
    });
  }),

  http.get(`${API_BASE}/saved-queries/connections`, () => {
    return HttpResponse.json({ success: true, data: ['Production', 'Staging'] });
  }),

  http.get(`${API_BASE}/saved-queries/:id`, ({ params }) => {
    return HttpResponse.json({
      success: true,
      data: {
        id: params.id as string, userId: 'user-123', connectionId: 'conn-1', connectionName: 'Production',
        name: 'User Stats', query: 'SELECT * FROM users', description: 'Get user statistics',
        isPublic: false, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z'
      }
    });
  }),

  http.post(`${API_BASE}/saved-queries`, async ({ request }) => {
    const body = await request.json() as any;
    return HttpResponse.json({ success: true, data: { id: 'new-query-id', userId: 'user-123', ...body, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
  }),

  http.put(`${API_BASE}/saved-queries/:id`, async ({ params, request }) => {
    const body = await request.json() as any;
    return HttpResponse.json({ success: true, data: { id: params.id as string, userId: 'user-123', ...body, updatedAt: new Date().toISOString() } });
  }),

  http.delete(`${API_BASE}/saved-queries/:id`, () => {
    return HttpResponse.json({ success: true, data: { message: 'Query deleted successfully' } });
  }),

  // Query
  http.post(`${API_BASE}/query/table/select`, () => {
    return HttpResponse.json({
      success: true,
      data: { meta: [{ name: 'id', type: 'UInt64' }], data: [{ id: 1 }], statistics: { elapsed: 0.001, rows_read: 1, bytes_read: 100 }, rows: 1 }
    });
  }),

  http.post(`${API_BASE}/query/table/insert`, () => {
    return HttpResponse.json({ success: true, data: { meta: [], data: [], statistics: { elapsed: 0.002, rows_read: 0, bytes_read: 0 }, rows: 1 } });
  }),

  http.get(`${API_BASE}/query/intellisense`, () => {
    return HttpResponse.json({ success: true, data: { columns: [], functions: ['count', 'sum'], keywords: ['SELECT', 'FROM'] } });
  }),

  // Metrics
  http.get(`${API_BASE}/metrics/stats`, () => {
    return HttpResponse.json({
      success: true,
      data: {
        version: '23.8.1', uptime: 86400, databaseCount: 5, tableCount: 20, totalRows: '1000000', totalSize: '10GB',
        memoryUsage: '2GB', cpuLoad: 0.5, activeConnections: 10, activeQueries: 2
      }
    });
  }),

  http.get(`${API_BASE}/metrics/recent-queries`, () => {
    return HttpResponse.json({ success: true, data: [{ query: 'SELECT * FROM users', duration: 0.5, status: 'Success', time: '2024-01-01T00:00:00Z' }] });
  }),

  http.get(`${API_BASE}/metrics/disks`, () => {
    return HttpResponse.json({ success: true, data: [{ name: 'default', path: '/var/lib/clickhouse', free_space: 100000000, total_space: 500000000, used_space: 400000000, used_percent: 80 }] });
  }),

  http.get(`${API_BASE}/metrics/top-tables`, ({ request }) => {
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 50);
    const data = Array.from({ length: limit }, (_, i) => ({
      database: 'default',
      table: `table_${i + 1}`,
      rows: 1000 * (i + 1),
      bytes_on_disk: 4096 * (i + 1),
      compressed_size: `${4.1 * (i + 1)} KiB`,
      parts_count: 0,
    }));
    return HttpResponse.json({ success: true, data });
  }),

  // Live Queries
  http.get(`${API_BASE}/live-queries`, () => {
    return HttpResponse.json({
      success: true,
      data: {
        queries: [
          {
            query_id: 'live-query-1',
            user: 'default',
            query: 'SELECT * FROM system.tables',
            elapsed_seconds: 2,
            read_rows: 10,
            read_bytes: 1024,
            memory_usage: 4096,
            is_initial_query: 1,
            client_name: 'client',
          },
        ],
        connectionId: 'conn1',
        total: 1,
      },
    });
  }),

  http.post(`${API_BASE}/live-queries/kill`, async ({ request }) => {
    const body = await request.json() as { queryId?: string };
    const queryId = body?.queryId ?? 'unknown';
    return HttpResponse.json({
      success: true,
      data: {
        message: 'Query killed successfully.',
        queryId,
      },
    });
  }),

  // AI Chat
  http.get(`${API_BASE}/ai-chat/status`, () => {
    return HttpResponse.json({ success: true, data: { enabled: true } });
  }),

  http.get(`${API_BASE}/ai-chat/threads`, ({ request }) => {
    const url = new URL(request.url);
    const connectionId = url.searchParams.get('connectionId');

    let threads = [
      { id: 'thread-1', userId: 'user-123', title: 'Thread 1', connectionId: 'conn-1', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      { id: 'thread-2', userId: 'user-123', title: 'Thread 2', connectionId: 'conn-2', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
    ];

    if (connectionId) {
      threads = threads.filter(t => t.connectionId === connectionId);
    }

    return HttpResponse.json({ success: true, data: threads });
  }),

  http.post(`${API_BASE}/ai-chat/threads`, async ({ request }) => {
    const body = await request.json() as any;
    return HttpResponse.json({
      success: true,
      data: {
        id: 'new-thread-id',
        userId: 'user-123',
        title: body.title || 'New Thread',
        connectionId: body.connectionId || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });
  }),

  http.get(`${API_BASE}/ai-chat/threads/:id`, ({ params }) => {
    return HttpResponse.json({
      success: true,
      data: {
        id: params.id as string, userId: 'user-123', title: 'Thread 1', connectionId: 'conn-1',
        createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z',
        messages: [
          { id: 'msg-1', threadId: params.id as string, role: 'user', content: 'Hello', createdAt: '2024-01-01T00:00:00Z' },
          { id: 'msg-2', threadId: params.id as string, role: 'assistant', content: 'Hi there', createdAt: '2024-01-01T00:00:01Z' }
        ]
      }
    });
  }),

  http.delete(`${API_BASE}/ai-chat/threads/:id`, () => {
    return HttpResponse.json({ success: true, data: { message: 'Thread deleted successfully' } });
  }),

  // Default 404
  http.all('*', ({ request }) => {
    console.warn(`Unhandled: ${request.method} ${request.url}`);
    return HttpResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found', category: 'unknown' } }, { status: 404 });
  }),
];
