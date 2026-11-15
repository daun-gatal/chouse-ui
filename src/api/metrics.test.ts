/**
 * Tests for Metrics API
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/mocks/server';
import {
    getSystemStats,
    getRecentQueries,
    getQueryLogs,
    getDiskMetrics,
    getTopTables,
    getPartsPressure,
    simulateDdl,
} from './metrics';

describe('Metrics API', () => {
    describe('getSystemStats', () => {
        it('should fetch system statistics', async () => {
            const stats = await getSystemStats();

            expect(stats).toBeDefined();
            expect(stats.version).toBeDefined();
            expect(stats.uptime).toBeGreaterThanOrEqual(0);
        });

        it('should include database and table counts', async () => {
            const stats = await getSystemStats();

            expect(stats.databaseCount).toBeGreaterThanOrEqual(0);
            expect(stats.tableCount).toBeGreaterThanOrEqual(0);
        });
    });

    describe('getRecentQueries', () => {
        it('should fetch recent queries', async () => {
            const queries = await getRecentQueries(10);

            expect(queries).toBeDefined();
            expect(Array.isArray(queries)).toBe(true);
        });

        it('passes username through as a narrowing filter', async () => {
            const queries = await getRecentQueries(10, 'testuser');

            expect(queries).toBeDefined();
        });
    });

    describe('getQueryLogs', () => {
        it('posts the window and sort to the server and returns its rows', async () => {
            let body: unknown = null;
            server.use(
                http.post('/api/metrics/query-logs', async ({ request }) => {
                    body = await request.json();
                    return HttpResponse.json({
                        success: true,
                        data: [{ type: 'QueryFinish', event_date: '2026-11-14', event_time: '10:00:00', event_timestamp: 1, query_id: 'chouse:p:u1:n', query: 'SELECT 1', query_duration_ms: 3, read_rows: 1, read_bytes: 1, memory_usage: 0, user: 'default', exception: '', rbac_user_id: 'u1' }],
                    });
                }),
            );

            const rows = await getQueryLogs({ limit: 50, hoursBack: 6, sortBy: 'event_time', sortDir: 'desc', range: { start: '2026-11-14 00:00:00', end: '2026-11-14 12:00:00' } });

            expect(body).toEqual({ limit: 50, hoursBack: 6, sortBy: 'event_time', sortDir: 'desc', range: { start: '2026-11-14 00:00:00', end: '2026-11-14 12:00:00' } });
            expect(rows).toHaveLength(1);
            expect(rows[0].rbac_user_id).toBe('u1');
        });

        it('surfaces a refusal from the server', async () => {
            server.use(
                http.post('/api/metrics/query-logs', () =>
                    HttpResponse.json({ success: false, error: { code: 'FORBIDDEN', message: "Permission 'query:history:view' is required to read the query log" } }, { status: 403 })),
            );

            await expect(getQueryLogs({ limit: 10, hoursBack: 24, sortBy: 'event_time', sortDir: 'desc' })).rejects.toThrow('query:history:view');
        });
    });

    describe('getDiskMetrics', () => {
        it('should fetch disk metrics', async () => {
            const disks = await getDiskMetrics();

            expect(disks).toBeDefined();
            expect(Array.isArray(disks)).toBe(true);
        });
    });

    describe('getTopTables', () => {
        it('should fetch top tables by size (non-system)', async () => {
            const tables = await getTopTables(5);

            expect(tables).toBeDefined();
            expect(Array.isArray(tables)).toBe(true);
            expect(tables.length).toBeGreaterThan(0);
            expect(tables.length).toBeLessThanOrEqual(5);
            const first = tables[0];
            expect(first).toHaveProperty('database');
            expect(first).toHaveProperty('table');
            expect(first).toHaveProperty('rows');
            expect(first).toHaveProperty('bytes_on_disk');
            expect(first).toHaveProperty('compressed_size');
            expect(first).toHaveProperty('parts_count');
        });

        it('should respect limit parameter', async () => {
            const tables = await getTopTables(3);
            expect(tables.length).toBeLessThanOrEqual(3);
        });
    });

    describe('getPartsPressure', () => {
        it('should fetch per-table parts pressure rows', async () => {
            const rows = await getPartsPressure(10);

            expect(Array.isArray(rows)).toBe(true);
            expect(rows.length).toBeGreaterThan(0);
            const first = rows[0];
            expect(first).toHaveProperty('database');
            expect(first).toHaveProperty('table');
            expect(first).toHaveProperty('max_parts_in_partition');
            expect(first).toHaveProperty('parts_threshold');
            expect(first).toHaveProperty('net_parts_per_min');
            expect(first).toHaveProperty('eta_minutes');
        });

        it('should preserve a negative eta for converging tables', async () => {
            const rows = await getPartsPressure();
            const converging = rows.find((r) => r.table === 'calm');

            expect(converging).toBeDefined();
            expect(converging?.eta_minutes).toBe(-1);
            expect(converging?.net_parts_per_min).toBeLessThan(0);
        });
    });

    describe('simulateDdl', () => {
        it('returns an impact estimate for a valid ALTER mutation', async () => {
            const est = await simulateDdl("ALTER TABLE demo.events UPDATE col = 1 WHERE id < 5");

            expect(est.kind).toBe('update');
            expect(est.affected_rows).toBe(159);
            expect(est.parts_to_rewrite).toBe(300);
            expect(est.disk_sufficient).toBe(true);
        });

        it('rejects a non-ALTER statement', async () => {
            await expect(simulateDdl('SELECT 1')).rejects.toThrow();
        });
    });
});
