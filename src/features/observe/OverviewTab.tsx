/**
 * Data › Overview: "is the data right, right now?" — trust across tables,
 * coverage, open incidents with their root cause, pipelines needing
 * attention, suggested monitors and recent schema changes.
 */

import type { ReactElement } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, GitBranch, ShieldCheck, Siren, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import type { DatasetSummary, Pipeline, UnifiedIncident } from "@/api/observe";
import { useCoverage, useOverview } from "./hooks";
import { formatAgo, formatCount, formatDuration, formatPercent, LAYER_LABEL, nodeLabel, PIPELINE_KIND_LABEL, PIPELINE_STATUS, TRUST_TONE } from "./lib";
import { dataPaths } from "./paths";
import { DataTable, EmptyState, ErrorState, Kpi, LoadingGrid, Mono, OBS_LABEL, Panel, StatusPill } from "./ui";

function IncidentCard({ incident }: { incident: UnifiedIncident }): ReactElement {
  const navigate = useNavigate();
  return (
    <Panel
      title={incident.title}
      meta={`${incident.connectionName ? `${incident.connectionName} · ` : ""}${incident.severity} · opened ${formatAgo(incident.openedAt)}`}
      actions={
        <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => navigate(dataPaths.incident(incident.source, incident.id))}>
          Open investigation <ArrowRight className="ml-1.5 h-3 w-3" />
        </Button>
      }
      className={incident.severity === "critical" ? "border-red-500/40" : undefined}
    >
      {incident.rootCause ? (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <StatusPill tone="brand" dot={false}>Root cause · {LAYER_LABEL[incident.rootCause.layer]}</StatusPill>
          <span className="text-paper">{incident.rootCause.summary}</span>
        </div>
      ) : (
        <p className="text-[12px] text-paper-muted">Root cause not computed yet. Open the investigation to trace it through the layers.</p>
      )}
      {incident.subject && <p className="mt-2 font-mono text-[10px] text-paper-faint">Subject · {nodeLabel(incident.subject)}</p>}
    </Panel>
  );
}

function TrustTable({ tables }: { tables: DatasetSummary[] }): ReactElement {
  const navigate = useNavigate();
  if (tables.length === 0) return <EmptyState title="No tables observed yet" body="The collector learns baselines from system.parts and query_log; tables appear after the first catalog pass." />;
  return (
    <DataTable label="Table trust" head={["Table", "Trust", "Last write", "Cadence", "Readers · 7d", "Promise"]}>
      {tables.map((t) => (
        <tr key={`${t.database}.${t.table}`} className="cursor-pointer hover:bg-ink-200/50" onClick={() => navigate(dataPaths.dataset(t.database, t.table))}>
          <td><button type="button" className="text-left font-mono text-[11px] text-paper hover:text-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" onClick={(e) => { e.stopPropagation(); navigate(dataPaths.dataset(t.database, t.table)); }}>{t.database}.{t.table}</button></td>
          <td><StatusPill tone={TRUST_TONE[t.state] ?? "muted"}>{t.state}</StatusPill>{t.stateReason && <span className="ml-2 text-[11px] text-paper-muted">{t.stateReason}</span>}</td>
          <td className="whitespace-nowrap text-paper-muted">{formatAgo(t.lastWriteAt)}</td>
          <td className="whitespace-nowrap text-paper-muted">{t.cadenceSeconds ? `~${formatDuration(t.cadenceSeconds)}` : "—"}</td>
          <td className="whitespace-nowrap tabular-nums text-paper-muted">{formatCount(t.readers7d)}</td>
          <td>{t.hasPromise ? <StatusPill tone="ok" dot={false}>Promised</StatusPill> : <span className="text-[11px] text-paper-faint">Learned baseline</span>}</td>
        </tr>
      ))}
    </DataTable>
  );
}

function PipelineList({ pipelines }: { pipelines: Pipeline[] }): ReactElement {
  if (pipelines.length === 0) return <EmptyState icon={Workflow} title="Every pipeline is healthy" />;
  return (
    <ul className="divide-y divide-ink-500/60">
      {pipelines.map((p) => {
        const status = PIPELINE_STATUS[p.status];
        return (
          <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate font-mono text-[11px] text-paper">{p.name}</p>
              <p className="truncate text-[11px] text-paper-muted">{PIPELINE_KIND_LABEL[p.kind] ?? p.kind}{p.statusReason ? ` · ${p.statusReason}` : ""}</p>
            </div>
            <StatusPill tone={status?.tone ?? "muted"}>{status?.label ?? p.status}</StatusPill>
          </li>
        );
      })}
    </ul>
  );
}

export function OverviewTab(): ReactElement {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useOverview();
  const coverage = useCoverage();
  const canEditHealth = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_EDIT));

  if (isLoading) return <LoadingGrid count={5} className="lg:grid-cols-5" />;
  if (isError || !data) return <ErrorState title="Data overview could not be loaded." error={error} />;

  const failing = (data.pipelines.byStatus.failing ?? 0) + (data.pipelines.byStatus.retrying ?? 0) + (data.pipelines.byStatus.stalled ?? 0);
  const degraded = (data.pipelines.byStatus.lagging ?? 0) + (data.pipelines.byStatus.stopped ?? 0) + (data.pipelines.byStatus.inefficient ?? 0);
  const issues = data.tables.stale + data.tables.degraded;
  const critCoverage = data.coverage.critical > 0 ? data.coverage.criticalPromised / data.coverage.critical : null;
  const suggestions = coverage.data?.suggestions.slice(0, 3) ?? [];

  return (
    <div className="space-y-5" data-onboarding-id="data-overview">
      <div>
        <h2 className="text-[18px] font-semibold tracking-tight text-paper">Is the data right, right now?</h2>
        <p className="mt-1 text-[12px] text-paper-muted">{data.tables.total} tables monitored · baselines learned from system.parts and query_log, no table scans</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Trusted tables" value={`${data.tables.trusted} / ${data.tables.total}`} meta={issues > 0 ? `${issues} with open issues` : data.tables.learning > 0 ? `${data.tables.learning} still learning` : "All trusted"} tone={issues > 0 ? "warn" : undefined} icon={ShieldCheck} />
        <Kpi label="Critical coverage" value={formatPercent(critCoverage)} meta={`${data.coverage.promised} promises · ${data.tables.total - data.coverage.promised} learned baselines`} />
        <Kpi label="Open incidents" value={data.incidents.open} meta={`${data.incidents.critical} critical · ${data.incidents.open - data.incidents.critical} warning`} tone={data.incidents.critical > 0 ? "bad" : data.incidents.open > 0 ? "warn" : "ok"} icon={Siren} />
        <Kpi label="Pipelines" value={data.pipelines.total} meta={`${degraded} degraded · ${failing} failing`} tone={failing > 0 ? "bad" : degraded > 0 ? "warn" : undefined} icon={Workflow} />
      </div>

      {data.incidents.top.length > 0 && (
        <div className="grid gap-3 xl:grid-cols-2">
          {data.incidents.top.slice(0, 2).map((incident) => <IncidentCard key={`${incident.source}:${incident.id}`} incident={incident} />)}
        </div>
      )}

      <Panel
        title="Table trust"
        meta="Sorted by impact (readers × severity)"
        actions={<Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => navigate(dataPaths.tab("datasets"))}>All datasets</Button>}
      >
        <TrustTable tables={data.topTables} />
      </Panel>

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Pipelines needing attention" actions={<Button variant="ghost" className="h-8 rounded-xs text-[11px]" onClick={() => navigate(dataPaths.tab("pipelines"))}>Pipelines</Button>}>
          <PipelineList pipelines={data.pipelines.attention} />
        </Panel>

        <Panel title="Suggested monitors" actions={<Button variant="ghost" className="h-8 rounded-xs text-[11px]" onClick={() => navigate(dataPaths.tab("coverage"))}>{coverage.data ? `Review ${coverage.data.suggestions.length}` : "Coverage"}</Button>}>
          {suggestions.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No suggestions right now" body="Suggestions appear when read-heavy tables lack a promise." />
          ) : (
            <ul className="divide-y divide-ink-500/60">
              {suggestions.map((s) => (
                <li key={s.key} className="py-2.5">
                  <p className="font-mono text-[11px] text-paper">{s.database}.{s.table}</p>
                  <p className="text-[11px] text-paper-muted">{s.check} · {s.learnedFrom}</p>
                </li>
              ))}
            </ul>
          )}
          {!canEditHealth && suggestions.length > 0 && <p className="mt-2 text-[10px] text-paper-faint">Accepting suggestions needs data_health:edit.</p>}
        </Panel>

        <Panel title="Recent changes" meta="DDL and settings from query_log">
          {data.recentChanges.length === 0 ? (
            <EmptyState icon={GitBranch} title="No changes recorded" />
          ) : (
            <ul className="divide-y divide-ink-500/60">
              {data.recentChanges.map((c) => (
                <li key={`${c.at}:${c.summary}`} className="grid grid-cols-[80px_1fr] gap-3 py-2.5">
                  <span className={OBS_LABEL}>{formatAgo(c.at)}</span>
                  <div className="min-w-0">
                    <Mono className="block truncate text-paper">{c.summary}</Mono>
                    {c.objectRef && <span className="text-[11px] text-paper-muted">{c.objectRef}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
