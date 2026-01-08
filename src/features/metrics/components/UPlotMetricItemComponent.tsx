import React, { useRef, useEffect } from "react";
import uPlot from "uplot";

interface MetricData {
  timestamps: number[];
  values: number[];
}

interface UPlotMetricItemComponentProps {
  data: MetricData;
  title: string;
}

const UPlotMetricItemComponent: React.FC<UPlotMetricItemComponentProps> = ({
  data,
  title,
}) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!chartRef.current || !data.timestamps.length) return;

    const opts: uPlot.Options = {
      width: chartRef.current.clientWidth,
      height: chartRef.current.clientHeight - 20,
      title: "",
      cursor: {
        show: true,
        points: {
          show: true,
        },
      },
      legend: {
        show: false,
      },
      scales: {
        x: {
          time: true,
        },
        y: {
          auto: true,
        },
      },
      axes: [
        {
          stroke: "#666",
          grid: {
            stroke: "#333",
          },
          ticks: {
            stroke: "#444",
          },
        },
        {
          stroke: "#666",
          grid: {
            stroke: "#333",
          },
          ticks: {
            stroke: "#444",
          },
        },
      ],
      series: [
        {},
        {
          label: title,
          stroke: "#a855f7",
          fill: "rgba(168, 85, 247, 0.1)",
          width: 2,
        },
      ],
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
          height: chartRef.current.clientHeight - 20,
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
  }, [data, title]);

  if (!data.timestamps.length) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        No data available
      </div>
    );
  }

  return <div ref={chartRef} className="w-full h-full" />;
};

export default UPlotMetricItemComponent;
