/**
 * Tests for AiChartRenderer utility functions
 *
 * Pure function coverage:
 *   - isChartSpec(): validates ChartSpec shape
 *   - resolveYAxes(): normalises yAxis to string[]
 *   - formatAxisValue(): compacts large numbers
 *   - buildColorPalette(): returns the correct colour array for each scheme
 */

import { describe, it, expect } from 'vitest';
import { isChartSpec, resolveYAxes, formatAxisValue, buildColorPalette } from './AiChartUtils';
import type { ChartSpec } from '../../api/ai-chat';

// ============================================
// isChartSpec
// ============================================

describe('AiChartRenderer / isChartSpec', () => {
    const valid: ChartSpec = {
        chartType: 'bar',
        columns: [{ name: 'engine', type: 'String' }, { name: 'count', type: 'UInt64' }],
        rows: [{ engine: 'MergeTree', count: 42 }],
        xAxis: 'engine',
        yAxis: 'count',
        colorScheme: 'violet',
    };

    it('should return true for a valid ChartSpec', () => {
        expect(isChartSpec(valid)).toBe(true);
    });

    it('should return true when yAxis is an array', () => {
        expect(isChartSpec({ ...valid, yAxis: ['count', 'size'] })).toBe(true);
    });

    it('should return true when optional title is present', () => {
        expect(isChartSpec({ ...valid, title: 'My Chart' })).toBe(true);
    });

    it('should return false for null', () => {
        expect(isChartSpec(null)).toBe(false);
    });

    it('should return false for a primitive', () => {
        expect(isChartSpec('string')).toBe(false);
        expect(isChartSpec(42)).toBe(false);
    });

    it('should return false when chartType is missing', () => {
        const { chartType: _, ...withoutType } = valid;
        expect(isChartSpec(withoutType)).toBe(false);
    });

    it('should return false when rows is not an array', () => {
        expect(isChartSpec({ ...valid, rows: null })).toBe(false);
    });

    it('should return false when columns is not an array', () => {
        expect(isChartSpec({ ...valid, columns: null })).toBe(false);
    });

    it('should return false when xAxis is not a string', () => {
        expect(isChartSpec({ ...valid, xAxis: 123 })).toBe(false);
    });
});

// ============================================
// resolveYAxes
// ============================================

describe('AiChartRenderer / resolveYAxes', () => {
    it('should wrap a single string in an array', () => {
        expect(resolveYAxes('count')).toEqual(['count']);
    });

    it('should return the array unchanged', () => {
        expect(resolveYAxes(['count', 'size'])).toEqual(['count', 'size']);
    });

    it('should handle an empty array', () => {
        expect(resolveYAxes([])).toEqual([]);
    });
});

// ============================================
// formatAxisValue
// ============================================

describe('AiChartRenderer / formatAxisValue', () => {
    it('should leave small numbers unchanged', () => {
        expect(formatAxisValue(42)).toBe('42');
        expect(formatAxisValue(0)).toBe('0');
    });

    it('should format thousands with K', () => {
        expect(formatAxisValue(1000)).toBe('1K');
        expect(formatAxisValue(1500)).toBe('1.5K');
        expect(formatAxisValue(999999)).toBe('1000K');
    });

    it('should format millions with M', () => {
        expect(formatAxisValue(1_000_000)).toBe('1M');
        expect(formatAxisValue(2_500_000)).toBe('2.5M');
    });

    it('should format billions with B', () => {
        expect(formatAxisValue(1_000_000_000)).toBe('1B');
    });

    it('should handle string numbers', () => {
        expect(formatAxisValue('5000')).toBe('5K');
    });

    it('should return the original string for non-numeric values', () => {
        // Non-numeric strings: Number('MergeTree') = NaN, !isFinite(NaN) = true → String(value) = 'MergeTree'
        expect(formatAxisValue('MergeTree')).toBe('MergeTree');
    });

    it('should handle negative numbers', () => {
        expect(formatAxisValue(-2_000)).toBe('-2K');
    });
});

// ============================================
// buildColorPalette
// ============================================

describe('AiChartRenderer / buildColorPalette', () => {
    it('should return violet palette for "violet"', () => {
        const palette = buildColorPalette('violet');
        expect(Array.isArray(palette)).toBe(true);
        expect(palette.length).toBeGreaterThan(0);
        expect(palette[0]).toMatch(/^#/);
    });

    it('should return different palettes for different schemes', () => {
        const violet = buildColorPalette('violet');
        const blue = buildColorPalette('blue');
        expect(violet[0]).not.toBe(blue[0]);
    });

    it('should fall back to violet for unknown schemes', () => {
        const unknown = buildColorPalette('unknown-scheme');
        const violet = buildColorPalette('violet');
        expect(unknown).toEqual(violet);
    });

    const SCHEMES = ['violet', 'blue', 'green', 'orange', 'rainbow'] as const;
    SCHEMES.forEach((scheme) => {
        it(`should return a non-empty array for scheme "${scheme}"`, () => {
            const palette = buildColorPalette(scheme);
            expect(palette.length).toBeGreaterThan(0);
        });
    });
});
