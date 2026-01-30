/**
 * Tests for helpers/sqlUtils.ts
 */

import { describe, it, expect } from 'vitest';
import {
  validateIdentifier,
  escapeIdentifier,
  escapeQualifiedIdentifier,
  validateColumnType,
  validateFormat,
  isCreateOrInsert,
} from './sqlUtils';

describe('helpers/sqlUtils', () => {
  describe('validateIdentifier', () => {
    it('should validate valid identifiers', () => {
      expect(validateIdentifier('users')).toBe(true);
      expect(validateIdentifier('my_table')).toBe(true);
      expect(validateIdentifier('_private')).toBe(true);
      expect(validateIdentifier('Table123')).toBe(true);
    });

    it('should reject invalid start characters', () => {
      expect(validateIdentifier('1table')).toBe(false);
      expect(validateIdentifier('-table')).toBe(false);
    });

    it('should reject reserved keywords', () => {
      expect(validateIdentifier('select')).toBe(false);
      expect(validateIdentifier('from')).toBe(false);
    });

    it('should allow default (ClickHouse built-in database name)', () => {
      expect(validateIdentifier('default')).toBe(true);
    });

    it('should handle edge cases', () => {
      expect(validateIdentifier('')).toBe(false);
      expect(validateIdentifier(null as any)).toBe(false);
      expect(validateIdentifier('a'.repeat(65))).toBe(false);
      expect(validateIdentifier('a'.repeat(64))).toBe(true);
    });
  });

  describe('escapeIdentifier', () => {
    it('should escape valid identifiers', () => {
      expect(escapeIdentifier('users')).toBe('`users`');
      expect(escapeIdentifier('my_table')).toBe('`my_table`');
    });

    it('should throw on invalid identifiers', () => {
      expect(() => escapeIdentifier('select')).toThrow();
      expect(() => escapeIdentifier('my-table')).toThrow();
    });
  });

  describe('escapeQualifiedIdentifier', () => {
    it('should escape qualified names', () => {
      expect(escapeQualifiedIdentifier(['mydb', 'users'])).toBe('`mydb`.`users`');
    });

    it('should handle single identifier', () => {
      expect(escapeQualifiedIdentifier(['users'])).toBe('`users`');
    });

    it('should allow default database (ClickHouse built-in)', () => {
      expect(escapeQualifiedIdentifier(['default', 'viz_test_largest_tables'])).toBe('`default`.`viz_test_largest_tables`');
    });

    it('should throw on invalid input', () => {
      expect(() => escapeQualifiedIdentifier([])).toThrow();
    });
  });

  describe('validateColumnType', () => {
    it('should validate basic types', () => {
      expect(validateColumnType('String')).toBe(true);
      expect(validateColumnType('Int32')).toBe(true);
      expect(validateColumnType('Float64')).toBe(true);
    });

    it('should validate parameterized types', () => {
      expect(validateColumnType('Array(String)')).toBe(true);
      expect(validateColumnType('Nullable(Int32)')).toBe(true);
    });

    it('should reject invalid types', () => {
      expect(validateColumnType('InvalidType')).toBe(false);
      expect(validateColumnType('')).toBe(false);
    });
  });

  describe('validateFormat', () => {
    it('should validate common formats', () => {
      expect(validateFormat('JSON')).toBe(true);
      expect(validateFormat('CSV')).toBe(true);
      expect(validateFormat('TSV')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(validateFormat('json')).toBe(true);
      expect(validateFormat('Csv')).toBe(true);
    });

    it('should reject invalid formats', () => {
      expect(validateFormat('INVALID')).toBe(false);
      expect(validateFormat('HTML')).toBe(false);
      expect(validateFormat('')).toBe(false);
    });
  });

  describe('isCreateOrInsert', () => {
    it('should detect CREATE  TABLE', () => {
      expect(isCreateOrInsert('CREATE TABLE users (id Int32)')).toBe(true);
    });

    it('should detect INSERT', () => {
      expect(isCreateOrInsert('INSERT INTO users VALUES (1)')).toBe(true);
    });

    it('should detect ALTER', () => {
      expect(isCreateOrInsert('ALTER TABLE users ADD COLUMN name String')).toBe(true);
    });

    it('should detect DROP', () => {
      expect(isCreateOrInsert('DROP TABLE users')).toBe(true);
      expect(isCreateOrInsert('DROP DATABASE test')).toBe(true);
    });

    it('should detect user/role commands', () => {
      expect(isCreateOrInsert('CREATE USER foo')).toBe(true);
      expect(isCreateOrInsert('GRANT SELECT ON *.*')).toBe(true);
    });

    it('should not match SELECT queries', () => {
      expect(isCreateOrInsert('SELECT * FROM users')).toBe(false);
    });

    it('should detect complex patterns', () => {
      expect(isCreateOrInsert('CREATE MATERIALIZED VIEW mv AS SELECT 1')).toBe(true);
      expect(isCreateOrInsert('TRUNCATE TABLE test')).toBe(true);
    });
  });
});
