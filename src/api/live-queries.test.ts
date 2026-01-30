/**
 * Tests for Live Queries API
 */

import { describe, it, expect } from 'vitest';
import { getLiveQueries, killQuery } from './live-queries';

describe('Live Queries API', () => {
  describe('getLiveQueries', () => {
    it('should fetch running queries from system.processes', async () => {
      const result = await getLiveQueries();

      expect(result).toBeDefined();
      expect(result).toHaveProperty('queries');
      expect(result).toHaveProperty('total');
      expect(Array.isArray(result.queries)).toBe(true);
      expect(result.total).toBeGreaterThanOrEqual(0);
    });

    it('should return queries with expected shape', async () => {
      const result = await getLiveQueries();

      if (result.queries.length > 0) {
        const q = result.queries[0];
        expect(q).toHaveProperty('query_id');
        expect(q).toHaveProperty('user');
        expect(q).toHaveProperty('query');
        expect(q).toHaveProperty('elapsed_seconds');
        expect(q).toHaveProperty('read_rows');
        expect(q).toHaveProperty('read_bytes');
        expect(q).toHaveProperty('memory_usage');
        expect(q).toHaveProperty('is_initial_query');
        expect(q).toHaveProperty('client_name');
      }
    });
  });

  describe('killQuery', () => {
    it('should send kill command and return message and queryId', async () => {
      const result = await killQuery('test-query-id');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('queryId');
      expect(result.queryId).toBe('test-query-id');
      expect(result.message).toContain('killed');
    });
  });
});
