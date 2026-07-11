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

const SUPPORTED_CHART_TYPES = new Set([
    'bar', 'horizontal_bar', 'grouped_bar', 'stacked_bar',
    'line', 'multi_line', 'area', 'stacked_area',
    'pie', 'donut', 'scatter', 'radar', 'treemap',
    'funnel', 'histogram', 'heatmap',
]);

const NUMERIC_TYPE_PATTERN = /^(?:Nullable\()?((?:U?Int|Float|Decimal)\d*)/i;
const DATE_TYPE_PATTERN = /^(?:Nullable\()?(?:Date|DateTime)/i;
const STRING_TYPE_PATTERN = /^(?:Nullable\()?(?:String|FixedString|LowCardinality|Enum)/i;

export interface NormalizedChartResult {
    spec: ChartSpec | null;
    reason?: string;
}

export function humanizeAxisName(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_.-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value !== 'string' || value.trim() === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function normalizeChartType(value: string): string {
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const aliases: Record<string, string> = {
        column: 'bar',
        columns: 'bar',
        horizontalbar: 'horizontal_bar',
        multiline: 'multi_line',
        stackedarea: 'stacked_area',
        stackedbar: 'stacked_bar',
        groupedbar: 'grouped_bar',
    };
    const resolved = aliases[normalized] ?? normalized;
    return SUPPORTED_CHART_TYPES.has(resolved) ? resolved : 'bar';
}

function columnHasNumericValues(rows: Record<string, unknown>[], name: string): boolean {
    const populated = rows.map((row) => row[name]).filter((value) => value !== null && value !== undefined && value !== '');
    if (populated.length === 0) return false;
    return populated.filter((value) => toFiniteNumber(value) !== null).length / populated.length >= 0.8;
}

function resolveColumnName(requested: string | undefined, names: string[]): string | undefined {
    if (!requested) return undefined;
    const exact = names.find((name) => name === requested);
    if (exact) return exact;
    const normalized = requested.trim().toLowerCase();
    return names.find((name) => name.toLowerCase() === normalized);
}

/**
 * Repair and normalise an AI-produced chart contract before it reaches Recharts.
 * ClickHouse serialises many numeric types as strings, and model-supplied axis
 * names can differ only by casing; both are handled here.
 */
export function normalizeChartSpec(value: unknown): NormalizedChartResult {
    if (!value || typeof value !== 'object') return { spec: null, reason: 'Invalid chart response.' };
    const raw = value as Record<string, unknown>;
    if (!Array.isArray(raw.rows) || raw.rows.length === 0) {
        return { spec: null, reason: 'The chart query returned no rows.' };
    }

    const rows = raw.rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row));
    if (rows.length === 0) return { spec: null, reason: 'The chart rows are not valid objects.' };

    const declaredColumns = Array.isArray(raw.columns)
        ? raw.columns.filter((column): column is { name: string; type: string } =>
            !!column && typeof column === 'object' &&
            typeof (column as Record<string, unknown>).name === 'string' &&
            typeof (column as Record<string, unknown>).type === 'string')
        : [];
    const rowNames = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    const names = Array.from(new Set([...declaredColumns.map((column) => column.name), ...rowNames]));
    if (names.length < 2) return { spec: null, reason: 'At least two columns are required to draw a chart.' };

    const columns = names.map((name) => declaredColumns.find((column) => column.name === name) ?? {
        name,
        type: columnHasNumericValues(rows, name) ? 'Float64' : 'String',
    });
    const numericNames = columns
        .filter((column) => NUMERIC_TYPE_PATTERN.test(column.type) || columnHasNumericValues(rows, column.name))
        .map((column) => column.name);
    const dateNames = columns.filter((column) => DATE_TYPE_PATTERN.test(column.type)).map((column) => column.name);
    const categoryNames = columns.filter((column) => STRING_TYPE_PATTERN.test(column.type)).map((column) => column.name);

    const chartType = normalizeChartType(typeof raw.chartType === 'string' ? raw.chartType : 'bar');
    const requiresNumericX = chartType === 'scatter' || chartType === 'histogram';
    const requestedX = resolveColumnName(typeof raw.xAxis === 'string' ? raw.xAxis : undefined, names);
    const xAxis = requiresNumericX
        ? (requestedX && numericNames.includes(requestedX) ? requestedX : numericNames[0])
        : requestedX ?? dateNames[0] ?? categoryNames[0] ?? names.find((name) => !numericNames.includes(name)) ?? names[0];
    if (!xAxis) return { spec: null, reason: 'A usable X axis could not be determined.' };

    const requestedY = typeof raw.yAxis === 'string'
        ? [raw.yAxis]
        : Array.isArray(raw.yAxis)
            ? raw.yAxis.filter((axis): axis is string => typeof axis === 'string')
            : [];
    const resolvedY = requestedY
        .map((axis) => resolveColumnName(axis, names))
        .filter((axis): axis is string => !!axis && axis !== xAxis && numericNames.includes(axis));
    const inferredY = numericNames.filter((name) => name !== xAxis);
    const yAxes = Array.from(new Set(resolvedY.length > 0 ? resolvedY : inferredY));
    if (chartType !== 'histogram' && yAxes.length === 0) {
        return { spec: null, reason: 'No numeric measure is available for the Y axis.' };
    }

    const normalizedRows = rows.map((row) => {
        const normalized = { ...row };
        const numericColumns = new Set([...yAxes, ...(requiresNumericX ? [xAxis] : [])]);
        numericColumns.forEach((name) => {
            normalized[name] = toFiniteNumber(row[name]);
        });
        return normalized;
    }).filter((row) => row[xAxis] !== null && row[xAxis] !== undefined && row[xAxis] !== '');

    if (normalizedRows.length === 0) return { spec: null, reason: 'No plottable values remain after cleaning the chart data.' };
    if (chartType !== 'histogram' && !normalizedRows.some((row) =>
        yAxes.some((axis) => typeof row[axis] === 'number' && Number.isFinite(row[axis])))) {
        return { spec: null, reason: 'The selected measures contain no finite numeric values.' };
    }

    return {
        spec: {
            chartType,
            title: typeof raw.title === 'string' ? raw.title : undefined,
            columns,
            rows: normalizedRows,
            xAxis,
            yAxis: yAxes.length === 1 ? yAxes[0] : yAxes,
            colorScheme: typeof raw.colorScheme === 'string' ? raw.colorScheme : 'violet',
        },
    };
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
