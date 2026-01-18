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
        app: { name: 'CHouse UI', version: '2.7.5' }
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

  // Default 404
  http.all('*', ({ request }) => {
    console.warn(`Unhandled: ${request.method} ${request.url}`);
    return HttpResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found', category: 'unknown' } }, { status: 404 });
  }),
];
