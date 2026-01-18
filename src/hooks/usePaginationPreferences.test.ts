/**
 * Tests for usePaginationPreferences
 */

import { describe, it, expect } from 'vitest';
import { getDefaultPaginationSize } from './usePaginationPreferences';

describe('usePaginationPreferences', () => {
    describe('getDefaultPaginationSize', () => {
        it('should return default size for queryResults', () => {
            expect(getDefaultPaginationSize('queryResults')).toBe(100);
        });

        it('should return default size for dataSample', () => {
            expect(getDefaultPaginationSize('dataSample')).toBe(25);
        });

        it('should return default size for logs', () => {
            expect(getDefaultPaginationSize('logs')).toBe(100);
        });

        it('should return default size for userManagement', () => {
            expect(getDefaultPaginationSize('userManagement')).toBe(10);
        });
    });
});
