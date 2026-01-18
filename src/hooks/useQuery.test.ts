/**
 * Tests for useQuery hooks
 */

import { describe, it, expect } from 'vitest';
import { queryKeys, useConfig, useDatabases, useTableDetails, useSystemStats, useIntellisense } from './useQuery';

describe('useQuery', () => {
  describe('queryKeys', () => {
    it('should define databases key', () => {
      expect(queryKeys.databases).toBeDefined();
      expect(Array.isArray(queryKeys.databases)).toBe(true);
    });

    it('should define systemStats key', () => {
      expect(queryKeys.systemStats).toBeDefined();
      expect(Array.isArray(queryKeys.systemStats)).toBe(true);
    });

    it('should define intellisense key', () => {
      expect(queryKeys.intellisense).toBeDefined();
      expect(Array.isArray(queryKeys.intellisense)).toBe(true);
    });

    it('should define config key', () => {
      expect(queryKeys.config).toBeDefined();
      expect(Array.isArray(queryKeys.config)).toBe(true);
    });

    it('should define savedQueries as function', () => {
      expect(queryKeys.savedQueries).toBeDefined();
      expect(typeof queryKeys.savedQueries).toBe('function');
    });

    it('should define tableDetails as function', () => {
      expect(queryKeys.tableDetails).toBeDefined();
      expect(typeof queryKeys.tableDetails).toBe('function');
    });

    it('should define tableSample as function', () => {
      expect(queryKeys.tableSample).toBeDefined();
      expect(typeof queryKeys.tableSample).toBe('function');
    });
  });

  describe('hook exports', () => {
    it('should export useConfig', () => {
      expect(useConfig).toBeDefined();
      expect(typeof useConfig).toBe('function');
    });

    it('should export useDatabases', () => {
      expect(useDatabases).toBeDefined();
      expect(typeof useDatabases).toBe('function');
    });

    it('should export useTableDetails', () => {
      expect(useTableDetails).toBeDefined();
      expect(typeof useTableDetails).toBe('function');
    });

    it('should export useSystemStats', () => {
      expect(useSystemStats).toBeDefined();
      expect(typeof useSystemStats).toBe('function');
    });

    it('should export useIntellisense', () => {
      expect(useIntellisense).toBeDefined();
      expect(typeof useIntellisense).toBe('function');
    });
  });
});
