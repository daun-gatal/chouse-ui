import React from "react";
import { Clock, Database, HardDrive } from "lucide-react";

interface QueryStatistics {
  elapsed: number;
  rows_read: number;
  bytes_read: number;
}

interface EmptyQueryResultProps {
  statistics: QueryStatistics;
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

const formatTime = (seconds: number): string => `${(seconds * 1000).toFixed(2)} ms`;

const EmptyQueryResult: React.FC<EmptyQueryResultProps> = ({ statistics }) => {
  const items = [
    { icon: Clock, label: "Execution time", value: formatTime(statistics.elapsed) },
    { icon: Database, label: "Rows read", value: statistics.rows_read.toLocaleString() },
    { icon: HardDrive, label: "Data read", value: formatBytes(statistics.bytes_read) },
  ];

  return (
    <div className="flex h-full items-center justify-center bg-ink-50 p-8">
      <div className="w-full max-w-xl">
        <div className="flex flex-col gap-3 border-b border-ink-500 pb-6">
          <span className="inline-flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
            <span className="h-px w-6 bg-ink-700" aria-hidden />
            <span>Query result</span>
          </span>
          <h3 className="text-xl font-semibold tracking-tight text-paper">
            No rows returned.{" "}
            <span className="text-paper-dim">Query ran cleanly.</span>
          </h3>
        </div>

        <dl className="mt-6 grid grid-cols-3 border-l border-t border-ink-500">
          {items.map(({ icon: Icon, label, value }) => (
            <div
              key={label}
              className="flex flex-col gap-2 border-b border-r border-ink-500 px-4 py-4"
            >
              <div className="flex items-center justify-between">
                <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                  {label}
                </dt>
                <Icon className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
              </div>
              <dd className="font-mono text-[18px] font-semibold leading-none text-paper">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-6 text-sm leading-relaxed text-paper-muted">
          Try modifying your query or check the table's contents to ensure there's data to retrieve.
        </p>
      </div>
    </div>
  );
};

export default EmptyQueryResult;
