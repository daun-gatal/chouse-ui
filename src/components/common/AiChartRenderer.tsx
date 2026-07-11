/**
 * AiChartRenderer
 *
 * Single-responsibility component: renders a ChartSpec produced by the
 * AI's `render_chart` tool into an interactive Recharts chart.
 *
 * Supports 16 chart types:
 *   bar, horizontal_bar, grouped_bar, stacked_bar,
 *   line, multi_line, area, stacked_area,
 *   pie, donut, scatter, radar,
 *   treemap, funnel, histogram, heatmap
 */

import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { toPng } from 'html-to-image';
import Papa from 'papaparse';
import type { ChartSpec } from '@/api/ai-chat';
import {
    buildColorPalette,
    resolveYAxes,
    formatAxisValue,
    humanizeAxisName,
    normalizeChartSpec,
    tooltipStyle,
    tooltipLabelStyle,
} from './AiChartUtils';
import { toast } from 'sonner';
import { log } from '@/lib/log';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BarChart3, Download, Image, FileText } from 'lucide-react';
import {
    ResponsiveContainer,
    BarChart,
    Bar,
    LineChart,
    Line,
    AreaChart,
    Area,
    PieChart,
    Pie,
    Cell,
    ScatterChart,
    Scatter,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    RadarChart,
    Radar,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    Treemap,
    FunnelChart,
    Funnel,
    LabelList,
    Brush,
} from 'recharts';

/**
 * Measures a container's layout width using offsetWidth (unaffected by CSS transforms).
 * Recharts' ResponsiveContainer uses getBoundingClientRect() which returns *visual*
 * dimensions — broken when the chat window applies transform: scale().
 */
function useContainerWidth(): [React.RefObject<HTMLDivElement | null>, number] {
    const ref = useRef<HTMLDivElement | null>(null);
    const [width, setWidth] = useState(0);

    const measure = useCallback(() => {
        if (ref.current) setWidth(ref.current.offsetWidth);
    }, []);

    useEffect(() => {
        measure();
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(() => measure());
        ro.observe(el);
        return () => ro.disconnect();
    }, [measure]);

    return [ref, width];
}

// Max slices to show in pie/donut; rest are aggregated into "Other"
const PIE_DONUT_MAX_SLICES = 12;
// Show inline labels on pie only when slice count is at or below this (avoids overlap)
const PIE_LABEL_MAX_SLICES = 8;
// Max categories for bar-family charts to avoid cramped axes
const BAR_MAX_CATEGORIES = 25;

/** Sanitize chart title for use in download filename (alphanumeric and hyphens, max 40 chars). */
function sanitizeChartFilename(title: string | undefined): string {
    if (!title || !title.trim()) return 'chart';
    const sanitized = title.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return sanitized.slice(0, 40) || 'chart';
}

/** Prepare a row for CSV export (escape objects and special chars). */
function prepareRowForCsv(row: Record<string, unknown>): Record<string, string | number | boolean | null> {
    const out: Record<string, string | number | boolean | null> = {};
    for (const key of Object.keys(row)) {
        const v = row[key];
        if (v === null || v === undefined) out[key] = null;
        else if (typeof v === 'object') out[key] = JSON.stringify(v);
        else if (typeof v === 'number' || typeof v === 'boolean') out[key] = v;
        else out[key] = String(v);
    }
    return out;
}

/** Aggregate pie/donut data: top N by value descending, rest summed as "Other". */
function aggregatePieDonutData(
    data: { name: string; value: number }[],
    maxSlices: number
): { name: string; value: number }[] {
    if (data.length <= maxSlices) return data;
    const sorted = [...data].sort((a, b) => b.value - a.value);
    const top = sorted.slice(0, maxSlices);
    const rest = sorted.slice(maxSlices);
    const otherValue = rest.reduce((s, d) => s + d.value, 0);
    if (otherValue <= 0) return top;
    return [...top, { name: 'Other', value: otherValue }];
}

// ============================================
// Histogram binning helper
// ============================================

function buildHistogramBins(
    rows: Record<string, unknown>[],
    xCol: string,
    bins = 20
): { bin: string; count: number }[] {
    const values = rows
        .map((r) => Number(r[xCol]))
        .filter((v) => isFinite(v));

    if (values.length === 0) return [];

    const min = Math.min(...values);
    const max = Math.max(...values);
    const step = (max - min) / bins || 1;

    const counts: number[] = Array(bins).fill(0);
    values.forEach((v) => {
        const idx = Math.min(Math.floor((v - min) / step), bins - 1);
        counts[idx]++;
    });

    return counts.map((count, i) => ({
        bin: `${formatAxisValue(min + i * step)}–${formatAxisValue(min + (i + 1) * step)}`,
        count,
    }));
}

// ============================================
// AiChartRenderer
// ============================================

interface AiChartRendererProps {
    spec: ChartSpec;
}

export function AiChartRenderer({ spec }: AiChartRendererProps): React.ReactElement | null {
    const normalized = useMemo(() => normalizeChartSpec(spec), [spec]);

    if (!normalized.spec) {
        return (
            <div className="mb-1 mt-3 flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-xs border border-dashed border-ink-500 bg-ink-100 px-4 text-center">
                <BarChart3 className="h-5 w-5 text-paper-faint" aria-hidden />
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-dim">
                    Chart unavailable
                </span>
                <span className="max-w-sm text-[11px] leading-relaxed text-paper-faint">
                    {normalized.reason ?? 'No plottable data was returned.'}
                </span>
            </div>
        );
    }

    return <ChartRendererContent spec={normalized.spec} />;
}

function ChartRendererContent({ spec }: AiChartRendererProps): React.ReactElement {
    const { chartType, title, rows, xAxis, yAxis, colorScheme } = spec;
    const [containerRef, containerWidth] = useContainerWidth();

    const palette = useMemo(() => buildColorPalette(colorScheme), [colorScheme]);
    const yAxes = useMemo(() => resolveYAxes(yAxis), [yAxis]);
    const yAxisMagnitudes = useMemo(() => new Map(yAxes.map((axis) => [
        axis,
        Math.max(...rows.map((row) => Math.abs(Number(row[axis] ?? 0))).filter(Number.isFinite), 0),
    ])), [rows, yAxes]);
    const canUseDualScale = yAxes.length === 2 && !['stacked_bar', 'stacked_area'].includes(chartType);
    const [firstMagnitude, secondMagnitude] = yAxes.map((axis) => yAxisMagnitudes.get(axis) ?? 0);
    const smallerMagnitude = Math.min(firstMagnitude, secondMagnitude);
    const largerMagnitude = Math.max(firstMagnitude, secondMagnitude);
    const useDualScale = canUseDualScale && smallerMagnitude > 0 && largerMagnitude / smallerMagnitude >= 50;
    const rightAxisSeries = useDualScale
        ? (firstMagnitude <= secondMagnitude ? yAxes[0] : yAxes[1])
        : undefined;
    const leftAxisSeries = yAxes.find((axis) => axis !== rightAxisSeries) ?? yAxes[0];
    const axisForSeries = (axis: string): 'left' | 'right' => axis === rightAxisSeries ? 'right' : 'left';

    const xAxisLabel = humanizeAxisName(xAxis);
    const yAxisLabels = chartType === 'histogram' ? ['Count'] : yAxes.map(humanizeAxisName);
    const needsAngledTicks = rows.length > 8;

    const sharedXAxis = (
        <XAxis
            dataKey={xAxis}
            tick={{ fill: '#71717a', fontSize: 10 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={18}
            angle={needsAngledTicks ? -28 : 0}
            textAnchor={needsAngledTicks ? 'end' : 'middle'}
            height={needsAngledTicks ? 58 : 42}
            label={{ value: xAxisLabel, position: 'insideBottom', offset: 0, fill: '#71717a', fontSize: 10 }}
            tickFormatter={(v: unknown) => {
                const str = String(v);
                const compact = str.includes('T') ? str.replace('T', ' ').replace(/:\d{2}(?:\.\d+)?Z?$/, '') : str;
                return compact.length > 16 ? compact.slice(0, 15) + '…' : compact;
            }}
        />
    );

    const sharedYAxis = (
        <YAxis
            tick={{ fill: '#71717a', fontSize: 10 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
            tickLine={false}
            tickFormatter={formatAxisValue}
            width={64}
            label={yAxes.length === 1 ? {
                value: humanizeAxisName(yAxes[0]),
                angle: -90,
                position: 'insideLeft',
                offset: 8,
                fill: '#71717a',
                fontSize: 10,
            } : undefined}
        />
    );

    const seriesYAxes = (
        <>
            <YAxis
                yAxisId="left"
                tick={{ fill: '#71717a', fontSize: 10 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                tickLine={false}
                tickFormatter={formatAxisValue}
                width={64}
                label={leftAxisSeries ? {
                    value: humanizeAxisName(leftAxisSeries),
                    angle: -90,
                    position: 'insideLeft',
                    offset: 8,
                    fill: '#71717a',
                    fontSize: 10,
                } : undefined}
            />
            {rightAxisSeries && (
                <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fill: '#71717a', fontSize: 10 }}
                    axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                    tickLine={false}
                    tickFormatter={formatAxisValue}
                    width={64}
                    label={{
                        value: humanizeAxisName(rightAxisSeries),
                        angle: 90,
                        position: 'insideRight',
                        offset: 8,
                        fill: '#71717a',
                        fontSize: 10,
                    }}
                />
            )}
        </>
    );

    const sharedGrid = (
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
    );

    const sharedTooltip = (
        <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={tooltipLabelStyle}
            itemStyle={{ color: '#d4d4d8', fontSize: '11px' }}
            formatter={(value: unknown, name?: string) => [
                formatAxisValue(value),
                humanizeAxisName(name ?? yAxes[0] ?? '')
            ]}
            labelFormatter={(label: unknown) => `${xAxisLabel}: ${String(label)}`}
            separator=": "
            cursor={{ fill: 'rgba(139,92,246,0.08)', stroke: 'rgba(139,92,246,0.18)' }}
        />
    );

    const sharedLegend = yAxes.length > 1 ? (
        <Legend
            wrapperStyle={{ fontSize: '10px', color: '#71717a', paddingTop: '8px' }}
            formatter={(value: string) => humanizeAxisName(value)}
        />
    ) : null;

    const isBarFamily = ['bar', 'horizontal_bar', 'grouped_bar', 'stacked_bar'].includes(chartType);
    const displayRows =
        isBarFamily && rows.length > BAR_MAX_CATEGORIES
            ? rows.slice(0, BAR_MAX_CATEGORIES)
            : rows;
    const barFamilyTruncated = isBarFamily && rows.length > BAR_MAX_CATEGORIES;

    const baseName = sanitizeChartFilename(title);
    const timestamp = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');

    const handleDownloadPng = useCallback(async () => {
        const el = containerRef.current;
        if (!el) return;
        try {
            const dataUrl = await toPng(el, {
                cacheBust: true,
                backgroundColor: '#1a1c24',
                pixelRatio: 2,
            });
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `${baseName}-${timestamp()}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (err) {
            log.error('AiChartRenderer error', err);
            toast.error('Failed to capture chart as image. Please try again.');
        }
    }, [baseName]);

    const handleDownloadCsv = useCallback(() => {
        if (!rows.length) return;
        const prepared = rows.map(prepareRowForCsv);
        const csv = Papa.unparse(prepared, { quotes: true, quoteChar: '"', escapeChar: '"' });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}-data-${timestamp()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [rows, baseName]);

    const handleDownloadJson = useCallback(() => {
        if (!rows.length) return;
        const json = JSON.stringify(rows, null, 2);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}-data-${timestamp()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, [rows, baseName]);

    const CHART_HEIGHT = chartType === 'horizontal_bar'
        ? Math.min(520, Math.max(280, displayRows.length * 30 + 90))
        : 320;
    const chartMargin = { top: 8, right: rightAxisSeries ? 8 : 16, bottom: 4, left: 4 };

    // ============================================
    // Chart rendering per type
    // ============================================

    let chartElement: React.ReactElement;

    switch (chartType) {

        // ---- BAR ----
        case 'bar':
        case 'stacked_bar': {
            const isStacked = chartType === 'stacked_bar';
            chartElement = (
                <BarChart data={displayRows} accessibilityLayer margin={chartMargin}>
                    {sharedGrid}
                    {sharedXAxis}
                    {seriesYAxes}
                    {sharedTooltip}
                    {sharedLegend}
                    {yAxes.map((col, i) => (
                        <Bar
                            key={col}
                            dataKey={col}
                            name={humanizeAxisName(col)}
                            yAxisId={axisForSeries(col)}
                            fill={palette[i % palette.length]}
                            stackId={isStacked ? 'a' : undefined}
                            radius={isStacked ? [0, 0, 0, 0] : [3, 3, 0, 0]}
                            maxBarSize={60}
                        />
                    ))}
                </BarChart>
            );
            break;
        }

        // ---- GROUPED BAR ----
        case 'grouped_bar': {
            chartElement = (
                <BarChart data={displayRows} barCategoryGap="25%" accessibilityLayer margin={chartMargin}>
                    {sharedGrid}
                    {sharedXAxis}
                    {seriesYAxes}
                    {sharedTooltip}
                    {sharedLegend}
                    {yAxes.map((col, i) => (
                        <Bar
                            key={col}
                            dataKey={col}
                            name={humanizeAxisName(col)}
                            yAxisId={axisForSeries(col)}
                            fill={palette[i % palette.length]}
                            radius={[3, 3, 0, 0]}
                            maxBarSize={40}
                        />
                    ))}
                </BarChart>
            );
            break;
        }

        // ---- HORIZONTAL BAR ----
        case 'horizontal_bar': {
            chartElement = (
                <BarChart data={displayRows} layout="vertical" accessibilityLayer margin={{ ...chartMargin, left: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                    <XAxis
                        type="number"
                        tick={{ fill: '#71717a', fontSize: 10 }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                        tickLine={false}
                        tickFormatter={formatAxisValue}
                    />
                    <YAxis
                        type="category"
                        dataKey={xAxis}
                        tick={{ fill: '#71717a', fontSize: 10 }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                        tickLine={false}
                        width={100}
                        tickFormatter={(v: unknown) => {
                            const s = String(v);
                            return s.length > 14 ? s.slice(0, 13) + '…' : s;
                        }}
                    />
                    {sharedTooltip}
                    {sharedLegend}
                    {yAxes.map((col, i) => (
                        <Bar
                            key={col}
                            dataKey={col}
                            name={humanizeAxisName(col)}
                            fill={palette[i % palette.length]}
                            radius={[0, 3, 3, 0]}
                            maxBarSize={28}
                        />
                    ))}
                </BarChart>
            );
            break;
        }

        // ---- LINE / MULTI-LINE ----
        case 'line':
        case 'multi_line': {
            chartElement = (
                <LineChart data={rows} accessibilityLayer margin={chartMargin}>
                    {sharedGrid}
                    {sharedXAxis}
                    {seriesYAxes}
                    {sharedTooltip}
                    {sharedLegend}
                    {yAxes.map((col, i) => (
                        <Line
                            key={col}
                            type="monotone"
                            dataKey={col}
                            name={humanizeAxisName(col)}
                            yAxisId={axisForSeries(col)}
                            stroke={palette[i % palette.length]}
                            strokeWidth={2}
                            dot={rows.length <= 50}
                            activeDot={{ r: 4 }}
                            connectNulls={false}
                        />
                    ))}
                    {rows.length > 30 && (
                        <Brush
                            dataKey={xAxis}
                            height={18}
                            travellerWidth={8}
                            stroke={palette[0]}
                            fill="#171923"
                            tickFormatter={() => ''}
                        />
                    )}
                </LineChart>
            );
            break;
        }

        // ---- AREA / STACKED AREA ----
        case 'area':
        case 'stacked_area': {
            const isStacked = chartType === 'stacked_area';
            chartElement = (
                <AreaChart data={rows} accessibilityLayer margin={chartMargin}>
                    <defs>
                        {yAxes.map((col, i) => (
                            <linearGradient key={col} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={palette[i % palette.length]} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={palette[i % palette.length]} stopOpacity={0.02} />
                            </linearGradient>
                        ))}
                    </defs>
                    {sharedGrid}
                    {sharedXAxis}
                    {seriesYAxes}
                    {sharedTooltip}
                    {sharedLegend}
                    {yAxes.map((col, i) => (
                        <Area
                            key={col}
                            type="monotone"
                            dataKey={col}
                            name={humanizeAxisName(col)}
                            yAxisId={axisForSeries(col)}
                            stroke={palette[i % palette.length]}
                            strokeWidth={2}
                            fill={`url(#grad-${i})`}
                            stackId={isStacked ? 'a' : undefined}
                        />
                    ))}
                    {rows.length > 30 && (
                        <Brush
                            dataKey={xAxis}
                            height={18}
                            travellerWidth={8}
                            stroke={palette[0]}
                            fill="#171923"
                            tickFormatter={() => ''}
                        />
                    )}
                </AreaChart>
            );
            break;
        }

        // ---- PIE ----
        case 'pie': {
            const firstY = yAxes[0];
            const rawPieData = rows.map((r) => ({
                name: String(r[xAxis] ?? ''),
                value: Number(r[firstY] ?? 0),
            }));
            const pieData = aggregatePieDonutData(rawPieData, PIE_DONUT_MAX_SLICES);
            const showPieLabels = pieData.length <= PIE_LABEL_MAX_SLICES;
            chartElement = (
                <PieChart accessibilityLayer>
                    <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={
                            showPieLabels
                                ? (props: { name?: string; percent?: number }) => {
                                      const n = props.name ?? '';
                                      const p = props.percent ?? 0;
                                      const label = n.length > 10 ? n.slice(0, 9) + '\u2026' : n;
                                      return `${label} (${(p * 100).toFixed(1)}%)`;
                                  }
                                : false
                        }
                        labelLine={false}
                    >
                        {pieData.map((_, i) => (
                            <Cell key={i} fill={palette[i % palette.length]} />
                        ))}
                    </Pie>
                    <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        itemStyle={{ color: '#d4d4d8', fontSize: '11px' }}
                        formatter={(v: unknown) => [formatAxisValue(v), '']}
                        separator=""
                    />
                </PieChart>
            );
            break;
        }

        // ---- DONUT ----
        case 'donut': {
            const firstY = yAxes[0];
            const rawDonutData = rows.map((r) => ({
                name: String(r[xAxis] ?? ''),
                value: Number(r[firstY] ?? 0),
            }));
            const donutData = aggregatePieDonutData(rawDonutData, PIE_DONUT_MAX_SLICES);
            const total = donutData.reduce((s, d) => s + d.value, 0);
            chartElement = (
                <PieChart accessibilityLayer>
                    <Pie
                        data={donutData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={2}
                    >
                        {donutData.map((_, i) => (
                            <Cell key={i} fill={palette[i % palette.length]} />
                        ))}
                    </Pie>
                    <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        itemStyle={{ color: '#d4d4d8', fontSize: '11px' }}
                        formatter={(v: unknown) => [formatAxisValue(v), '']}
                        separator=""
                    />
                    <Legend wrapperStyle={{ fontSize: '10px', color: '#71717a', paddingTop: '8px' }} />
                    {/* Centre label */}
                    <text
                        x="50%" y="46%" textAnchor="middle" dominantBaseline="middle"
                        style={{ fill: '#e4e4e7', fontSize: '16px', fontWeight: 700 }}
                    >
                        {formatAxisValue(total)}
                    </text>
                    <text
                        x="50%" y="56%" textAnchor="middle" dominantBaseline="middle"
                        style={{ fill: '#71717a', fontSize: '10px' }}
                    >
                        Total
                    </text>
                </PieChart>
            );
            break;
        }

        // ---- SCATTER ----
        case 'scatter': {
            const xCol = xAxis;
            const yCol = yAxes[0];
            const scatterData = rows.map((r) => ({
                x: Number(r[xCol] ?? 0),
                y: Number(r[yCol] ?? 0),
            }));
            chartElement = (
                <ScatterChart accessibilityLayer margin={chartMargin}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                        type="number"
                        dataKey="x"
                        name={xCol}
                        tick={{ fill: '#71717a', fontSize: 10 }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                        tickLine={false}
                        tickFormatter={formatAxisValue}
                        label={{ value: xCol, position: 'insideBottom', offset: -2, fill: '#71717a', fontSize: 10 }}
                    />
                    <YAxis
                        type="number"
                        dataKey="y"
                        name={yCol}
                        tick={{ fill: '#71717a', fontSize: 10 }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                        tickLine={false}
                        tickFormatter={formatAxisValue}
                        width={55}
                        label={{ value: yCol, angle: -90, position: 'insideLeft', offset: 10, fill: '#71717a', fontSize: 10 }}
                    />
                    <Tooltip
                        cursor={false}
                        contentStyle={tooltipStyle}
                        formatter={(v: unknown, name?: string) => [formatAxisValue(v), name ?? '']}
                    />
                    <Scatter data={scatterData} fill={palette[0]} opacity={0.75} />
                </ScatterChart>
            );
            break;
        }

        // ---- RADAR ----
        case 'radar': {
            const radarData = rows.slice(0, 50).map((r) => {
                const entry: Record<string, unknown> = { subject: String(r[xAxis] ?? '') };
                yAxes.forEach((col) => {
                    entry[col] = Number(r[col] ?? 0);
                });
                return entry;
            });
            chartElement = (
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%" accessibilityLayer>
                    <PolarGrid stroke="rgba(255,255,255,0.08)" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: '#71717a', fontSize: 10 }} />
                    <PolarRadiusAxis tick={{ fill: '#71717a', fontSize: 9 }} tickFormatter={formatAxisValue} />
                    {sharedTooltip}
                    {yAxes.length > 1 && <Legend wrapperStyle={{ fontSize: '10px', color: '#71717a' }} />}
                    {yAxes.map((col, i) => (
                        <Radar
                            key={col}
                            name={col}
                            dataKey={col}
                            stroke={palette[i % palette.length]}
                            fill={palette[i % palette.length]}
                            fillOpacity={0.15}
                        />
                    ))}
                </RadarChart>
            );
            break;
        }

        // ---- TREEMAP ----
        case 'treemap': {
            const firstY = yAxes[0];
            const treemapData = rows.map((r) => ({
                name: String(r[xAxis] ?? ''),
                size: Math.max(0, Number(r[firstY] ?? 0)),
            }));
            chartElement = (
                <Treemap
                    data={treemapData}
                    dataKey="size"
                    aspectRatio={4 / 3}
                    stroke="rgba(0,0,0,0.3)"
                    content={({ x, y, width, height, name, index }: {
                        x?: number; y?: number; width?: number; height?: number;
                        name?: string; index?: number;
                    }) => {
                        const _x = x ?? 0;
                        const _y = y ?? 0;
                        const _w = width ?? 0;
                        const _h = height ?? 0;
                        const color = palette[(index ?? 0) % palette.length];
                        return (
                            <g>
                                <rect x={_x} y={_y} width={_w} height={_h} style={{ fill: color, stroke: 'rgba(0,0,0,0.3)', strokeWidth: 1, fillOpacity: 0.85 }} />
                                {_w > 40 && _h > 20 && (
                                    <text
                                        x={_x + _w / 2} y={_y + _h / 2}
                                        textAnchor="middle" dominantBaseline="middle"
                                        style={{ fill: '#fff', fontSize: Math.min(12, _w / 6), fontWeight: 500 }}
                                    >
                                        {String(name ?? '').length > 14 ? String(name ?? '').slice(0, 13) + '…' : name}
                                    </text>
                                )}
                            </g>
                        );
                    }}
                >
                    {treemapData.map((_, i) => (
                        <Cell key={i} fill={palette[i % palette.length]} />
                    ))}
                </Treemap>
            );
            break;
        }

        // ---- FUNNEL ----
        case 'funnel': {
            const firstY = yAxes[0];
            const funnelData = rows.map((r, i) => ({
                name: String(r[xAxis] ?? ''),
                value: Math.max(0, Number(r[firstY] ?? 0)),
                fill: palette[i % palette.length],
            }));
            chartElement = (
                <FunnelChart accessibilityLayer>
                    <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        itemStyle={{ color: '#d4d4d8', fontSize: '11px' }}
                        formatter={(v: unknown) => [formatAxisValue(v), '']}
                        separator=""
                    />
                    <Funnel dataKey="value" data={funnelData} isAnimationActive>
                        <LabelList position="right" fill="#a1a1aa" stroke="none" fontSize={10} formatter={(v: unknown) => String(v)} />
                    </Funnel>
                </FunnelChart>
            );
            break;
        }

        // ---- HISTOGRAM ----
        case 'histogram': {
            const bins = buildHistogramBins(rows, xAxis);
            chartElement = (
                <BarChart data={bins} barCategoryGap="2%" accessibilityLayer margin={chartMargin}>
                    {sharedGrid}
                    <XAxis
                        dataKey="bin"
                        tick={{ fill: '#71717a', fontSize: 9 }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                        tickLine={false}
                        interval={3}
                        angle={-35}
                        textAnchor="end"
                        height={45}
                    />
                    {sharedYAxis}
                    <Tooltip
                        contentStyle={tooltipStyle}
                        labelStyle={tooltipLabelStyle}
                        formatter={(v: unknown) => [formatAxisValue(v), 'Count']}
                    />
                    <Bar dataKey="count" fill={palette[0]} radius={[3, 3, 0, 0]} />
                </BarChart>
            );
            break;
        }

        // ---- HEATMAP (table-based) ----
        case 'heatmap': {
            return <HeatmapTable spec={spec} palette={palette} />;
        }

        // ---- FALLBACK ----
        default: {
            // Unknown chart type — fall back to a simple bar chart
            chartElement = (
                <BarChart data={rows} accessibilityLayer margin={chartMargin}>
                    {sharedGrid}
                    {sharedXAxis}
                    {seriesYAxes}
                    {sharedTooltip}
                    <Bar dataKey={yAxes[0]} yAxisId="left" fill={palette[0]} radius={[3, 3, 0, 0]} maxBarSize={60} />
                </BarChart>
            );
        }
    }

    // Compute chart width: container width minus horizontal padding (px-2 = 8px * 2)
    const chartWidth = Math.max(containerWidth - 16, 0);
    const chartHeight = CHART_HEIGHT - 20;

    return (
        <div ref={containerRef} className="mb-1 mt-3 min-w-0 w-full overflow-hidden rounded-md border border-ink-500 bg-ink-100 shadow-sm shadow-black/10">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-ink-500 px-4 py-3">
                <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-paper">
                        {title || `${humanizeAxisName(chartType)} chart`}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint">
                        <span className="rounded bg-ink-200 px-1.5 py-0.5">X · {xAxisLabel}</span>
                        <span className="rounded bg-ink-200 px-1.5 py-0.5">
                            Y · {yAxisLabels.join(' · ')}
                        </span>
                    </div>
                </div>
                <span className="rounded-full border border-ink-500 bg-ink-200 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-dim">
                    {rows.length.toLocaleString()} rows
                </span>
            </div>
            <div className="px-2 pb-2 pt-3" style={{ height: `${CHART_HEIGHT}px` }}>
                {chartWidth > 0 && (
                    <ResponsiveContainer width={chartWidth} height={chartHeight}>
                        {chartElement}
                    </ResponsiveContainer>
                )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-ink-500 px-4 py-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">
                    {chartType.replace(/_/g, ' ')}
                    {barFamilyTruncated
                        ? ` · Top ${BAR_MAX_CATEGORIES} of ${rows.length.toLocaleString()} rows`
                        : ` · ${rows.length.toLocaleString()} rows`}
                </span>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="rounded-xs p-1.5 text-paper-dim transition-colors hover:bg-ink-200 hover:text-paper"
                            aria-label="Download chart"
                        >
                            <Download className="h-3.5 w-3.5" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[180px] rounded-xs border-ink-500 bg-ink-100">
                        <DropdownMenuItem onClick={handleDownloadPng} className="cursor-pointer">
                            <Image className="mr-2 h-3.5 w-3.5" />
                            <span>Download as PNG</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleDownloadCsv} className="cursor-pointer">
                            <FileText className="mr-2 h-3.5 w-3.5" />
                            <span>Download data (CSV)</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleDownloadJson} className="cursor-pointer">
                            <FileText className="mr-2 h-3.5 w-3.5" />
                            <span>Download data (JSON)</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}

// ============================================
// Heatmap sub-component (table-based)
// ============================================

function HeatmapTable({ spec, palette }: { spec: ChartSpec; palette: string[] }): React.ReactElement {
    const { rows, xAxis, yAxis, title } = spec;
    const yAxes = resolveYAxes(yAxis);
    const cardRef = useRef<HTMLDivElement>(null);

    const baseName = sanitizeChartFilename(title);
    const timestamp = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');

    const handleDownloadPng = useCallback(async () => {
        const el = cardRef.current;
        if (!el) return;
        try {
            const dataUrl = await toPng(el, {
                cacheBust: true,
                backgroundColor: '#1a1c24',
                pixelRatio: 2,
            });
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `${baseName}-${timestamp()}.png`;
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (err) {
            log.error('AiChartRenderer error', err);
            toast.error('Failed to capture chart as image. Please try again.');
        }
    }, [baseName]);

    const handleDownloadCsv = useCallback(() => {
        if (!rows.length) return;
        const prepared = rows.map(prepareRowForCsv);
        const csv = Papa.unparse(prepared, { quotes: true, quoteChar: '"', escapeChar: '"' });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}-data-${timestamp()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [rows, baseName]);

    const handleDownloadJson = useCallback(() => {
        if (!rows.length) return;
        const json = JSON.stringify(rows, null, 2);
        const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}-data-${timestamp()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, [rows, baseName]);

    // Find numeric range for colour scaling
    const allValues = rows.flatMap((r) => yAxes.map((col) => Number(r[col] ?? 0)));
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const range = max - min || 1;

    // Map a value in [min,max] to an rgba colour using the first palette colour
    function cellColor(value: number): string {
        const intensity = (value - min) / range;
        // Convert hex colour to rgba with opacity proportional to intensity
        const hex = palette[0].replace('#', '');
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${0.1 + intensity * 0.7})`;
    }

    return (
        <div ref={cardRef} className="mb-1 mt-3 overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
            {title && (
                <div className="border-b border-ink-500 px-4 pb-1 pt-3 text-xs font-semibold text-paper">
                    {title}
                </div>
            )}
            <div className="max-h-[280px] overflow-x-auto overflow-y-auto p-3">
                <table className="w-full border-collapse text-[10px]">
                    <thead>
                        <tr>
                            <th className="whitespace-nowrap pb-1 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">{xAxis}</th>
                            {yAxes.map((col) => (
                                <th key={col} className="whitespace-nowrap px-2 pb-1 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">{col}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.slice(0, 50).map((r, i) => (
                            <tr key={i}>
                                <td className="whitespace-nowrap py-0.5 pr-3 text-paper-muted">
                                    {String(r[xAxis] ?? '').slice(0, 20)}
                                </td>
                                {yAxes.map((col) => {
                                    const val = Number(r[col] ?? 0);
                                    return (
                                        <td
                                            key={col}
                                            className="rounded px-2 py-0.5 text-center font-mono"
                                            style={{ backgroundColor: cellColor(val), color: '#e4e4e7' }}
                                        >
                                            {formatAxisValue(val)}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="flex items-center justify-between gap-2 px-4 pb-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">
                    heatmap · {rows.length.toLocaleString()} rows
                </span>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="rounded-xs p-1.5 text-paper-dim transition-colors hover:bg-ink-200 hover:text-paper"
                            aria-label="Download chart"
                        >
                            <Download className="h-3.5 w-3.5" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[180px] rounded-xs border-ink-500 bg-ink-100">
                        <DropdownMenuItem onClick={handleDownloadPng} className="cursor-pointer">
                            <Image className="mr-2 h-3.5 w-3.5" />
                            <span>Download as PNG</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleDownloadCsv} className="cursor-pointer">
                            <FileText className="mr-2 h-3.5 w-3.5" />
                            <span>Download data (CSV)</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleDownloadJson} className="cursor-pointer">
                            <FileText className="mr-2 h-3.5 w-3.5" />
                            <span>Download data (JSON)</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}

export default AiChartRenderer;
