/**
 * FleetExceptionsFeed — consolidated feed of recent ClickHouse exceptions
 * across every node in the fleet.
 *
 * Each fleet card shows only its single latest exception; this merges the
 * last ~10 exceptions per node (carried in the snapshot's last_exception
 * payload) into one newest-first list so an operator can answer "what's
 * been breaking across my fleet in the last hour" at a glance.
 *
 * Reads from the snapshot data the page already fetched — no extra requests.
 */

import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import {
  useFleetExceptions,
  type FleetExceptionEntry,
} from "@/hooks/useFleetMetrics";
import { cn } from "@/lib/utils";

interface FleetExceptionsFeedProps {
  connections: { id: string; name: string }[];
  /** History window in hours — driven by the page's range picker. */
  hoursBack: number;
  /** Human label for the window (e.g. "1h", "6h", "24h"). */
  rangeLabel: string;
}

export default function FleetExceptionsFeed({
  connections,
  hoursBack,
  rangeLabel,
}: FleetExceptionsFeedProps) {
  const { entries, total, isFetching } = useFleetExceptions(connections, hoursBack, 30_000, 50);

  return (
    <section
      aria-label="Recent exceptions across the fleet"
      className="flex flex-col overflow-hidden rounded-md border border-ink-500 bg-ink-100"
    >
      <div className="flex items-center justify-between gap-3 border-b border-ink-500 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          </span>
          <div className="flex flex-col leading-tight">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
              Last {rangeLabel} · all nodes
            </span>
            <span className="text-[13px] font-medium text-paper">Recent exceptions</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isFetching && (
            <RefreshCw className="h-3.5 w-3.5 text-paper-dim motion-safe:animate-spin" aria-hidden />
          )}
          {total > 0 && (
            <span className="font-mono text-[11px] tabular-nums text-paper-muted">
              {total > entries.length ? `${entries.length} of ${total}` : total}
            </span>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
          <span className="grid h-9 w-9 place-items-center rounded-xs border border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
            <ShieldCheck className="h-4 w-4" aria-hidden />
          </span>
          <span className="text-[13px] text-paper">No exceptions</span>
          <span className="text-[12px] text-paper-muted">
            Every node has been clean for the last {rangeLabel}.
          </span>
        </div>
      ) : (
        <ul className="max-h-72 divide-y divide-ink-500 overflow-y-auto">
          {entries.map((e, i) => (
            <ExceptionRow key={`${e.connectionId}-${e.queryId}-${i}`} entry={e} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ExceptionRow({ entry }: { entry: FleetExceptionEntry }) {
  // event_time is 'YYYY-MM-DD HH:mm:ss' — show just the time portion to keep
  // rows tight; the feed is implicitly "last hour" so the date is redundant.
  const timePart = entry.eventTime.includes(" ")
    ? entry.eventTime.split(" ")[1]
    : entry.eventTime;

  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <span
        className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-xs border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
        title={`Exception code ${entry.exceptionCode}`}
      >
        <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
        #{entry.exceptionCode}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-mono text-[11px] font-medium text-paper">
            {entry.connectionName}
          </span>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-paper-dim">
            {timePart}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 break-words text-[11px] leading-snug text-paper-muted">
          {entry.exceptionPreview || "(no message)"}
        </p>
        {entry.user && (
          <span className="mt-0.5 inline-block font-mono text-[10px] uppercase tracking-[0.12em] text-paper-dim">
            {entry.user}
          </span>
        )}
      </div>
    </li>
  );
}
