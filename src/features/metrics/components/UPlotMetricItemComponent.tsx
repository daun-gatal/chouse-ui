import React, { useRef, useEffect, useState } from "react";
import uPlot from "uplot";
import { formatBytes, formatCompactNumber } from "@/lib/utils";

interface MetricData {
  timestamps: number[];
  values: number[][]; // Multiple series
  labels?: string[];
  colors?: string[];
}

interface UPlotMetricItemComponentProps {
  data: MetricData;
  title: string; // Used as unit label (e.g., "Bytes", "Rows/s")
  colors?: string[];
  fill?: string | ((u: uPlot) => CanvasGradient | string);
  unit?: string;
  height?: number;
}

const UPlotMetricItemComponent: React.FC<UPlotMetricItemComponentProps> = ({
  data,
  title,
  colors = ["#a855f7"], // Default color if not provided
  fill,
  unit = "",
  height,
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const [hoveredValues, setHoveredValues] = useState<{ time: string; values: { label: string; value: string; color: string }[] } | null>(null);

  // Helper to format values based on title/unit
  const formatValue = (val: number) => {
    if (val === undefined || val === null) return "-";
    if (title.includes("Bytes")) return formatBytes(val);
    if (title.includes("%")) return `${val.toFixed(1)}%`;
    if (title.includes("ms")) return `${val.toFixed(1)}ms`;
    if (title.includes("Connections") || title === "Conn") return Math.round(val).toString();
    // For metrics that commonly have small decimal values, use fixed precision
    if (title === "Cores" || title === "Load" || title === "Txn/s" || title === "Delayed") {
      if (val < 0.01) return val.toFixed(4);
      if (val < 1) return val.toFixed(3);
      if (val < 100) return val.toFixed(2);
      return val.toFixed(1);
    }
    return formatCompactNumber(val);
  };

  useEffect(() => {
    if (!chartRef.current || !data.timestamps.length) return;

    // Get gradient colors based on refined logic
    const getGradientFill = (u: uPlot, color: string) => {
      // If explicit fill function provided, use it (only works well for single series usually)
      if (fill && typeof fill === 'function') return fill(u);

      // Default gradient
      const gradient = u.ctx.createLinearGradient(0, 0, 0, u.height);
      gradient.addColorStop(0, `${color}40`);
      gradient.addColorStop(1, `${color}05`);
      return gradient;
    };

    const chartHeight = height || (chartRef.current.clientHeight - 10);

    // Allow colors to be passed via data or props, fallback to default loop
    const seriesColors = data.colors || colors;
    const seriesLabels = data.labels || [title];

    const seriesConfig: uPlot.Series[] = [
      {}, // Time series
      ...data.values.map((_, i) => ({
        label: seriesLabels[i] || `Series ${i + 1}`,
        stroke: seriesColors[i % seriesColors.length] || "#a855f7",
        width: 2,
        fill: (u: uPlot) => getGradientFill(u, seriesColors[i % seriesColors.length] || "#a855f7"),
        points: { show: false },
        spanGaps: true,
      }))
    ];

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth,
      height: chartHeight,
      title: "",
      padding: [10, 10, 0, 0],
      cursor: {
        show: true,
        x: true,
        y: true,
        points: {
          show: true,
          size: 8,
          // fill: color, // Removed global fill
          stroke: "#fff",
          width: 2,
        },
        drag: {
          x: false,
          y: false,
        },
      },
      legend: {
        show: false,
      },
      focus: {
        alpha: 0.3,
      },
      scales: {
        x: {
          time: true,
        },
        y: {
          auto: true,
          range: (u, min, max) => {
            // Handle flat data
            if (min === max) {
              return [Math.max(0, min - 1), max + 1];
            }
            const pad = (max - min) * 0.1;
            const res = [Math.max(0, min - pad), max + pad] as [number, number];

            // For tasks/counts, ensure at least some breathing room
            if (title === "Tasks" || title === "Count" || title === "Reqs" || title === "Conn") {
              if (res[1] - res[0] < 1) res[1] = res[0] + 1;
            }

            return res;
          },
        },
      },
      axes: [
        {
          stroke: "rgba(255,255,255,0.3)",
          grid: {
            stroke: "rgba(255,255,255,0.05)",
            width: 1,
          },
          ticks: {
            stroke: "rgba(255,255,255,0.1)",
            width: 1,
            size: 5,
          },
          font: "11px Inter, system-ui, sans-serif",
          labelFont: "11px Inter, system-ui, sans-serif",
          values: (u, vals) => vals.map(v => {
            const date = new Date(v * 1000);
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          }),
        },
        {
          stroke: "rgba(255,255,255,0.3)",
          grid: {
            stroke: "rgba(255,255,255,0.05)",
            width: 1,
          },
          ticks: {
            stroke: "rgba(255,255,255,0.1)",
            width: 1,
            size: 5,
          },
          font: "11px Inter, system-ui, sans-serif",
          labelFont: "11px Inter, system-ui, sans-serif",
          size: 80,
          values: (u, vals) => vals.map(v => formatValue(v)),
        },
      ],
      series: seriesConfig,
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx !== null && idx !== undefined && data.timestamps[idx]) {
              const time = new Date(data.timestamps[idx] * 1000).toLocaleTimeString();
              const vals = data.values.map((series, i) => ({
                label: seriesLabels[i] || `Series ${i + 1}`,
                value: formatValue(series[idx]),
                color: seriesColors[i % seriesColors.length] || "#a855f7"
              }));
              setHoveredValues({ time, values: vals });
            } else {
              setHoveredValues(null);
            }
          },
        ],
      },
    };

    const plotData: uPlot.AlignedData = [
      data.timestamps,
      ...data.values,
    ] as any;

    if (uplotRef.current) {
      uplotRef.current.destroy();
    }

    uplotRef.current = new uPlot(opts, plotData, chartRef.current);

    const handleResize = () => {
      if (uplotRef.current && chartRef.current) {
        uplotRef.current.setSize({
          width: chartRef.current.clientWidth,
          height: height || (chartRef.current.clientHeight - 10),
        });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (uplotRef.current) {
        uplotRef.current.destroy();
      }
    };
  }, [data, title, colors, fill, height]);

  if (!data.timestamps.length) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        No data available
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {/* Hover tooltip */}
      {hoveredValues && (
        <div className="absolute top-2 right-2 z-10 px-3 py-2 rounded-lg bg-black/80 border border-white/10 backdrop-blur-md pointer-events-none">
          <div className="text-xs text-gray-400 mb-1">{hoveredValues.time}</div>
          <div className="flex flex-col gap-1">
            {hoveredValues.values.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: v.color }} />
                <span className="text-xs text-gray-300">{v.label}:</span>
                <span className="text-sm font-medium text-white">{v.value}{unit}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div ref={chartRef} className="w-full h-full" />
    </div>
  );
};

export default UPlotMetricItemComponent;
