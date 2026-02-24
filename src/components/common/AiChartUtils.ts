/**
 * AiChartUtils
 *
 * Support logic for AiChartRenderer, separated from the component
 * to ensure Vite HMR (Fast Refresh) works correctly.
 */

import type { ChartSpec } from '@/api/ai-chat';

// ============================================
// Color Palettes
// ============================================

export const COLOR_PALETTES: Record<string, string[]> = {
    violet: ['#8B5CF6', '#A78BFA', '#C4B5FD', '#7C3AED', '#6D28D9', '#5B21B6', '#DDD6FE', '#EDE9FE'],
    blue: ['#3B82F6', '#60A5FA', '#93C5FD', '#2563EB', '#1D4ED8', '#1E40AF', '#BFDBFE', '#DBEAFE'],
    green: ['#10B981', '#34D399', '#6EE7B7', '#059669', '#047857', '#065F46', '#A7F3D0', '#D1FAE5'],
    orange: ['#F59E0B', '#FBBF24', '#FCD34D', '#D97706', '#B45309', '#92400E', '#FDE68A', '#FEF3C7'],
    rainbow: ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#F97316'],
};

export function getPalette(colorScheme: string): string[] {
    return COLOR_PALETTES[colorScheme] ?? COLOR_PALETTES.violet;
}

// ============================================
// Type guard
// ============================================

/**
 * Returns true when the value matches the ChartSpec shape.
 * Used in tests and as a runtime safety check.
 */
export function isChartSpec(value: unknown): value is ChartSpec {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.chartType === 'string' &&
        Array.isArray(v.columns) &&
        Array.isArray(v.rows) &&
        typeof v.xAxis === 'string' &&
        (typeof v.yAxis === 'string' || Array.isArray(v.yAxis)) &&
        typeof v.colorScheme === 'string'
    );
}

// ============================================
// Axis / data helpers
// ============================================

/** Normalise yAxis to always be an array of column names */
export function resolveYAxes(yAxis: string | string[]): string[] {
    return Array.isArray(yAxis) ? yAxis : [yAxis];
}

/** Format large numbers compactly (e.g. 1_000_000 → "1M") */
export function formatAxisValue(value: unknown): string {
    const num = Number(value);
    if (!isFinite(num)) return String(value);
    const fmt = (n: number, divisor: number, suffix: string): string => {
        const divided = n / divisor;
        // Use 1 decimal place, but strip trailing .0 for whole numbers
        return `${parseFloat(divided.toFixed(1))}${suffix}`;
    };
    if (Math.abs(num) >= 1_000_000_000) return fmt(num, 1_000_000_000, 'B');
    if (Math.abs(num) >= 1_000_000) return fmt(num, 1_000_000, 'M');
    if (Math.abs(num) >= 1_000) return fmt(num, 1_000, 'K');
    return String(Number(num.toFixed(2)));
}

/** Build colour palette object for styled label */
export function buildColorPalette(scheme: string): string[] {
    return getPalette(scheme);
}

// ============================================
// Styles
// ============================================

type CSSProps = Record<string, string | number>;

export const tooltipStyle: CSSProps = {
    backgroundColor: 'rgba(0,0,0,0.85)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '10px',
    color: '#e4e4e7',
    fontSize: '11px',
    backdropFilter: 'blur(8px)',
};

export const tooltipLabelStyle: CSSProps = {
    color: '#a1a1aa',
    marginBottom: '4px',
    fontWeight: 600,
};
