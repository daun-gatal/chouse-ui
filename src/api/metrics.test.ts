/**
 * Tests for Metrics API
 */

import { describe, it, expect } from 'vitest';
import {
    getSystemStats,
    getRecentQueries,
    getDiskMetrics,
    getTopTables,
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

        it('should filter by username', async () => {
            const queries = await getRecentQueries(10, 'testuser');

            expect(queries).toBeDefined();
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
});
