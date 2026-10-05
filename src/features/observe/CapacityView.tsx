/**
 * Monitoring › Capacity (ADR 0016 §9): disk forecasts per node from
 * system.disks history, top growth from part_log, codec trials measured on
 * samples, cold data, and cost by consumer at the configured rates.
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { FlaskConical, HardDrive } from "lucide-react";

import type { Capacity } from "@/api/observe";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { useChartColors } from "@/hooks/useChartColors";
import { RBAC_PERMISSIONS, useAuthStore, useRbacStore } from "@/stores";
import { observeKeys, useCapacity, useSetCostRates, useStartCodecTrial } from "./hooks";
import { formatAgo, formatBytes, formatPercent, humanize } from "./lib";
import { DataTable, EmptyState, ErrorState, Kpi, LoadingGrid, Mono, Panel, RatioBar, StatusPill } from "./ui";

const NODE_COLORS = ["#ffcc01", "#60a5fa", "#34d399", "#f87171", "#a78bfa", "#fb923c", "#2dd4bf", "#f472b6"];

/** Daily used ratio per `node/disk`, pivoted for recharts. */
export function pivotDisks(history: Capacity["history"]): { rows: Array<Record<string, number>>; keys: string[] } {
  const keys = [...new Set(history.map((h) => `${h.node}/${h.disk}`))].sort();
  const byDay = new Map<number, Record<string, number>>();
  for (const h of history) {
    if (!h.total) continue;
    const day = Math.floor(h.at / 86_400_000) * 86_400_000;
    const row = byDay.get(day) ?? { day };
    row[`${h.node}/${h.disk}`] = h.used / h.total;
    byDay.set(day, row);
  }
  return { rows: [...byDay.values()].sort((a, b) => a.day - b.day), keys };
}

function CodecTrialDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): ReactElement {
  const start = useStartCodecTrial();
  const [form, setForm] = useState({ database: "", table: "", column: "", candidateCodec: "ZSTD(3)" });
  const valid = Object.values(form).every((v) => v.trim());
  const submit = async (): Promise<void> => {
    try {
      await start.mutateAsync({ database: form.database.trim(), table: form.table.trim(), column: form.column.trim(), candidateCodec: form.candidateCodec.trim() });
      toast.success("Codec trial started on a sample in the scratch database");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the trial");
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-xs border-ink-500 bg-ink-100 text-paper">
        <DialogHeader>
          <DialogTitle>Measure a codec</DialogTitle>
          <DialogDescription>Copies a 1M-row sample of one column into the scratch database and compares compression. The original table is never touched.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["database", "table", "column", "candidateCodec"] as const).map((key) => (
            <div key={key}>
              <Label htmlFor={`trial-${key}`}>{key === "candidateCodec" ? "Candidate codec" : humanize(key)}</Label>
              <Input id={`trial-${key}`} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="mt-1 rounded-xs font-mono" />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className={DH_PRIMARY} disabled={!valid || start.isPending} onClick={() => void submit()}>Start trial</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CostRatesDialog({ cost, open, onOpenChange }: { cost: NonNullable<Capacity["cost"]>; open: boolean; onOpenChange: (open: boolean) => void }): ReactElement {
  const save = useSetCostRates();
  const [currency, setCurrency] = useState(cost.currency);
  const [perTib, setPerTib] = useState(String(cost.perTibRead));
  const [perCpu, setPerCpu] = useState(String(cost.perCpuHour));
  const valid = currency.trim().length > 0 && Number(perTib) >= 0 && Number(perCpu) >= 0 && perTib !== "" && perCpu !== "";
  const submit = async (): Promise<void> => {
    try {
      await save.mutateAsync({ currency: currency.trim(), perTibRead: Number(perTib), perCpuHour: Number(perCpu) });
      toast.success("Cost rates saved");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save cost rates");
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-xs border-ink-500 bg-ink-100 text-paper">
        <DialogHeader>
          <DialogTitle>Cost rates</DialogTitle>
          <DialogDescription>Costs are estimates: TiB read × your rate plus CPU-hours × your rate.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><Label htmlFor="rate-currency">Currency</Label><Input id="rate-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="mt-1 rounded-xs" /></div>
          <div><Label htmlFor="rate-tib">Per TiB read</Label><Input id="rate-tib" type="number" min={0} value={perTib} onChange={(e) => setPerTib(e.target.value)} className="mt-1 rounded-xs" /></div>
          <div><Label htmlFor="rate-cpu">Per CPU-hour</Label><Input id="rate-cpu" type="number" min={0} value={perCpu} onChange={(e) => setPerCpu(e.target.value)} className="mt-1 rounded-xs" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className={DH_PRIMARY} disabled={!valid || save.isPending} onClick={() => void submit()}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CapacityView({ refreshKey }: { refreshKey?: number }): ReactElement {
  const client = useQueryClient();
  const colors = useChartColors();
  const connectionId = useAuthStore((s) => s.activeConnectionId);
  const { hasPermission } = useRbacStore();
  const { data, isLoading, isError, error } = useCapacity();
  const [trialOpen, setTrialOpen] = useState(false);
  const [ratesOpen, setRatesOpen] = useState(false);
  const chart = useMemo(() => pivotDisks(data?.history ?? []), [data?.history]);

  useEffect(() => {
    if (refreshKey) void client.invalidateQueries({ queryKey: observeKeys.capacity(connectionId) });
  }, [refreshKey, client, connectionId]);

  if (isLoading) return <LoadingGrid />;
  if (isError || !data) return <ErrorState title="Capacity could not be loaded." error={error} />;

  const first = data.forecasts.find((f) => f.daysToThreshold !== null);
  const totalGrowth = data.growth.reduce((s, g) => s + g.bytesPerDay, 0);
  const latestByDisk = new Map<string, { used: number; total: number }>();
  for (const h of data.history) latestByDisk.set(`${h.node}/${h.disk}`, { used: h.used, total: h.total });
  const used = [...latestByDisk.values()].reduce((s, d) => s + d.used, 0);
  const total = [...latestByDisk.values()].reduce((s, d) => s + d.total, 0);
  const reclaimable = data.trials.reduce((s, t) => s + (t.savedBytes ?? 0), 0) + data.cold.reduce((s, c) => s + c.totalBytes, 0);
  const canTrial = hasPermission(RBAC_PERMISSIONS.UPGRADES_RUN);
  const canRates = hasPermission(RBAC_PERMISSIONS.COST_VIEW) && hasPermission(RBAC_PERMISSIONS.SETTINGS_UPDATE);

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4" data-onboarding-id="monitoring-capacity-forecast">
      <div>
        <h2 className="text-[16px] font-semibold tracking-tight text-paper">When you run out, and what to reclaim first</h2>
        <p className="mt-1 text-[12px] text-paper-muted">Forecasts from system.disks and part_log growth. Savings are measured on samples, not guessed.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Disk used" value={total ? formatPercent(used / total) : "—"} meta={total ? `${formatBytes(used)} of ${formatBytes(total)}` : "Waiting for samples"} icon={HardDrive} />
        <Kpi label="First disk at threshold" value={first?.daysToThreshold != null ? `${Math.round(first.daysToThreshold)} days` : "Not in sight"} meta={first ? `${first.node} · ${first.disk}` : "At current growth"} tone={first?.daysToThreshold != null && first.daysToThreshold < 30 ? "warn" : undefined} />
        <Kpi label="Growth" value={`${formatBytes(totalGrowth)}/day`} meta={data.growth[0] ? `Top: ${data.growth[0].database}.${data.growth[0].table}` : "30-day average"} />
        <Kpi label="Reclaimable" value={formatBytes(reclaimable)} meta="Measured codecs and cold tables" />
      </div>

      <Panel title="Disk usage per node" meta="Dashed line: threshold">
        {chart.rows.length < 2 ? <EmptyState title="Not enough disk history yet" body="Samples accumulate daily from system.disks." /> : (
          <div className="h-56 w-full" role="img" aria-label="Disk used ratio per node over 30 days">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart.rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tickFormatter={(v: number) => new Date(v).toLocaleDateString([], { month: "short", day: "numeric" })} tick={{ fill: colors.tick, fontSize: 10 }} stroke={colors.grid} minTickGap={40} />
                <YAxis domain={[0, 1]} tickFormatter={(v: number) => formatPercent(v)} tick={{ fill: colors.tick, fontSize: 10 }} stroke={colors.grid} width={40} />
                <Tooltip contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 2, fontSize: 11 }} labelStyle={{ color: colors.tooltipLabel }} labelFormatter={(v: number) => new Date(v).toLocaleDateString()} formatter={(v: unknown) => formatPercent(Number(v), 1)} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <ReferenceLine y={data.forecasts[0]?.threshold ?? 0.85} stroke="#f87171" strokeDasharray="4 3" />
                {chart.keys.map((k, i) => <Line key={k} dataKey={k} stroke={NODE_COLORS[i % NODE_COLORS.length]} dot={false} strokeWidth={1.5} isAnimationActive={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {data.forecasts.length > 0 && (
          <DataTable label="Disk forecasts" head={["Node", "Disk", "Used", "Growth / day", "Reaches threshold"]}>
            {data.forecasts.map((f) => (
              <tr key={`${f.node}/${f.disk}`}>
                <td><Mono className="text-paper">{f.node}</Mono></td>
                <td className="text-paper-muted">{f.disk}</td>
                <td className="w-40"><div className="flex items-center gap-2"><RatioBar ratio={f.usedRatio} tone={f.usedRatio >= f.threshold ? "bad" : f.usedRatio >= f.threshold - 0.1 ? "warn" : "muted"} label={`${f.node} used`} /><span className="font-mono text-[10px] text-paper-muted">{formatPercent(f.usedRatio)}</span></div></td>
                <td className="tabular-nums text-paper-muted">{f.growthPerDay === null ? "—" : formatBytes(f.growthPerDay)}</td>
                <td>{f.daysToThreshold === null ? <span className="text-paper-faint">not in sight</span> : <StatusPill tone={f.daysToThreshold < 14 ? "bad" : f.daysToThreshold < 45 ? "warn" : "ok"} dot={false}>in {Math.round(f.daysToThreshold)} days</StatusPill>}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Codec & TTL advisor" meta="Each candidate measured on a sample" actions={canTrial ? <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => setTrialOpen(true)}><FlaskConical className="mr-1.5 h-3 w-3" /> Measure a codec</Button> : undefined}>
          {data.trials.length === 0 ? <EmptyState title="No codec trials yet" body={canTrial ? "Measure a candidate codec on a large column." : undefined} /> : (
            <DataTable label="Codec trials" head={["Column", "Now → candidate", "Ratio", "Saves", "Status"]}>
              {data.trials.map((t) => (
                <tr key={t.id}>
                  <td><Mono className="text-paper">{t.database}.{t.table}.{t.column}</Mono></td>
                  <td><Mono className="text-paper-muted">{t.current ?? "default"} → {t.candidate}</Mono></td>
                  <td className="tabular-nums text-paper-muted">{t.ratioBefore && t.ratioAfter ? `${t.ratioBefore.toFixed(1)}× → ${t.ratioAfter.toFixed(1)}×` : "—"}</td>
                  <td className="tabular-nums">{formatBytes(t.savedBytes)}</td>
                  <td><StatusPill tone={t.status === "done" ? "ok" : t.status === "failed" ? "bad" : "info"}>{t.status}</StatusPill>{t.error && <span className="ml-2 text-[10px] text-red-500">{t.error}</span>}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        <Panel title="Top growth tables" meta="30 days, from part_log">
          {data.growth.length === 0 ? <EmptyState title="No growth recorded" /> : (
            <DataTable label="Top growth" head={["Table", "Per day"]}>
              {data.growth.map((g) => <tr key={`${g.database}.${g.table}`}><td><Mono className="text-paper">{g.database}.{g.table}</Mono></td><td className="tabular-nums text-paper-muted">+{formatBytes(g.bytesPerDay)}</td></tr>)}
            </DataTable>
          )}
          {data.cold.length > 0 && (
            <p className="mt-3 text-[11px] text-paper-muted">{data.cold.length} tables ({formatBytes(data.cold.reduce((s, c) => s + c.totalBytes, 0))}) were not read in 7 days; the largest is <Mono>{data.cold[0].database}.{data.cold[0].table}</Mono>{data.cold[0].lastWriteAt ? `, last written ${formatAgo(data.cold[0].lastWriteAt)}` : ""}.</p>
          )}
        </Panel>
      </div>

      {data.cost && (
        <Panel title="Cost by consumer · 30d" meta={`TiB read × ${data.cost.perTibRead} ${data.cost.currency}`} actions={canRates ? <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => setRatesOpen(true)}>Cost rates</Button> : undefined}>
          {data.cost.byConsumer.length === 0 ? <EmptyState title="No reads attributed yet" /> : (
            <div className="space-y-2">
              {data.cost.byConsumer.map((c) => {
                const max = data.cost?.byConsumer[0]?.readBytes || 1;
                return (
                  <div key={`${c.kind}:${c.id}`} className="grid grid-cols-[220px_1fr_120px] items-center gap-3">
                    <span className="truncate text-[12px] text-paper" title={c.label ?? c.id}><span className="text-paper-muted">{humanize(c.kind)} ·</span> {c.label ?? c.id}</span>
                    <RatioBar ratio={c.readBytes / max} tone={c.kind === "agent" ? "brand" : "muted"} label={`${c.kind} ${c.label ?? c.id} bytes read`} />
                    <span className="text-right font-mono text-[11px] text-paper-muted">{formatBytes(c.readBytes)} · {c.cost.toFixed(2)} {data.cost?.currency}</span>
                  </div>
                );
              })}
            </div>
          )}
          {ratesOpen && <CostRatesDialog cost={data.cost} open={ratesOpen} onOpenChange={setRatesOpen} />}
        </Panel>
      )}
      <CodecTrialDialog open={trialOpen} onOpenChange={setTrialOpen} />
    </div>
  );
}
