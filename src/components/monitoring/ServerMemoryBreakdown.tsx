import { useMemo } from "react";
import { MemoryStick } from "lucide-react";

import { useServerMemoryBreakdown } from "@/hooks/useMonitoringTimeline";
import { cn, formatBytes } from "@/lib/utils";

/**
 * "Where did the RAM go?" card. Top row shows the OS view —
 * total / used by ClickHouse / free. The stacked bar below decomposes
 * ClickHouse's RSS into attributable slices (caches, merges, in-flight
 * queries, index data) so an operator can answer "kepakai apa".
 */
export function ServerMemoryBreakdown() {
  const { data, isLoading, error } = useServerMemoryBreakdown();

  const slices = useMemo(() => {
    if (!data) return [];
    const rss = data.clickhouse_rss_bytes;
    if (rss <= 0) return [];
    const named = [
      { key: "active", label: "Active queries", value: data.active_queries_bytes, color: "#ffcc01" },
      { key: "mark", label: "Mark cache", value: data.mark_cache_bytes, color: "#34d399" },
      { key: "uncomp", label: "Uncompressed cache", value: data.uncompressed_cache_bytes, color: "#22d3ee" },
      { key: "merges", label: "Merges / mutations", value: data.merges_mutations_bytes, color: "#f59e0b" },
      { key: "pk", label: "Primary keys", value: data.primary_key_bytes, color: "#a855f7" },
      { key: "idx", label: "Index granularity", value: data.index_granularity_bytes, color: "#ec4899" },
    ];
    const accounted = named.reduce((sum, s) => sum + Math.max(0, s.value), 0);
    const other = Math.max(0, rss - accounted);
    return [
      ...named.map((s) => ({ ...s, value: Math.max(0, s.value) })),
      { key: "other", label: "Other (runtime + bg)", value: other, color: "#94a3b8" },
    ];
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 rounded-xs border border-ink-500 bg-ink-100 px-4 py-4">
        <Header />
        <div className="h-4 w-full animate-pulse rounded-xs bg-ink-300" />
        <div className="h-12 w-full animate-pulse rounded-xs bg-ink-300" />
      </div>
    );
  }

  if (error || !data || data.total_bytes === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-xs border border-ink-500 bg-ink-100 px-4 py-4">
        <Header />
        <p className="text-[12px] text-paper-muted">
          {error ? `Couldn't load memory breakdown — ${error.message}` : "Memory metrics aren't available on this server."}
        </p>
      </div>
    );
  }

  const used = data.clickhouse_rss_bytes;
  const total = data.total_bytes;
  const free = Math.max(0, total - used);
  const usedPct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const usedPctRounded = Math.round(usedPct);

  // Stacked bar segments — each slice as % of ClickHouse RSS
  const totalForBar = slices.reduce((s, x) => s + x.value, 0) || 1;

  return (
    <div className="flex flex-col gap-4 rounded-xs border border-ink-500 bg-ink-100 px-4 py-4">
      <Header />

      {/* Top: server-level totals */}
      <div className="grid grid-cols-3 gap-3 border-y border-ink-500 py-3">
        <Stat label="Server RAM" value={formatBytes(total)} />
        <Stat
          label="Used by ClickHouse"
          value={formatBytes(used)}
          hint={`${usedPctRounded}% of total`}
          emphasis
        />
        <Stat label="Free for OS" value={formatBytes(free)} />
      </div>

      {/* Breakdown bar */}
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
            What ClickHouse is using {formatBytes(used)} for
          </span>
          <span className="font-mono text-[10px] text-paper-faint">
            sum of slices · {formatBytes(totalForBar)}
          </span>
        </div>
        <div className="flex h-3 w-full overflow-hidden rounded-xs border border-ink-500 bg-ink-200">
          {slices.map((s) => {
            const pct = (s.value / totalForBar) * 100;
            if (pct <= 0) return null;
            return (
              <div
                key={s.key}
                title={`${s.label} · ${formatBytes(s.value)} (${pct.toFixed(1)}%)`}
                style={{ width: `${pct}%`, backgroundColor: s.color }}
              />
            );
          })}
        </div>

        {/* Legend / table */}
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-2 lg:grid-cols-3">
          {slices.map((s) => {
            const pct = (s.value / totalForBar) * 100;
            return (
              <li key={s.key} className="flex items-center gap-2 text-[12px]">
                <span
                  className="h-2 w-2.5 shrink-0 rounded-xs"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                <span className="flex-1 truncate text-paper-muted">{s.label}</span>
                <span className="font-mono tabular-nums text-paper">{formatBytes(s.value) || "0 B"}</span>
                <span className="w-12 text-right font-mono text-[10px] tabular-nums text-paper-faint">
                  {pct >= 0.05 ? `${pct.toFixed(1)}%` : "—"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-7 w-7 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
        <MemoryStick className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="flex flex-col leading-tight">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
          Memory · where it went
        </span>
        <span className="text-[13px] font-medium text-paper">Server memory breakdown</span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
        {label}
      </span>
      <span
        className={cn(
          "font-mono leading-tight tabular-nums",
          emphasis ? "text-[20px] font-semibold text-paper" : "text-[16px] text-paper"
        )}
      >
        {value || "0 B"}
      </span>
      {hint && (
        <span className="font-mono text-[10px] text-paper-faint">{hint}</span>
      )}
    </div>
  );
}
