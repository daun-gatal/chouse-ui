import React from "react";
import { Clock, Database, FileText } from "lucide-react";

interface StatisticsProps {
  statistics: {
    elapsed: number;
    rows_read: number;
    bytes_read: number;
  } | null;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

const formatTime = (seconds: number): string => {
  if (seconds < 0.001) return `${(seconds * 1_000_000).toFixed(2)} μs`;
  if (seconds < 1) return `${(seconds * 1000).toFixed(2)} ms`;
  return `${seconds.toFixed(2)} s`;
};

const StatisticsDisplay: React.FC<StatisticsProps> = ({ statistics }) => {
  if (!statistics) return null;

  const stats = [
    {
      title: "Query time",
      value: formatTime(statistics.elapsed),
      icon: Clock,
      description: "Total execution time",
    },
    {
      title: "Rows read",
      value: statistics.rows_read.toLocaleString(),
      icon: FileText,
      description: "Number of rows processed",
    },
    {
      title: "Data processed",
      value: formatBytes(statistics.bytes_read),
      icon: Database,
      description: "Volume of data read",
    },
  ];

  return (
    <div className="grid grid-cols-1 border-l border-t border-ink-500 md:grid-cols-3">
      {stats.map((stat) => (
        <div
          key={stat.title}
          className="flex flex-col gap-3 border-b border-r border-ink-500 px-5 py-5"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
              {stat.title}
            </span>
            <stat.icon className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
          </div>
          <span className="font-mono text-[22px] font-semibold leading-none text-paper">
            {stat.value}
          </span>
          <span className="text-[12px] text-paper-muted">{stat.description}</span>
        </div>
      ))}
    </div>
  );
};

export default StatisticsDisplay;
