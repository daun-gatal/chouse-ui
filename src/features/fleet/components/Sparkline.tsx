/**
 * Sparkline — tiny inline trend, no axes/grid/labels.
 *
 * Hand-rolled SVG polyline (lighter than a recharts instance per card) for
 * the memory-% mini trend shown in each fleet card / compact row. Nulls
 * (gaps where a node had no snapshot) break the line into segments.
 */

import { useId } from "react";

interface SparklineProps {
  series: { time: number; value: number | null }[];
  color?: string;
  width?: number;
  height?: number;
  /** Fixed max for the y-scale (e.g. 100 for memory %). When omitted, scales
   *  to the data's own max. */
  domainMax?: number;
  className?: string;
  ariaLabel?: string;
}

export default function Sparkline({
  series,
  color = "var(--brand, #ffcc01)",
  width = 96,
  height = 24,
  domainMax,
  className,
  ariaLabel,
}: SparklineProps) {
  const gradId = useId();
  const values = series.map((p) => p.value).filter((v): v is number => v != null);

  if (values.length < 2) {
    // Not enough points to draw — render a flat baseline so the layout
    // doesn't jump once data arrives.
    return (
      <svg
        width={width}
        height={height}
        className={className}
        role="img"
        aria-label={ariaLabel ?? "no trend yet"}
      >
        <line
          x1={0}
          y1={height - 1}
          x2={width}
          y2={height - 1}
          stroke="var(--color-ink-500, #e7e5e0)"
          strokeWidth={1}
        />
      </svg>
    );
  }

  const max = domainMax ?? Math.max(...values, 1);
  const min = 0;
  const range = max - min || 1;
  const n = series.length;
  const pad = 1.5;
  const innerH = height - pad * 2;

  const x = (i: number) => (n === 1 ? 0 : (i / (n - 1)) * width);
  const y = (v: number) => pad + innerH - ((v - min) / range) * innerH;

  // Build path segments, breaking on nulls.
  const segments: string[] = [];
  let current: string[] = [];
  series.forEach((p, i) => {
    if (p.value == null) {
      if (current.length) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${current.length === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`);
  });
  if (current.length) segments.push(current.join(" "));

  const lastValue = values[values.length - 1];
  const lastIdx = (() => {
    for (let i = series.length - 1; i >= 0; i--) if (series[i].value != null) return i;
    return n - 1;
  })();

  return (
    <svg
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={ariaLabel ?? `trend, latest ${lastValue.toFixed(0)}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* Soft area fill under the last continuous segment for a touch of depth */}
      {segments.length > 0 && (
        <path
          d={`${segments[segments.length - 1]} L ${x(lastIdx).toFixed(1)} ${height} L 0 ${height} Z`}
          fill={`url(#${gradId})`}
          stroke="none"
        />
      )}
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={color} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {/* Dot on the latest point */}
      <circle cx={x(lastIdx)} cy={y(lastValue)} r={1.6} fill={color} />
    </svg>
  );
}
