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
    tooltipStyle,
    tooltipLabelStyle,
} from './AiChartUtils';
import { toast } from 'sonner';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, Image, FileText } from 'lucide-react';
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
    const { chartType, title, rows, xAxis, yAxis, colorScheme } = spec;
    const [containerRef, containerWidth] = useContainerWidth();

    const palette = useMemo(() => buildColorPalette(colorScheme), [colorScheme]);
    const yAxes = useMemo(() => resolveYAxes(yAxis), [yAxis]);

    if (!rows || rows.length === 0) {
        return (
            <div className="flex items-center justify-center h-24 text-xs text-zinc-500">
                No data to display
            </div>
        );
    }

    const sharedXAxis = (
        <XAxis
            dataKey={xAxis}
            tick={{ fill: '#71717a', fontSize: 10 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
            tickLine={false}
            tickFormatter={(v: unknown) => {
                const str = String(v);
                return str.length > 12 ? str.slice(0, 11) + '…' : str;
            }}
        />
    );

    const sharedYAxis = (
        <YAxis
            tick={{ fill: '#71717a', fontSize: 10 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
            tickLine={false}
            tickFormatter={formatAxisValue}
            width={55}
        />
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
                yAxes.length > 1 ? (name ?? '') : ''
            ]}
            separator={yAxes.length > 1 ? ': ' : ''}
            cursor={false}
        />
    );

    const sharedLegend = yAxes.length > 1 ? (
        <Legend
            wrapperStyle={{ fontSize: '10px', color: '#71717a', paddingTop: '8px' }}
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
            console.error(err);
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

    const CHART_HEIGHT = 260;

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
                <BarChart data={displayRows}>
                    {sharedGrid}
                    {sharedXAxis}
                    {sharedYAxis}
                    {sharedTooltip}
                    {sharedLegend}
                    {yAxes.map((col, i) => (
                        <Bar
                            key={col}
                            dataKey={col}
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
                <BarChart data={displayRows} barCategoryGap="25%">
                    {sharedGrid}
                    {sharedXAxis}
                    {sharedYAxis}
                    {sharedTooltip}
                    {sharedLegend}
                    {yAxes.map((col, i) => (
                        <Bar
                            key={col}
                            dataKey={col}
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
                <BarChart data={displayRows} layout="vertical">
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
                <LineChart data={rows}>
                    {sharedGrid}
                    {sharedXAxis}
                    {sharedYAxis}
                    {sharedTooltip}
                    {sharedLegend}
                    {yAxes.map((col, i) => (
                        <Line
                            key={col}
                            type="monotone"
                            dataKey={col}
                            stroke={palette[i % palette.length]}
                            strokeWidth={2}
                            dot={rows.length <= 50}
                            activeDot={{ r: 4 }}
                        />
                    ))}
                </LineChart>
            );
            break;
        }

        // ---- AREA / STACKED AREA ----
        case 'area':
        case 'stacked_area': {
            const isStacked = chartType === 'stacked_area';
            chartElement = (
                <AreaChart data={rows}>
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
                    {sharedYAxis}
                    {sharedTooltip}
                    {sharedLegend}
                    {yAxes.map((col, i) => (
                        <Area
                            key={col}
                            type="monotone"
                            dataKey={col}
                            stroke={palette[i % palette.length]}
                            strokeWidth={2}
                            fill={`url(#grad-${i})`}
                            stackId={isStacked ? 'a' : undefined}
                        />
                    ))}
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
                <PieChart>
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
                <PieChart>
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
                <ScatterChart>
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
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
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
                <FunnelChart>
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
                <BarChart data={bins} barCategoryGap="2%">
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
                <BarChart data={rows}>
                    {sharedGrid}
                    {sharedXAxis}
                    {sharedYAxis}
                    {sharedTooltip}
                    <Bar dataKey={yAxes[0]} fill={palette[0]} radius={[3, 3, 0, 0]} maxBarSize={60} />
                </BarChart>
            );
        }
    }

    // Compute chart width: container width minus horizontal padding (px-2 = 8px * 2)
    const chartWidth = Math.max(containerWidth - 16, 0);
    const chartHeight = CHART_HEIGHT - 20;

    return (
        <div ref={containerRef} className="mt-3 mb-1 rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden min-w-[320px]">
            {title && (
                <div className="px-4 pt-3 pb-1 text-xs font-semibold text-zinc-300 border-b border-white/[0.05]">
                    {title}
                </div>
            )}
            <div className="px-2 pt-3 pb-2" style={{ height: `${CHART_HEIGHT}px` }}>
                {chartWidth > 0 && (
                    <ResponsiveContainer width={chartWidth} height={chartHeight}>
                        {chartElement}
                    </ResponsiveContainer>
                )}
            </div>
            <div className="px-4 pb-2 flex items-center justify-between gap-2">
                <span className="text-[9px] text-zinc-700 uppercase tracking-wider">
                    {chartType.replace(/_/g, ' ')}
                    {barFamilyTruncated
                        ? ` · Top ${BAR_MAX_CATEGORIES} of ${rows.length.toLocaleString()} rows`
                        : ` · ${rows.length.toLocaleString()} rows`}
                </span>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors"
                            aria-label="Download chart"
                        >
                            <Download className="w-3.5 h-3.5" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-[#1a1c24] border-white/10 min-w-[180px]">
                        <DropdownMenuItem onClick={handleDownloadPng} className="cursor-pointer">
                            <Image className="w-3.5 h-3.5 mr-2" />
                            <span>Download as PNG</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleDownloadCsv} className="cursor-pointer">
                            <FileText className="w-3.5 h-3.5 mr-2" />
                            <span>Download data (CSV)</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleDownloadJson} className="cursor-pointer">
                            <FileText className="w-3.5 h-3.5 mr-2" />
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
            console.error(err);
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
        <div ref={cardRef} className="mt-3 mb-1 rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
            {title && (
                <div className="px-4 pt-3 pb-1 text-xs font-semibold text-zinc-300 border-b border-white/[0.05]">
                    {title}
                </div>
            )}
            <div className="overflow-x-auto max-h-[280px] overflow-y-auto p-3">
                <table className="text-[10px] border-collapse w-full">
                    <thead>
                        <tr>
                            <th className="text-zinc-500 text-left pr-3 pb-1 font-medium whitespace-nowrap">{xAxis}</th>
                            {yAxes.map((col) => (
                                <th key={col} className="text-zinc-500 pb-1 font-medium whitespace-nowrap px-2 text-center">{col}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.slice(0, 50).map((r, i) => (
                            <tr key={i}>
                                <td className="text-zinc-400 pr-3 py-0.5 whitespace-nowrap">
                                    {String(r[xAxis] ?? '').slice(0, 20)}
                                </td>
                                {yAxes.map((col) => {
                                    const val = Number(r[col] ?? 0);
                                    return (
                                        <td
                                            key={col}
                                            className="text-center px-2 py-0.5 rounded font-mono"
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
            <div className="px-4 pb-2 flex items-center justify-between gap-2">
                <span className="text-[9px] text-zinc-700 uppercase tracking-wider">
                    heatmap · {rows.length.toLocaleString()} rows
                </span>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors"
                            aria-label="Download chart"
                        >
                            <Download className="w-3.5 h-3.5" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-[#1a1c24] border-white/10 min-w-[180px]">
                        <DropdownMenuItem onClick={handleDownloadPng} className="cursor-pointer">
                            <Image className="w-3.5 h-3.5 mr-2" />
                            <span>Download as PNG</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleDownloadCsv} className="cursor-pointer">
                            <FileText className="w-3.5 h-3.5 mr-2" />
                            <span>Download data (CSV)</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleDownloadJson} className="cursor-pointer">
                            <FileText className="w-3.5 h-3.5 mr-2" />
                            <span>Download data (JSON)</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}

export default AiChartRenderer;
