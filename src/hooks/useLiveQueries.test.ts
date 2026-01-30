/**
 * Tests for Live Queries hooks
 */

import { describe, it, expect } from 'vitest';
import {
  useLiveQueries,
  useKillQuery,
  useLiveQueriesStats,
  liveQueriesKeys,
} from './useLiveQueries';

describe('useLiveQueries', () => {
  describe('exports', () => {
    it('should export useLiveQueries', () => {
      expect(useLiveQueries).toBeDefined();
      expect(typeof useLiveQueries).toBe('function');
    });

    it('should export useKillQuery', () => {
      expect(useKillQuery).toBeDefined();
      expect(typeof useKillQuery).toBe('function');
    });

    it('should export useLiveQueriesStats', () => {
      expect(useLiveQueriesStats).toBeDefined();
      expect(typeof useLiveQueriesStats).toBe('function');
    });

    it('should export liveQueriesKeys', () => {
      expect(liveQueriesKeys).toBeDefined();
      expect(liveQueriesKeys.all).toEqual(['liveQueries']);
      expect(liveQueriesKeys.list()).toEqual(['liveQueries', 'list']);
    });
  });

  describe('useLiveQueriesStats', () => {
    it('should return zeros when data is undefined', () => {
      const stats = useLiveQueriesStats(undefined);
      expect(stats).toEqual({
        totalQueries: 0,
        longestRunning: 0,
        totalMemory: 0,
        totalReadRows: 0,
      });
    });

    it('should return zeros when queries array is empty', () => {
      const stats = useLiveQueriesStats({ queries: [], total: 0 });
      expect(stats).toEqual({
        totalQueries: 0,
        longestRunning: 0,
        totalMemory: 0,
        totalReadRows: 0,
      });
    });

    it('should compute stats from queries', () => {
      const data = {
        queries: [
          {
            query_id: '1',
            user: 'default',
            query: 'SELECT 1',
            elapsed_seconds: 5,
            read_rows: 100,
            read_bytes: 1024,
            memory_usage: 4096,
            is_initial_query: 1,
            client_name: 'c',
          },
          {
            query_id: '2',
            user: 'default',
            query: 'SELECT 2',
            elapsed_seconds: 10,
            read_rows: 200,
            read_bytes: 2048,
            memory_usage: 8192,
            is_initial_query: 1,
            client_name: 'c',
          },
        ],
        total: 2,
      };
      const stats = useLiveQueriesStats(data);
      expect(stats.totalQueries).toBe(2);
      expect(stats.longestRunning).toBe(10);
      expect(stats.totalMemory).toBe(12288);
      expect(stats.totalReadRows).toBe(300);
    });
  });
});
