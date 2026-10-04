/**
 * Monitoring › Performance (ADR 0016 §9): every query shape against its own
 * 14-day baseline, regressions lined up with the version, DDL, settings and
 * writer changes around them, per-replica series and EXPLAIN comparison.
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { GitCompare, Loader2, TrendingDown } from "lucide-react";

import { explainFingerprint, type Regression } from "@/api/observe";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useChartColors } from "@/hooks/useChartColors";
import { RBAC_PERMISSIONS, useAuthStore, useRbacStore } from "@/stores";
import { observeKeys, useFingerprintSeries, useMyConnections, usePerformance } from "./hooks";
import { formatAgo, formatBytes, formatCount, humanize } from "./lib";
import { DataTable, EmptyState, ErrorState, Kpi, LoadingGrid, Mono, OBS_LABEL, Panel, StatusPill } from "./ui";

const REPLICA_COLORS = ["#ffcc01", "#60a5fa", "#34d399", "#f87171", "#a78bfa", "#fb923c"];

function metricValue(metric: string, value: number): string {
  return metric.includes("bytes") ? formatBytes(value) : metric.includes("ms") || metric === "p95" || metric === "p50" ? `${formatCount(value)} ms` : formatCount(value);
}

/** Per-hour p95 by replica, pivoted for recharts. */
export function pivotSeries(points: Array<{ hour: number; replica: string; p95: number | null }>): { rows: Array<Record<string, number>>; replicas: string[] } {
  const replicas = [...new Set(points.map((p) => p.replica))].sort();
  const byHour = new Map<number, Record<string, number>>();
  for (const p of points) {
    if (p.p95 === null) continue;
    const row = byHour.get(p.hour) ?? { hour: p.hour };
    row[p.replica] = p.p95;
    byHour.set(p.hour, row);
  }
  return { rows: [...byHour.values()].sort((a, b) => a.hour - b.hour), replicas };
}

function RegressionDetail({ regression }: { regression: Regression }): ReactElement {
  const colors = useChartColors();
  const series = useFingerprintSeries(regression.fingerprint);
  const canExplain = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.QUERY_HISTORY_VIEW_ALL));
  const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
  const connections = useMyConnections(canExplain);
  const [compare, setCompare] = useState<string>("none");
  const [plans, setPlans] = useState<Record<string, string[]>>();
  const [explaining, setExplaining] = useState(false);
  const chart = useMemo(() => pivotSeries(series.data ?? []), [series.data]);

  const explain = async (): Promise<void> => {
    setExplaining(true);
    try {
      setPlans((await explainFingerprint(regression.fingerprint, compare === "none" ? undefined : compare)).plans);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "EXPLAIN failed");
    } finally {
      setExplaining(false);
    }
  };

  return (
    <Panel title={`${humanize(regression.metric)} ${regression.ratio.toFixed(1)}× slower`} meta={`${regression.replica} · since ${new Date(regression.onsetAt).toLocaleString()}`}>
      {regression.sampleQuery && <pre className="mb-3 max-h-28 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[10px] text-paper">{regression.sampleQuery}</pre>}
      {chart.rows.length < 2 ? (
        <p className="text-[11px] text-paper-muted">{series.isLoading ? "Loading series…" : "Not enough hourly history for this shape."}</p>
      ) : (
        <div className="h-52 w-full" role="img" aria-label="p95 latency per replica">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart.rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="hour" tickFormatter={(v: number) => new Date(v).toLocaleDateString([], { month: "short", day: "numeric" })} tick={{ fill: colors.tick, fontSize: 10 }} stroke={colors.grid} minTickGap={40} />
              <YAxis tickFormatter={(v: number) => `${formatCount(v)}ms`} tick={{ fill: colors.tick, fontSize: 10 }} stroke={colors.grid} width={56} />
              <Tooltip contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 2, fontSize: 11 }} labelStyle={{ color: colors.tooltipLabel }} labelFormatter={(v: number) => new Date(v).toLocaleString()} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {chart.replicas.map((r, i) => <Line key={r} dataKey={r} stroke={REPLICA_COLORS[i % REPLICA_COLORS.length]} dot={false} strokeWidth={1.5} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {regression.linkedChanges.length > 0 && (
        <>
          <p className={`${OBS_LABEL} mt-3`}>Changes around the onset</p>
          <ul className="mt-1 space-y-1">{regression.linkedChanges.map((c, i) => <li key={i} className="text-[12px] text-paper">• {c.kind ? `${humanize(c.kind)}: ` : ""}{c.summary ?? ""}</li>)}</ul>
        </>
      )}
      {canExplain && regression.sampleQuery && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <span className={OBS_LABEL}>Compare with</span>
            <Select value={compare} onValueChange={setCompare}>
              <SelectTrigger className="mt-1 h-8 w-56 rounded-xs text-[11px]" aria-label="Compare with connection"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">This connection only</SelectItem>
                {(connections.data ?? []).filter((c) => c.id !== activeConnectionId).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" className="h-8 rounded-xs text-[11px]" disabled={explaining} onClick={() => void explain()}>
            {explaining ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <GitCompare className="mr-1.5 h-3 w-3" />}EXPLAIN indexes
          </Button>
        </div>
      )}
      {plans && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {Object.entries(plans).map(([id, lines]) => (
            <div key={id}>
              <p className={OBS_LABEL}>{(connections.data ?? []).find((c) => c.id === id)?.name ?? (id === activeConnectionId ? "This connection" : id)}</p>
              <pre className="mt-1 max-h-72 overflow-auto whitespace-pre rounded-xs bg-ink-300 p-2 font-mono text-[10px] text-paper">{lines.join("\n")}</pre>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function PerformanceView({ refreshKey }: { refreshKey?: number }): ReactElement {
  const client = useQueryClient();
  const connectionId = useAuthStore((s) => s.activeConnectionId);
  const { data, isLoading, isError, error } = usePerformance();
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (refreshKey) void client.invalidateQueries({ queryKey: observeKeys.performance(connectionId) });
  }, [refreshKey, client, connectionId]);

  if (isLoading) return <LoadingGrid />;
  if (isError || !data) return <ErrorState title="Performance could not be loaded." error={error} />;

  const byKind = new Map<string, typeof data.changes>();
  for (const c of data.changes) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
  const regression = data.regressions.find((r) => r.id === selected) ?? null;

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4" data-onboarding-id="monitoring-performance-regressions">
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight text-paper">What got slower, and what changed</h2>
        <p className="mt-1 text-[12px] text-paper-muted">Every query shape is tracked by normalized_query_hash against its own 14-day baseline. Regressions are lined up with the changes around them.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Query shapes tracked" value={formatCount(data.fingerprints)} meta="Per replica" />
        <Kpi label="Regressed" value={data.regressions.length} meta="p95 or bytes read ≥ 1.5× baseline" tone={data.regressions.length > 0 ? "warn" : "ok"} />
        <Kpi label="Recovered · 7d" value={data.resolved7d} meta="Back within baseline" />
        <Kpi label="Changes · 7d" value={data.changes.length} meta={[...byKind.entries()].map(([k, v]) => `${v.length} ${k}`).join(" · ") || "None recorded"} />
      </div>
      <Panel title="Change timeline" meta="Version history, DDL, settings changes and writer metadata">
        {data.changes.length === 0 ? <p className="text-[12px] text-paper-muted">No changes in the last 7 days.</p> : (
          <dl className="space-y-2">
            {[...byKind.entries()].map(([kind, changes]) => (
              <div key={kind} className="grid grid-cols-[110px_1fr] gap-3">
                <dt className={OBS_LABEL}>{kind}</dt>
                <dd className="flex flex-wrap gap-1.5">{changes.slice(-12).map((c) => <span key={c.id} className="rounded-xs border border-ink-500 px-1.5 py-0.5 text-[11px] text-paper-muted" title={c.summary}>{new Date(c.at).toLocaleDateString([], { month: "short", day: "numeric" })} · {c.summary.length > 48 ? `${c.summary.slice(0, 48)}…` : c.summary}</span>)}</dd>
              </div>
            ))}
          </dl>
        )}
      </Panel>
      <Panel title="Regressions" meta="Ranked by how much slower">
        {data.regressions.length === 0 ? (
          <EmptyState icon={TrendingDown} title="No regressions" body="Every tracked query shape is within its baseline." />
        ) : (
          <DataTable label="Regressions" head={["Query shape", "Replica", "Metric", "Baseline → now", "Runs", "Since", "Linked change"]}>
            {data.regressions.map((r) => (
              <tr key={r.id} className={r.id === selected ? "bg-ink-200/60" : "cursor-pointer hover:bg-ink-200/50"} onClick={() => setSelected(r.id === selected ? null : r.id)}>
                <td className="max-w-[320px]"><button type="button" className="block w-full truncate text-left font-mono text-[11px] text-paper hover:text-brand" onClick={(e) => { e.stopPropagation(); setSelected(r.id === selected ? null : r.id); }}>{r.sampleQuery ?? `shape ${r.fingerprint}`}</button></td>
                <td><Mono className="text-paper-muted">{r.replica}</Mono></td>
                <td className="text-paper-muted">{r.metric}</td>
                <td className="whitespace-nowrap tabular-nums">{metricValue(r.metric, r.baseline)} → <span className="text-red-500">{metricValue(r.metric, r.current)}</span></td>
                <td className="tabular-nums text-paper-muted">{formatCount(r.runs)}</td>
                <td className="whitespace-nowrap text-paper-muted">{formatAgo(r.onsetAt)}</td>
                <td>{r.linkedChanges[0]?.summary ? <StatusPill tone="info" dot={false}>{r.linkedChanges[0].summary.slice(0, 40)}</StatusPill> : <span className="text-[11px] text-paper-faint">none found</span>}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      {regression && <RegressionDetail regression={regression} />}
    </div>
  );
}
