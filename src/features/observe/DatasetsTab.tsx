/**
 * Data › Datasets: every observed table with its learned baseline (Tables),
 * the Data Health promises (Promises, Promise health — unchanged from
 * DataOps), and the per-table page: trust, volume against the learned band,
 * column drift, schema history, usage and the promises on it.
 */

import { useMemo, useState, type ReactElement } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, BookOpen, Database, GitBranch, HeartPulse, LayoutDashboard, Search, ShieldCheck, Table2 } from "lucide-react";

import type { Criticality, DatasetDetail } from "@/api/observe";
import { SubTabs } from "@/components/common/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PromiseHealthOverview, PromisesTab, PromiseWizard, type PromiseWizardDraft } from "@/features/data-health";
import { useChartColors } from "@/hooks/useChartColors";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { toast } from "sonner";
import { useDataset, useDatasets, usePinCriticality } from "./hooks";
import { columnDrift, CRITICALITY_ORDER, formatAgo, formatBytes, formatCount, formatDuration, formatPercent, humanize, relativeChange, TRUST_TONE } from "./lib";
import { dataPaths } from "./paths";
import { DataTable, EmptyState, ErrorState, Kpi, LoadingGrid, Mono, OBS_LABEL, Panel, RatioBar, StatusPill } from "./ui";

type View = "tables" | "promises" | "health";

function VolumeChart({ volume }: { volume: DatasetDetail["volume"] }): ReactElement {
  const colors = useChartColors();
  const data = volume.map((v) => ({ hour: v.hour, rows: v.rows, band: v.lower !== null && v.upper !== null ? [v.lower, v.upper] : null, expected: v.expected }));
  return (
    <div className="h-56 w-full" role="img" aria-label="Rows per hour against the learned baseline band">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="hour" tickFormatter={(v: number) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} tick={{ fill: colors.tick, fontSize: 10 }} stroke={colors.grid} minTickGap={40} />
          <YAxis tickFormatter={(v: number) => formatCount(v)} tick={{ fill: colors.tick, fontSize: 10 }} stroke={colors.grid} width={48} />
          <Tooltip
            contentStyle={{ background: colors.tooltipBg, border: `1px solid ${colors.tooltipBorder}`, borderRadius: 2, fontSize: 11 }}
            labelStyle={{ color: colors.tooltipLabel }}
            itemStyle={{ color: colors.tooltipText }}
            labelFormatter={(v: number) => new Date(v).toLocaleString()}
            formatter={(value: unknown, name?: unknown) => [Array.isArray(value) ? value.map((x) => formatCount(Number(x))).join(" – ") : formatCount(Number(value)), name === "band" ? "Learned band" : name === "expected" ? "Expected" : "Rows"]}
          />
          <Area dataKey="band" stroke="none" fill={colors.grid} fillOpacity={0.9} isAnimationActive={false} />
          <Line dataKey="expected" stroke={colors.tick} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          <Area dataKey="rows" stroke="#ffcc01" fill="#ffcc01" fillOpacity={0.12} strokeWidth={1.6} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function CriticalityControl({ database, table, current, pinned }: { database: string; table: string; current: Criticality; pinned: boolean }): ReactElement {
  const canEdit = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.OBSERVE_EDIT));
  const pin = usePinCriticality();
  if (!canEdit) return <StatusPill tone="muted" dot={false}>{current}{pinned ? " · pinned" : " · from usage"}</StatusPill>;
  return (
    <Select
      value={pinned ? current : "auto"}
      onValueChange={(value) => {
        const next = CRITICALITY_ORDER.find((c) => c === value) ?? null;
        void pin.mutateAsync({ database, table, criticality: next }).then(() => toast.success(next ? `Pinned as ${next}` : "Criticality follows usage again"), (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not change criticality"));
      }}
    >
      <SelectTrigger className="h-7 w-48 rounded-xs text-[11px]" aria-label="Criticality"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">{`Auto from usage (${current})`}</SelectItem>
        {CRITICALITY_ORDER.map((c) => <SelectItem key={c} value={c}>{`Pin ${c}`}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function DatasetPage({ database, table }: { database: string; table: string }): ReactElement {
  const navigate = useNavigate();
  const { hasPermission } = useRbacStore();
  const { data, isLoading, isError, error } = useDataset(database, table);
  const [draft, setDraft] = useState<PromiseWizardDraft>();
  const canCreatePromise = hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_EDIT);
  const drift = useMemo(() => (data ? columnDrift(data.drift) : []), [data]);

  if (isLoading) return <LoadingGrid />;
  if (isError || !data) return <ErrorState title={`${database}.${table} could not be loaded.`} error={error} />;

  const lastHour = data.volume[data.volume.length - 1];
  const change = lastHour ? relativeChange(lastHour.rows, lastHour.expected) : null;
  const outOfBand = lastHour && lastHour.lower !== null && lastHour.upper !== null && (lastHour.rows < lastHour.lower || lastHour.rows > lastHour.upper);
  const drifted = drift.filter((d) => d.drifted);
  const totalUsage = data.usage.reduce((s, u) => s + u.bytes, 0);
  const b = data.baseline;

  return (
    <div className="space-y-4" data-onboarding-id="data-dataset-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button variant="ghost" className="-ml-2 h-7 rounded-xs px-2 text-[11px] text-paper-muted" onClick={() => navigate(dataPaths.tab("datasets"))}><ArrowLeft className="mr-1 h-3 w-3" /> Datasets</Button>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-[18px] font-semibold tracking-tight text-paper">{database}.{table}</h2>
            {b && <StatusPill tone={TRUST_TONE[b.state] ?? "muted"}>{b.state}</StatusPill>}
            {b && <CriticalityControl database={database} table={table} current={b.criticality} pinned={b.criticalityPinned} />}
          </div>
          {b?.stateReason && <p className="mt-1 text-[12px] text-paper-muted">{b.stateReason}</p>}
          {data.catalog && (
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-paper-muted">
              <span>Engine <Mono className="text-paper">{data.catalog.engine}</Mono></span>
              <span>Size <Mono className="text-paper">{formatBytes(data.catalog.totalBytes)} · {formatCount(data.catalog.totalRows)} rows</Mono></span>
              {data.catalog.sortingKey && <span>ORDER BY <Mono className="text-paper">({data.catalog.sortingKey})</Mono></span>}
              {data.catalog.partitionKey && <span>PARTITION <Mono className="text-paper">{data.catalog.partitionKey}</Mono></span>}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-9 rounded-xs" onClick={() => navigate(`/explorer?db=${encodeURIComponent(database)}&table=${encodeURIComponent(table)}`)}><Database className="mr-1.5 h-3.5 w-3.5" /> Explorer</Button>
          <Button variant="outline" className="h-9 rounded-xs" onClick={() => navigate(dataPaths.lineage(`table:${database}.${table}`))}><GitBranch className="mr-1.5 h-3.5 w-3.5" /> Lineage</Button>
          <Button variant="outline" className="h-9 rounded-xs" onClick={() => navigate(dataPaths.context(database, table))}><BookOpen className="mr-1.5 h-3.5 w-3.5" /> Context</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Freshness" value={formatAgo(b?.lastWriteAt)} meta={b?.cadenceP50 ? `Learned cadence: every ~${formatDuration(b.cadenceP50)}` : "Cadence still learning"} />
        <Kpi label="Volume · last hour" value={change === null ? formatCount(lastHour?.rows) : `${change >= 0 ? "+" : "−"}${formatPercent(Math.abs(change))}`} meta={outOfBand ? "Outside the learned band" : lastHour?.expected != null ? `Expected ~${formatCount(lastHour.expected)}` : "Baseline still learning"} tone={outOfBand ? "warn" : undefined} />
        <Kpi label="Promises" value={data.promises.length} meta={data.promises.filter((p) => p.status !== "healthy").length > 0 ? `${data.promises.filter((p) => p.status !== "healthy").length} not healthy` : "Checks you defined"} />
        <Kpi label="Drift alerts" value={drifted.length} meta={drifted[0] ? `${drifted[0].column} ${drifted[0].metric}` : "Sampled column profiles"} tone={drifted.length > 0 ? "bad" : undefined} />
      </div>

      <Panel title="Rows per hour vs learned baseline · 48h" meta="From system.parts, no table scan">
        {data.volume.length < 2 ? <EmptyState title="Not enough history yet" body="Hourly samples appear after the tables collector has run for a couple of hours." /> : <VolumeChart volume={data.volume} />}
      </Panel>

      <Panel
        title="Profile & distribution drift"
        meta="Sampled aggregates compared with a 14-day baseline"
        actions={canCreatePromise ? (
          <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => setDraft({ databaseName: database, tableName: table, name: `${table} distribution`, checks: drifted.slice(0, 3).filter((d) => d.metric !== "distinct").map((d, i) => ({ checkKey: `distribution_${i + 1}`, type: "distribution", config: { column: d.column, statistic: d.metric === "null ratio" ? "null_ratio" : d.metric, tolerance: 3, minSamples: 7 } })) })}>
            <ShieldCheck className="mr-1.5 h-3 w-3" /> {drifted.length > 0 ? "Promise on drifted columns" : "Create promise"}
          </Button>
        ) : undefined}
      >
        {drift.length === 0 ? (
          <EmptyState title="No column profiles yet" body="Critical and important tables are profiled on a 0.1% sample every 15 minutes." />
        ) : (
          <DataTable label="Column drift" head={["Column", "Metric", "Baseline", "Now", "Drift"]}>
            {drift.slice(0, 30).map((d) => (
              <tr key={`${d.column}:${d.metric}`}>
                <td><Mono className="text-paper">{d.column}</Mono></td>
                <td className="text-paper-muted">{d.metric}</td>
                <td className="tabular-nums text-paper-muted">{d.metric === "null ratio" ? formatPercent(d.baseline, 2) : formatCount(d.baseline)}</td>
                <td className={d.drifted ? "tabular-nums text-red-500" : "tabular-nums text-paper"}>{d.metric === "null ratio" ? formatPercent(d.current, 2) : formatCount(d.current)}</td>
                <td>{d.change === null ? <span className="text-[11px] text-paper-faint">learning</span> : <StatusPill tone={d.drifted ? "bad" : "ok"} dot={false}>{d.drifted ? (d.metric === "null ratio" ? `${d.change > 0 ? "+" : ""}${formatPercent(d.change, 1)}` : `×${d.change.toFixed(d.change < 10 ? 2 : 0)}`) : "stable"}</StatusPill>}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Schema history" meta="DDL from query_log">
          {data.schemaHistory.length === 0 ? <EmptyState title="No schema changes recorded" /> : (
            <ol className="divide-y divide-ink-500/60">
              {data.schemaHistory.map((h) => (
                <li key={`${h.at}:${h.summary}`} className="grid grid-cols-[96px_1fr] gap-3 py-2.5">
                  <span className={OBS_LABEL}>{new Date(h.at).toLocaleDateString()}</span>
                  <Mono className="break-all text-paper">{h.summary}</Mono>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel title="Usage · 7 days" meta={b ? `${formatCount(b.reads7d)} reads · ${formatCount(b.readers7d)} readers` : undefined}>
          {data.usage.length === 0 ? <EmptyState title="No reads recorded this week" /> : (
            <div className="space-y-2">
              {data.usage.map((u) => (
                <div key={u.kind} className="grid grid-cols-[120px_1fr_70px] items-center gap-3">
                  <span className="text-[12px] text-paper">{humanize(u.kind === "agent" ? "agents (MCP)" : u.kind)}</span>
                  <RatioBar ratio={totalUsage ? u.bytes / totalUsage : 0} tone={u.kind === "agent" ? "brand" : "muted"} label={`${u.kind} share of bytes read`} />
                  <span className="text-right font-mono text-[11px] text-paper-muted">{u.principals}</span>
                </div>
              ))}
            </div>
          )}
          {data.filters.length > 0 && (
            <>
              <p className={`${OBS_LABEL} mt-4`}>Most-filtered columns</p>
              <ul className="mt-2 divide-y divide-ink-500/60">
                {data.filters.map((f) => (
                  <li key={f.column} className="flex items-center justify-between gap-3 py-2">
                    <Mono className="text-paper">{f.column} · {formatPercent(f.share)} of reads</Mono>
                    <StatusPill tone={f.inSortingKey ? "ok" : "warn"} dot={false}>{f.inSortingKey ? "in ORDER BY" : "not in key"}</StatusPill>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Promises on this table" actions={canCreatePromise ? <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => setDraft({ databaseName: database, tableName: table })}><ShieldCheck className="mr-1.5 h-3 w-3" /> New promise</Button> : undefined}>
        {data.promises.length === 0 ? <EmptyState icon={ShieldCheck} title="Only the learned baseline protects this table" body="Add a promise for explicit checks and alerts." /> : (
          <ul className="divide-y divide-ink-500/60">
            {data.promises.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <button type="button" className="text-left text-[12px] text-paper hover:text-brand" onClick={() => navigate(`${dataPaths.promises()}&promise=${encodeURIComponent(p.id)}`)}>{p.name}</button>
                <StatusPill tone={p.status === "healthy" ? "ok" : p.status === "unhealthy" ? "bad" : p.status === "degraded" ? "warn" : "muted"}>{p.status}</StatusPill>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <PromiseWizard open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(undefined)} initialDraft={draft} />
    </div>
  );
}

function TablesView(): ReactElement {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [state, setState] = useState("all");
  const [criticality, setCriticality] = useState("all");
  const { data, isLoading, isError, error } = useDatasets(search, state === "all" ? "" : state, criticality === "all" ? "" : criticality);

  return (
    <div className="space-y-3" data-onboarding-id="data-datasets">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-paper-faint" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tables…" aria-label="Search tables" className="h-9 rounded-xs pl-8" />
        </div>
        <Select value={state} onValueChange={setState}>
          <SelectTrigger className="h-9 w-40 rounded-xs" aria-label="Trust state"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All trust states</SelectItem>{["trusted", "degraded", "stale", "learning"].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={criticality} onValueChange={setCriticality}>
          <SelectTrigger className="h-9 w-40 rounded-xs" aria-label="Criticality"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Any criticality</SelectItem>{CRITICALITY_ORDER.map((c) => <SelectItem key={c} value={c}>{humanize(c)}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {isLoading ? <LoadingGrid count={2} /> : isError || !data ? <ErrorState title="Datasets could not be loaded." error={error} /> : data.length === 0 ? (
        <EmptyState icon={Table2} title="No tables match" />
      ) : (
        <Panel title="Observed tables" meta={`${data.length} · sorted by impact`}>
          <DataTable label="Observed tables" head={["Table", "Trust", "Criticality", "Last write", "Size", "Reads · 7d", "Promise"]}>
            {data.map((d) => (
              <tr key={`${d.database}.${d.table}`} className="cursor-pointer hover:bg-ink-200/50" onClick={() => navigate(dataPaths.dataset(d.database, d.table))}>
                <td><button type="button" className="text-left font-mono text-[11px] text-paper hover:text-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" onClick={(e) => { e.stopPropagation(); navigate(dataPaths.dataset(d.database, d.table)); }}>{d.database}.{d.table}</button></td>
                <td><StatusPill tone={TRUST_TONE[d.state] ?? "muted"}>{d.state}</StatusPill></td>
                <td className="text-paper-muted">{d.criticality}{d.criticalityPinned ? " · pinned" : ""}</td>
                <td className="whitespace-nowrap text-paper-muted">{formatAgo(d.lastWriteAt)}</td>
                <td className="whitespace-nowrap tabular-nums text-paper-muted">{formatBytes(d.totalBytes)}</td>
                <td className="tabular-nums text-paper-muted">{formatCount(d.reads7d)}</td>
                <td>{d.hasPromise ? <StatusPill tone={d.openIncident ? "bad" : "ok"} dot={false}>{d.openIncident ? "Incident" : "Promised"}</StatusPill> : <span className="text-[11px] text-paper-faint">—</span>}</td>
              </tr>
            ))}
          </DataTable>
        </Panel>
      )}
    </div>
  );
}

export function DatasetsTab({ database, table }: { database?: string; table?: string }): ReactElement {
  const { hasPermission } = useRbacStore();
  const [params, setParams] = useSearchParams();
  const canTables = hasPermission(RBAC_PERMISSIONS.OBSERVE_VIEW);
  const canPromises = hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_VIEW);
  const requested = params.get("view");
  const views: Array<{ key: View; label: string; icon: typeof Table2 }> = [
    ...(canTables ? [{ key: "tables" as const, label: "Tables", icon: Table2 }] : []),
    ...(canPromises ? [{ key: "promises" as const, label: "Promises", icon: HeartPulse }, { key: "health" as const, label: "Promise health", icon: LayoutDashboard }] : []),
  ];
  const view: View = views.find((v) => v.key === requested)?.key ?? views[0]?.key ?? "tables";
  const promiseId = params.get("promise") ?? undefined;

  if (database && table && canTables) return <DatasetPage database={database} table={table} />;

  const setView = (next: View): void => {
    const p = new URLSearchParams();
    if (next !== "tables") p.set("view", next);
    setParams(p);
  };
  const selectPromise = (id?: string): void => {
    const p = new URLSearchParams({ view: "promises" });
    if (id) p.set("promise", id);
    setParams(p);
  };

  return (
    <div className="-mx-6 -mt-6 flex flex-col">
      {views.length > 1 && <SubTabs tabs={views} active={view} onChange={setView} label="Dataset views" onboardingPrefix="data-datasets" />}
      <div className="px-6 pt-6">
        {view === "tables" && <TablesView />}
        {view === "promises" && <PromisesTab selectedPromiseId={promiseId} onSelectedPromiseChange={selectPromise} />}
        {view === "health" && <PromiseHealthOverview onSelectPromise={(id) => selectPromise(id)} />}
      </div>
    </div>
  );
}
