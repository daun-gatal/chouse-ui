import React, { useRef, useEffect, useState } from "react";
import uPlot from "uplot";

interface MetricData {
  timestamps: number[];
  values: number[];
}

interface UPlotMetricItemComponentProps {
  data: MetricData;
  title: string;
  color?: string;
}

const UPlotMetricItemComponent: React.FC<UPlotMetricItemComponentProps> = ({
  data,
  title,
  color = "#a855f7",
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const [hoveredValue, setHoveredValue] = useState<{ time: string; value: string } | null>(null);

  useEffect(() => {
    if (!chartRef.current || !data.timestamps.length) return;

    // Get gradient colors based on main color
    const getGradientFill = (u: uPlot) => {
      const gradient = u.ctx.createLinearGradient(0, 0, 0, u.height);
      gradient.addColorStop(0, `${color}40`);
      gradient.addColorStop(1, `${color}05`);
      return gradient;
    };

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth,
      height: chartRef.current.clientHeight - 10,
      title: "",
      padding: [10, 10, 0, 0],
      cursor: {
        show: true,
        x: true,
        y: true,
        points: {
          show: true,
          size: 8,
          fill: color,
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
            const pad = (max - min) * 0.1;
            return [Math.max(0, min - pad), max + pad];
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
          size: 50,
        },
      ],
      series: [
        {},
        {
          label: title,
          stroke: color,
          fill: (u) => getGradientFill(u),
          width: 2,
          points: {
            show: false,
          },
          spanGaps: true,
        },
      ],
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx !== null && idx !== undefined && data.timestamps[idx]) {
              const time = new Date(data.timestamps[idx] * 1000).toLocaleTimeString();
              const value = data.values[idx]?.toFixed(2) || "0";
              setHoveredValue({ time, value });
            } else {
              setHoveredValue(null);
            }
          },
        ],
      },
    };

    const plotData: uPlot.AlignedData = [
      data.timestamps,
      data.values,
    ];

    if (uplotRef.current) {
      uplotRef.current.destroy();
    }

    uplotRef.current = new uPlot(opts, plotData, chartRef.current);

    const handleResize = () => {
      if (uplotRef.current && chartRef.current) {
        uplotRef.current.setSize({
          width: chartRef.current.clientWidth,
          height: chartRef.current.clientHeight - 10,
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
  }, [data, title, color]);

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
      {hoveredValue && (
        <div className="absolute top-2 right-2 z-10 px-3 py-1.5 rounded-lg bg-black/80 border border-white/10 backdrop-blur-md">
          <div className="text-xs text-gray-400">{hoveredValue.time}</div>
          <div className="text-sm font-medium text-white">{hoveredValue.value} {title}</div>
        </div>
      )}
      <div ref={chartRef} className="w-full h-full" />
    </div>
  );
};

export default UPlotMetricItemComponent;
