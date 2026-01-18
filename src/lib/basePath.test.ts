/**
 * Tests for lib/basePath.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getBasePath, withBasePath } from './basePath';

describe('lib/basePath', () => {
    describe('getBasePath', () => {
        it('should return base URL from import.meta.env', () => {
            const basePath = getBasePath();
            expect(basePath).toBeDefined();
            expect(typeof basePath).toBe('string');
        });

        it('should return a valid path format', () => {
            const basePath = getBasePath();
            // Base path should either be '/' or end with '/'
            expect(basePath === '/' || basePath.endsWith('/')).toBe(true);
        });
    });

    describe('withBasePath', () => {
        it('should append path without leading slash', () => {
            const result = withBasePath('about');
            expect(result).toBeDefined();
            expect(result).toContain('about');
        });

        it('should handle path with leading slash', () => {
            const result = withBasePath('/about');
            expect(result).toBeDefined();
            expect(result).toContain('about');
            // Should not have double slashes
            expect(result).not.toMatch(/\/\//);
        });

        it('should handle empty path', () => {
            const result = withBasePath('');
            expect(result).toBeDefined();
        });

        it('should handle nested paths', () => {
            const result = withBasePath('api/users');
            expect(result).toBeDefined();
            expect(result).toContain('api/users');
        });

        it('should handle paths with query parameters', () => {
            const result = withBasePath('search?q=test');
            expect(result).toBeDefined();
            expect(result).toContain('search?q=test');
        });

        it('should clean up leading slash from path', () => {
            const result1 = withBasePath('page');
            const result2 = withBasePath('/page');

            // Both should produce the same result (no double slash)
            expect(result1).toBe(result2);
        });
    });
});
