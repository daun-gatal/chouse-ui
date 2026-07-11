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
import {
    isChartSpec,
    resolveYAxes,
    formatAxisValue,
    buildColorPalette,
    humanizeAxisName,
    normalizeChartSpec,
    toFiniteNumber,
} from './AiChartUtils';
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

describe('AiChartRenderer / normalizeChartSpec', () => {
    it('repairs axis casing and converts ClickHouse numeric strings', () => {
        const result = normalizeChartSpec({
            chartType: 'line',
            columns: [
                { name: 'event_date', type: 'Date' },
                { name: 'TotalBytes', type: 'UInt64' },
            ],
            rows: [
                { event_date: '2026-07-10', TotalBytes: '1024' },
                { event_date: '2026-07-11', TotalBytes: '2048' },
            ],
            xAxis: 'EVENT_DATE',
            yAxis: 'totalbytes',
            colorScheme: 'blue',
        });

        expect(result.reason).toBeUndefined();
        expect(result.spec?.xAxis).toBe('event_date');
        expect(result.spec?.yAxis).toBe('TotalBytes');
        expect(result.spec?.rows[0].TotalBytes).toBe(1024);
    });

    it('infers axes when the requested names do not exist', () => {
        const result = normalizeChartSpec({
            chartType: 'bar',
            columns: [
                { name: 'database', type: 'String' },
                { name: 'query_count', type: 'UInt64' },
            ],
            rows: [{ database: 'default', query_count: '12' }],
            xAxis: 'missing_dimension',
            yAxis: 'missing_measure',
            colorScheme: 'violet',
        });

        expect(result.spec?.xAxis).toBe('database');
        expect(result.spec?.yAxis).toBe('query_count');
    });

    it('uses numeric axes for scatter plots', () => {
        const result = normalizeChartSpec({
            chartType: 'scatter',
            columns: [
                { name: 'label', type: 'String' },
                { name: 'duration_ms', type: 'Float64' },
                { name: 'read_rows', type: 'UInt64' },
            ],
            rows: [{ label: 'q1', duration_ms: '4.5', read_rows: '100' }],
            xAxis: 'label',
            yAxis: 'duration_ms',
            colorScheme: 'green',
        });

        expect(result.spec?.xAxis).toBe('duration_ms');
        expect(result.spec?.yAxis).toBe('read_rows');
    });

    it('returns a useful reason for empty and non-numeric data', () => {
        expect(normalizeChartSpec({ rows: [] }).reason).toContain('no rows');
        expect(normalizeChartSpec({
            chartType: 'bar',
            rows: [{ category: 'A', status: 'ok' }],
            columns: [
                { name: 'category', type: 'String' },
                { name: 'status', type: 'String' },
            ],
            xAxis: 'category',
            yAxis: 'status',
        }).reason).toContain('numeric measure');
        expect(normalizeChartSpec({
            chartType: 'line',
            rows: [{ date: '2026-07-11', value: 'NaN' }],
            columns: [{ name: 'date', type: 'Date' }, { name: 'value', type: 'Float64' }],
            xAxis: 'date',
            yAxis: 'value',
        }).reason).toContain('finite numeric values');
    });
});

describe('AiChartRenderer / formatting helpers', () => {
    it('humanizes SQL aliases for readable axis labels', () => {
        expect(humanizeAxisName('read_rows_total')).toBe('Read Rows Total');
        expect(humanizeAxisName('durationMs')).toBe('Duration Ms');
    });

    it('coerces only finite numeric values', () => {
        expect(toFiniteNumber('42.5')).toBe(42.5);
        expect(toFiniteNumber('')).toBeNull();
        expect(toFiniteNumber('not-a-number')).toBeNull();
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
