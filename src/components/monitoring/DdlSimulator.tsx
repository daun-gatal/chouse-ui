import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Play } from "lucide-react";

import { simulateDdl, type DdlImpactEstimate } from "@/api/metrics";
import { cn, formatBytes, formatNumber } from "@/lib/utils";

const PLACEHOLDER = "ALTER TABLE db.table UPDATE col = 0 WHERE ts < '2024-01-01'";

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown";
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/**
 * DDL impact simulator — a read-only "what would this ALTER cost" estimator.
 * The server parses and estimates only (rows matched, parts/bytes rewritten,
 * duration, disk headroom); it NEVER runs the mutation. Existing CH UIs show
 * what's running — this shows the cost *before* you commit.
 */
export function DdlSimulator() {
  const [statement, setStatement] = useState("");

  const sim = useMutation<DdlImpactEstimate, Error, string>({
    mutationFn: (sql) => simulateDdl(sql),
  });

  const run = () => {
    const sql = statement.trim();
    if (sql) sim.mutate(sql);
  };

  const result = sim.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-ink-500 bg-ink-100 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
            ALTER … UPDATE / DELETE — estimate only, never executed
          </span>
        </div>
        <textarea
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
          }}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          rows={3}
          className="w-full resize-y rounded-xs border border-ink-500 bg-ink-200 px-3 py-2 font-mono text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:outline-none"
        />
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={run}
            disabled={!statement.trim() || sim.isPending}
            className={cn(
              "inline-flex items-center gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-paper transition-colors",
              "hover:bg-ink-300 disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            {sim.isPending ? "Estimating…" : "Simulate"}
          </button>
          <span className="font-mono text-[10px] tracking-[0.14em] text-paper-faint">⌘/Ctrl+Enter</span>
        </div>
      </div>

      {sim.isError && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
          <p className="text-[12px] text-red-300">{sim.error.message}</p>
        </div>
      )}

      {result && <EstimateCard result={result} />}
    </div>
  );
}

function EstimateCard({ result }: { result: DdlImpactEstimate }) {
  const affectedPct =
    result.total_rows > 0 ? (result.affected_rows / result.total_rows) * 100 : 0;

  return (
    <div className="rounded-md border border-ink-500 bg-ink-100">
      <div className="flex items-center justify-between border-b border-ink-500 px-4 py-2.5">
        <span className="font-mono text-[11px] text-paper">
          <span className="uppercase tracking-[0.14em] text-brand">{result.kind}</span>
          {" · "}
          {result.database}.{result.table}
        </span>
        {result.disk_sufficient ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            disk ok
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-red-400">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            insufficient disk
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-px bg-ink-500/40 md:grid-cols-4">
        <Stat
          label="Rows affected"
          value={formatNumber(result.affected_rows)}
          sub={`${affectedPct.toFixed(1)}% of ${formatNumber(result.total_rows)}`}
        />
        <Stat
          label="Parts rewritten"
          value={formatNumber(result.parts_to_rewrite)}
          sub={formatBytes(result.bytes_to_rewrite)}
        />
        <Stat
          label="Est. duration"
          value={formatDuration(result.est_duration_seconds)}
          sub={result.est_duration_seconds < 0 ? "no mutation history" : "at recent throughput"}
        />
        <Stat
          label="Disk free"
          value={formatBytes(result.disk_free_bytes)}
          sub={result.disk_sufficient ? "headroom ok" : "below rewrite size"}
          danger={!result.disk_sufficient}
        />
      </div>

      <p className="border-t border-ink-500 px-4 py-2.5 text-[11px] leading-[1.6] text-paper-muted">
        A mutation rewrites whole parts in the background. The estimate assumes all active
        parts are rewritten (worst case); partition-pruned predicates touch fewer. Nothing
        was executed.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  danger,
}: {
  label: string;
  value: string;
  sub: string;
  danger?: boolean;
}) {
  return (
    <div className="bg-ink-100 px-4 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">{label}</div>
      <div className={cn("mt-1 font-mono text-[16px] font-semibold tabular-nums", danger ? "text-red-400" : "text-paper")}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-paper-muted">{sub}</div>
    </div>
  );
}
