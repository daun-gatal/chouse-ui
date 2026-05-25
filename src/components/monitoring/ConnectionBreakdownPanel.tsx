/**
 * ConnectionBreakdownPanel — the drill-down behind the "Active connections"
 * number. ClickHouse exposes connection *counts per protocol*, not a table of
 * individual sessions, so this panel shows exactly that composition: one row
 * per protocol with its share of the total. It's the deepest honest detail
 * available for that tile.
 */

import { useEffect, useMemo } from "react";
import { Network, AlertTriangle } from "lucide-react";

import { useConnectionBreakdown } from "@/hooks/useMonitoringTimeline";
import { cn } from "@/lib/utils";

interface ConnectionBreakdownPanelProps {
  refreshKey?: number;
  autoRefresh?: boolean;
}

export default function ConnectionBreakdownPanel({
  refreshKey = 0,
  autoRefresh = false,
}: ConnectionBreakdownPanelProps) {
  const { data = [], isLoading, error, refetch } = useConnectionBreakdown({
    refetchInterval: autoRefresh ? 15_000 : false,
  });

  useEffect(() => {
    if (refreshKey > 0) refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const total = useMemo(() => data.reduce((s, r) => s + r.count, 0), [data]);
  const max = useMemo(() => Math.max(1, ...data.map((r) => r.count)), [data]);

  return (
    <div className="rounded-xs border border-ink-500 bg-ink-100 p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
          <Network className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[14px] font-semibold tracking-tight text-paper">Connections</h3>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
            By protocol
          </p>
        </div>
        <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
          {isLoading ? "…" : <><span className="text-paper">{total}</span> active</>}
        </span>
      </div>

      {error ? (
        <div className="flex items-center gap-2 py-2 text-[12px] text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {error.message}
        </div>
      ) : (
        <div className="space-y-2.5">
          {(isLoading ? PLACEHOLDER : data).map((row) => {
            const widthPct = (row.count / max) * 100;
            const zero = row.count === 0;
            return (
              <div key={row.protocol} className="flex items-center gap-3">
                <span
                  className={cn(
                    "w-24 shrink-0 font-mono text-[11px] uppercase tracking-[0.14em]",
                    zero ? "text-paper-faint" : "text-paper-dim"
                  )}
                >
                  {row.protocol}
                </span>
                <span
                  className={cn(
                    "w-8 shrink-0 text-right font-mono text-[12px] tabular-nums",
                    zero ? "text-paper-faint" : "text-paper"
                  )}
                >
                  {row.count}
                </span>
                <div className="relative h-1.5 flex-1 overflow-hidden rounded-xs bg-ink-300">
                  {!zero && (
                    <div
                      className="absolute inset-y-0 left-0 rounded-xs bg-brand transition-[width] duration-500"
                      style={{ width: `${Math.max(3, widthPct)}%` }}
                      aria-hidden
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-5 border-t border-ink-500 pt-3 text-[11px] leading-[1.6] text-paper-faint">
        ClickHouse reports connection counts per protocol, not individual
        sessions. To see who's running queries right now, use the Live queries
        tab.
      </p>
    </div>
  );
}

// Stable rows so the skeleton/loading layout matches the loaded one.
const PLACEHOLDER = [
  { protocol: "TCP", count: 0 },
  { protocol: "HTTP", count: 0 },
  { protocol: "MySQL", count: 0 },
  { protocol: "PostgreSQL", count: 0 },
  { protocol: "Interserver", count: 0 },
];
