/**
 * Data › Pipelines: every way data gets into ClickHouse — materialized and
 * refreshable views, queue engines (Kafka, RabbitMQ, NATS), object storage
 * queues (S3Queue, AzureQueue), database replication, Distributed inserts,
 * dictionaries, async inserts, external writers and scheduled jobs — in one
 * model with one status vocabulary.
 */

import { useMemo, useState, type ReactElement } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AlertTriangle, Workflow, X } from "lucide-react";

import { parseTableNode, type Pipeline, type PipelineKind, type PipelineStatus } from "@/api/observe";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { usePipelines, usePipelineSamples } from "./hooks";
import { formatAgo, formatCount, formatDuration, nodeLabel, PIPELINE_KIND_LABEL, PIPELINE_STATUS } from "./lib";
import { dataPaths } from "./paths";
import { DataTable, EmptyState, ErrorState, Kpi, LoadingGrid, Mono, OBS_LABEL, Panel, Sparkline, StatusPill } from "./ui";

const ATTENTION: PipelineStatus[] = ["failing", "retrying", "stalled"];

function isKind(value: string): value is PipelineKind {
  return Object.prototype.hasOwnProperty.call(PIPELINE_KIND_LABEL, value);
}

function isStatus(value: string): value is PipelineStatus {
  return Object.prototype.hasOwnProperty.call(PIPELINE_STATUS, value);
}

/** Summary across the pipelines shown. */
export function pipelineSummary(pipelines: Pipeline[]): { units24h: number; errors24h: number; maxLag: number | null; maxLagName: string | null; inefficient: number } {
  let maxLag: number | null = null;
  let maxLagName: string | null = null;
  for (const p of pipelines) {
    const lag = p.lagSeconds;
    if (lag !== null && (maxLag === null || lag > maxLag)) {
      maxLag = lag;
      maxLagName = p.name;
    }
  }
  return {
    units24h: pipelines.reduce((s, p) => s + p.units24h, 0),
    errors24h: pipelines.reduce((s, p) => s + p.errors24h, 0),
    maxLag,
    maxLagName,
    inefficient: pipelines.filter((p) => p.status === "inefficient").length,
  };
}

function SamplesSheet({ pipeline, onClose }: { pipeline: Pipeline | null; onClose: () => void }): ReactElement {
  const navigate = useNavigate();
  const samples = usePipelineSamples(pipeline?.id ?? null);
  const latestError = samples.data?.find((s) => s.errorSample);
  const target = parseTableNode(pipeline?.targetNode);
  return (
    <Sheet open={Boolean(pipeline)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-ink-500 bg-ink-100 sm:max-w-xl">
        {pipeline && (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono text-[14px]">{pipeline.name}</SheetTitle>
              <SheetDescription>{PIPELINE_KIND_LABEL[pipeline.kind] ?? pipeline.kind} · {pipeline.engine}</SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={PIPELINE_STATUS[pipeline.status]?.tone ?? "muted"}>{PIPELINE_STATUS[pipeline.status]?.label ?? pipeline.status}</StatusPill>
                <span className="text-[11px] text-paper-muted">since {formatAgo(pipeline.statusSince)}</span>
              </div>
              {pipeline.statusReason && <p className="text-[12px] text-paper">{pipeline.statusReason}</p>}
              {pipeline.unsupported && <p className="text-[11px] text-paper-muted">{pipeline.unsupported}</p>}
              <dl className="grid grid-cols-2 gap-3 text-[12px]">
                <div><dt className={OBS_LABEL}>Source</dt><dd className="mt-1 break-all font-mono text-paper">{pipeline.sourceLabel ?? nodeLabel(pipeline.sourceNode)}</dd></div>
                <div><dt className={OBS_LABEL}>Target</dt><dd className="mt-1 break-all font-mono text-paper">{nodeLabel(pipeline.targetNode)}</dd></div>
              </dl>
              {latestError?.errorSample && (
                <div>
                  <p className={OBS_LABEL}>Latest error{latestError.errorClass ? ` · ${latestError.errorClass}` : ""}</p>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[10px] text-red-500">{latestError.errorSample}</pre>
                </div>
              )}
              <div>
                <p className={OBS_LABEL}>Samples · last 48h</p>
                {samples.isLoading ? (
                  <p className="mt-2 text-[11px] text-paper-muted">Loading…</p>
                ) : (samples.data ?? []).length === 0 ? (
                  <p className="mt-2 text-[11px] text-paper-muted">No samples yet.</p>
                ) : (
                  <DataTable label="Pipeline samples" head={["At", "Units", "Lag", "Backlog", "Errors", "Progress"]}>
                    {(samples.data ?? []).slice(0, 40).map((s) => (
                      <tr key={s.at}>
                        <td className="whitespace-nowrap font-mono text-[10px] text-paper-muted">{new Date(s.at).toLocaleTimeString()}</td>
                        <td className="tabular-nums">{formatCount(s.unitsIn)}</td>
                        <td className="tabular-nums">{formatDuration(s.lagSeconds)}</td>
                        <td className="tabular-nums">{s.backlog == null ? "—" : `${formatCount(s.backlog)}${s.backlogUnit ? ` ${s.backlogUnit}` : ""}`}</td>
                        <td className={cn("tabular-nums", (s.errors ?? 0) > 0 && "text-red-500")}>{formatCount(s.errors)}</td>
                        <td>{s.progressing == null ? "—" : s.progressing ? "yes" : <span className="text-red-500">no</span>}</td>
                      </tr>
                    ))}
                  </DataTable>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {pipeline.targetNode && <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => navigate(dataPaths.lineage(pipeline.targetNode ?? ""))}>Lineage</Button>}
                {target && <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => navigate(dataPaths.dataset(target.database, target.table))}>Target dataset</Button>}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function PipelinesTab(): ReactElement {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get("status") ?? "";
  const status = isStatus(statusParam) ? statusParam : "";
  const [kind, setKind] = useState<PipelineKind | "">("");
  const all = usePipelines();
  const [selected, setSelected] = useState<Pipeline | null>(null);

  const rows = useMemo(() => (all.data ?? []).filter((p) => (!kind || p.kind === kind) && (!status || p.status === status)), [all.data, kind, status]);
  const counts = useMemo(() => {
    const out = new Map<PipelineKind, number>();
    for (const p of all.data ?? []) out.set(p.kind, (out.get(p.kind) ?? 0) + 1);
    return out;
  }, [all.data]);

  if (all.isLoading) return <LoadingGrid />;
  if (all.isError || !all.data) return <ErrorState title="Pipelines could not be loaded." error={all.error} />;

  const summary = pipelineSummary(all.data);
  const hidden = all.data.find((p) => p.status === "retrying") ?? all.data.find((p) => ATTENTION.includes(p.status));

  return (
    <div className="space-y-4" data-onboarding-id="data-pipelines">
      <div>
        <h2 className="text-[18px] font-semibold tracking-tight text-paper">Every way data gets into ClickHouse</h2>
        <p className="mt-1 max-w-4xl text-[12px] text-paper-muted">Views, queue engines, object-storage queues, database replication, Distributed inserts, dictionaries, async inserts, external writers and scheduled jobs: one model, one status vocabulary.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Units ingested · 24h" value={formatCount(summary.units24h)} meta="Rows, messages or files" />
        <Kpi label="Errors · 24h" value={formatCount(summary.errors24h)} tone={summary.errors24h > 0 ? "bad" : undefined} meta="Including retries clients never see" />
        <Kpi label="Max lag" value={formatDuration(summary.maxLag)} meta={summary.maxLagName ?? "—"} tone={summary.maxLag !== null && summary.maxLag > 900 ? "warn" : undefined} />
        <Kpi label="Inefficient writers" value={summary.inefficient} meta="Creating merge pressure" tone={summary.inefficient > 0 ? "warn" : undefined} />
      </div>

      {hidden && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xs border border-red-500/40 bg-red-500/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" aria-hidden />
            <p className="text-[12px] text-paper"><span className="font-mono">{hidden.name}</span> is {PIPELINE_STATUS[hidden.status].label.toLowerCase()}{hidden.statusReason ? `: ${hidden.statusReason}` : ""}</p>
          </div>
          <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => setSelected(hidden)}>Inspect</Button>
        </div>
      )}

      <Panel title="Pipelines" meta={`${rows.length} of ${all.data.length}`} actions={status ? <Button variant="ghost" className="h-8 rounded-xs text-[11px]" onClick={() => { const next = new URLSearchParams(params); next.delete("status"); setParams(next); }}><X className="mr-1 h-3 w-3" /> {PIPELINE_STATUS[status].label}</Button> : undefined}>
        <div className="mb-3 flex flex-wrap gap-1" role="radiogroup" aria-label="Pipeline type">
          <Button role="radio" aria-checked={kind === ""} variant={kind === "" ? "default" : "ghost"} className="h-7 rounded-xs text-[11px]" onClick={() => setKind("")}>All {all.data.length}</Button>
          {[...counts.entries()].map(([k, n]) => (
            <Button key={k} role="radio" aria-checked={kind === k} variant={kind === k ? "default" : "ghost"} className="h-7 rounded-xs text-[11px]" onClick={() => setKind(isKind(k) ? k : "")}>{PIPELINE_KIND_LABEL[k] ?? k} {n}</Button>
          ))}
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={Workflow} title="No pipelines match" body="Pipelines are discovered from system tables on the next collector pass." />
        ) : (
          <DataTable label="Pipelines" head={["Pipeline", "Type", "Source → target", "Units · 24h", "Errors · 24h", "Status"]}>
            {rows.map((p) => {
              const st = PIPELINE_STATUS[p.status];
              return (
                <tr key={p.id} className="cursor-pointer hover:bg-ink-200/50" onClick={() => setSelected(p)}>
                  <td><button type="button" className="text-left font-mono text-[11px] text-paper hover:text-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" onClick={(e) => { e.stopPropagation(); setSelected(p); }}>{p.name}</button></td>
                  <td className="whitespace-nowrap text-paper-muted">{PIPELINE_KIND_LABEL[p.kind] ?? p.kind}<span className="block font-mono text-[10px] text-paper-faint">{p.engine}</span></td>
                  <td className="max-w-[280px]"><Mono className="block truncate text-paper-muted">{p.sourceLabel ?? nodeLabel(p.sourceNode)} → {nodeLabel(p.targetNode)}</Mono></td>
                  <td><div className="flex items-center gap-2"><Sparkline values={p.sparkline} className={st?.tone === "bad" ? "text-red-500" : undefined} label={`${p.name} throughput`} /><span className="tabular-nums text-paper-muted">{formatCount(p.units24h)}</span></div></td>
                  <td className={cn("tabular-nums", p.errors24h > 0 ? "text-red-500" : "text-paper-muted")}>{formatCount(p.errors24h)}</td>
                  <td><StatusPill tone={st?.tone ?? "muted"}>{st?.label ?? p.status}</StatusPill></td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>
      <p className="text-[10px] text-paper-faint">Need a pipeline incident? <button type="button" className="underline hover:text-paper" onClick={() => navigate(dataPaths.tab("incidents"))}>See Incidents</button>.</p>
      <SamplesSheet pipeline={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
