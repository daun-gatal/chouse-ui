/**
 * Tests for lib/utils.ts
 */

import { describe, it, expect } from 'vitest';
import {
  cn,
  formatBytes,
  formatDate,
  formatNumber,
  generateRandomPassword,
  redactSecrets,
} from './utils';

describe('lib/utils', () => {
  describe('cn', () => {
    it('should merge class names', () => {
      expect(cn('foo', 'bar')).toBe('foo bar');
    });

    it('should merge tailwind classes', () => {
      expect(cn('px-2', 'px-4')).toBe('px-4');
    });
  });

  describe('formatBytes', () => {
    it('should format bytes', () => {
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1048576)).toBe('1 MB');
      expect(formatBytes(1073741824)).toBe('1 GB');
    });

    it('should handle decimals', () => {
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('should handle falsy values', () => {
      expect(formatBytes(0)).toBe('');
      expect(formatBytes(null as any)).toBe('');
    });
  });

  describe('formatDate', () => {
    it('should format date', () => {
      const date = new Date('2024-01-15');
      const result = formatDate(date, 'short');
      expect(result).toContain('2024');
    });

    it('should handle invalid date', () => {
      expect(formatDate(null as any, 'short')).toBe('');
    });
  });

  describe('formatNumber', () => {
    it('should format numbers with decimals', () => {
      expect(formatNumber(1234.5)).toBe('1,234.50');
    });

    it('should handle integers', () => {
      expect(formatNumber(1000)).toBe('1,000.00');
    });

    it('should handle falsy values', () => {
      expect(formatNumber(0)).toBe('');
      expect(formatNumber(null as any)).toBe('');
    });
  });

  describe('generateRandomPassword', () => {
    it('should generate password with default length', () => {
      const password = generateRandomPassword();
      expect(password).toHaveLength(16);
    });

    it('should generate password with custom length', () => {
      const password = generateRandomPassword(20);
      expect(password).toHaveLength(20);
    });

    it('should contain required character types', () => {
      const password = generateRandomPassword();
      expect(/[a-z]/.test(password)).toBe(true);
      expect(/[A-Z]/.test(password)).toBe(true);
      expect(/[0-9]/.test(password)).toBe(true);
      expect(/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)).toBe(true);
    });

    it('should generate different passwords', () => {
      const password1 = generateRandomPassword();
      const password2 = generateRandomPassword();
      expect(password1).not.toBe(password2);
    });
  });

  describe('redactSecrets', () => {
    it('should redact IDENTIFIED BY passwords', () => {
      const query = "CREATE USER foo IDENTIFIED BY 'secret123'";
      const result = redactSecrets(query);
      expect(result).toContain("'******'");
      expect(result).not.toContain('secret123');
    });

    it('should redact PASSWORD fields', () => {
      const query = "ALTER USER foo PASSWORD 'secret123'";
      const result = redactSecrets(query);
      expect(result).toContain("'******'");
      expect(result).not.toContain('secret123');
    });

    it('should handle empty query', () => {
      expect(redactSecrets('')).toBe('');
      expect(redactSecrets(null as any)).toBe('');
    });
  });
});
