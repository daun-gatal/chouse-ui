/**
 * Data › Incidents: Data Health and pipeline/engine incidents in one list,
 * and the investigation view — the deterministic root-cause chain with its
 * evidence, blast radius, Chouse AI explanation, fixes and the notebook.
 */

import { useState, type ReactElement } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ArrowLeft, BellOff, Check, GitBranch, Loader2, RefreshCw, Siren, Sparkles } from "lucide-react";

import { explainIncident, type ChainStep, type IncidentExplanation, type IncidentSource, type UnifiedIncident } from "@/api/observe";
import { ACTION_TYPES } from "@/api/remediation";
import { Button } from "@/components/ui/button";
import { useAcknowledgeIncident, useSnoozeIncident } from "@/features/data-health/hooks";
import { useDataOpsModelId } from "@/hooks";
import { cn } from "@/lib/utils";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { useAcknowledgeObserveIncident, useIncident, useIncidents, useRecomputeRca } from "./hooks";
import { formatAgo, humanize, LAYER_LABEL, nodeKind, nodeLabel, severityTone } from "./lib";
import { NotebookPanel } from "./NotebookPanel";
import { dataPaths } from "./paths";
import { RemediationPanel, type ProposeDraft } from "./RemediationPanel";
import { EmptyState, ErrorState, LoadingGrid, Mono, OBS_LABEL, Panel, StatusPill } from "./ui";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function IncidentRow({ incident }: { incident: UnifiedIncident }): ReactElement {
  const navigate = useNavigate();
  return (
    <li>
      <button type="button" onClick={() => navigate(dataPaths.incident(incident.source, incident.id))} className="flex w-full items-start justify-between gap-4 px-1 py-3 text-left hover:bg-ink-200/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-paper">{incident.title}</p>
          <p className="mt-0.5 font-mono text-[10px] text-paper-muted">
            {incident.connectionName ? `${incident.connectionName} · ` : ""}{incident.source === "data_health" ? "Data Health" : humanize(incident.kind)} · opened {formatAgo(incident.openedAt)}{incident.subject ? ` · ${nodeLabel(incident.subject)}` : ""}
          </p>
          {incident.rootCause && <p className="mt-1 text-[11px] text-paper-muted"><span className="text-brand">{LAYER_LABEL[incident.rootCause.layer]}</span> · {incident.rootCause.summary}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusPill tone={severityTone(incident.severity)}>{incident.severity}</StatusPill>
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint">{incident.status}</span>
        </div>
      </button>
    </li>
  );
}

function IncidentList(): ReactElement {
  const [status, setStatus] = useState<"active" | "all">("active");
  const { data, isLoading, isError, error } = useIncidents(status);
  if (isLoading) return <LoadingGrid count={2} className="lg:grid-cols-2" />;
  if (isError || !data) return <ErrorState title="Incidents could not be loaded." error={error} />;
  return (
    <Panel
      title="Incidents"
      meta="Data Health promises, pipelines, freshness, parts, replication and capacity"
      actions={
        <div className="flex gap-1" role="radiogroup" aria-label="Incident status">
          {(["active", "all"] as const).map((s) => (
            <Button key={s} role="radio" aria-checked={status === s} variant={status === s ? "default" : "ghost"} className="h-8 rounded-xs text-[11px]" onClick={() => setStatus(s)}>{s === "active" ? "Active" : "Include recovered"}</Button>
          ))}
        </div>
      }
    >
      {data.length === 0 ? (
        <EmptyState icon={Siren} title={status === "active" ? "No active incidents" : "No incidents recorded"} body="Incidents open when a promise breaches or a pipeline, part or replica stops behaving." />
      ) : (
        <ul className="divide-y divide-ink-500/60" data-onboarding-id="data-incidents-list">{data.map((i) => <IncidentRow key={`${i.source}:${i.id}`} incident={i} />)}</ul>
      )}
    </Panel>
  );
}

function ChainView({ chain }: { chain: ChainStep[] }): ReactElement {
  return (
    <ol className="relative space-y-0">
      {chain.map((step, i) => (
        <li key={`${step.layer}:${i}`} className="relative grid grid-cols-[96px_1fr] gap-4 pb-4 last:pb-0">
          <div className="flex flex-col items-start">
            <span className={cn("font-mono text-[10px] uppercase tracking-[0.14em]", step.isRoot ? "text-brand" : "text-paper-faint")}>
              {String(i + 1).padStart(2, "0")} · {LAYER_LABEL[step.layer]}
            </span>
            {step.isRoot && <StatusPill tone="brand" dot={false} className="mt-1">Root cause</StatusPill>}
          </div>
          <div className={cn("rounded-xs border p-3", step.isRoot ? "border-brand/50 bg-brand/[0.04]" : "border-ink-500 bg-ink-200/20")}>
            <p className="text-[13px] font-medium text-paper">{step.summary}</p>
            <p className="mt-0.5 font-mono text-[10px] text-paper-muted">{step.label}{step.onsetAt ? ` · since ${new Date(step.onsetAt).toLocaleTimeString()}` : ""}</p>
            <pre className="mt-2 whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[10px] text-paper-muted">{step.evidence.source}{step.evidence.detail ? `\n${step.evidence.detail}` : ""}</pre>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ExplanationView({ explanation }: { explanation: IncidentExplanation }): ReactElement {
  return (
    <Panel title="What Chouse AI observed vs. inferred" meta={`${explanation.model} · confidence ${explanation.confidence}`} className="border-brand/30 bg-brand/[0.03]">
      <p className="text-[13px] text-paper">{explanation.summary}</p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <p className={OBS_LABEL}>Observed facts</p>
          <ul className="mt-2 space-y-1">{explanation.facts.map((f) => <li key={f} className="text-[12px] text-paper">• {f}</li>)}</ul>
        </div>
        <div>
          <p className={OBS_LABEL}>Interpretation</p>
          <ul className="mt-2 space-y-1">{explanation.interpretation.map((f) => <li key={f} className="text-[12px] text-paper-muted">• {f}</li>)}</ul>
        </div>
      </div>
      {explanation.droppedDrafts > 0 && <p className="mt-3 text-[10px] text-paper-faint">{explanation.droppedDrafts} drafted fix(es) were dropped because they were not valid catalog actions.</p>}
    </Panel>
  );
}

function BlastRadius({ items, subject }: { items: Array<{ nodeId: string; label: string; kind: string; depth: number }>; subject: string | null }): ReactElement {
  const navigate = useNavigate();
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const kind = nodeKind(item.nodeId) || item.kind;
    groups.set(kind, [...(groups.get(kind) ?? []), item.label]);
  }
  return (
    <Panel title="Blast radius" meta={`${items.length} downstream`} actions={subject ? <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => navigate(dataPaths.lineage(subject))}><GitBranch className="mr-1.5 h-3 w-3" /> Open in lineage</Button> : undefined}>
      {items.length === 0 ? (
        <p className="text-[12px] text-paper-muted">Nothing downstream is affected.</p>
      ) : (
        <dl className="space-y-2">
          {[...groups.entries()].map(([kind, labels]) => (
            <div key={kind} className="grid grid-cols-[140px_1fr] gap-3">
              <dt className={OBS_LABEL}>{humanize(kind)} · {labels.length}</dt>
              <dd className="text-[12px] text-paper">{labels.slice(0, 12).join(", ")}{labels.length > 12 ? ` +${labels.length - 12}` : ""}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}

function IncidentDetailView({ source, id }: { source: IncidentSource; id: string }): ReactElement {
  const navigate = useNavigate();
  const { hasPermission } = useRbacStore();
  const { data, isLoading, isError, error } = useIncident(source, id);
  const recompute = useRecomputeRca();
  const ackObserve = useAcknowledgeObserveIncident();
  const ackHealth = useAcknowledgeIncident();
  const snoozeHealth = useSnoozeIncident();
  const modelId = useDataOpsModelId();
  const [explanation, setExplanation] = useState<IncidentExplanation>();
  const [explaining, setExplaining] = useState(false);

  const canEditObserve = hasPermission(RBAC_PERMISSIONS.OBSERVE_EDIT);
  const canEditHealth = hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_EDIT);
  const canAck = source === "observe" ? canEditObserve : canEditHealth;
  const canExplain = hasPermission(RBAC_PERMISSIONS.AI_OPTIMIZE);

  if (isLoading) return <LoadingGrid count={3} className="lg:grid-cols-3" />;
  if (isError || !data) return <ErrorState title="This incident could not be loaded." error={error} />;

  const subject = data.database && data.table ? `table:${data.database}.${data.table}` : data.rca?.chain[0]?.nodeId ?? null;
  const drafts: ProposeDraft[] = (explanation?.actionDrafts ?? []).flatMap((d) => {
    const type = ACTION_TYPES.find((t) => t === d.type);
    return type ? [{ type, params: d.params, rationale: d.rationale }] : [];
  });

  const run = async (fn: () => Promise<unknown>, done: string): Promise<void> => {
    try {
      await fn();
      toast.success(done);
    } catch (e) {
      toast.error(errorMessage(e, "Action failed"));
    }
  };

  const explain = async (): Promise<void> => {
    setExplaining(true);
    try {
      setExplanation(await explainIncident(source, id, { modelId }));
    } catch (e) {
      toast.error(errorMessage(e, "Chouse AI could not explain this incident"));
    } finally {
      setExplaining(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button variant="ghost" className="-ml-2 h-7 rounded-xs px-2 text-[11px] text-paper-muted" onClick={() => navigate(dataPaths.tab("incidents"))}><ArrowLeft className="mr-1 h-3 w-3" /> Incidents</Button>
          <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-paper">{data.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill tone={severityTone(data.severity)}>{data.severity}</StatusPill>
            <StatusPill tone="muted" dot={false}>{data.status}</StatusPill>
            <span className="text-[11px] text-paper-muted">{data.connectionName ? `${data.connectionName} · ` : ""}Opened {formatAgo(data.openedAt)} · {source === "data_health" ? "Data Health promise" : humanize(data.kind)}</span>
            {data.acknowledgedByName && <span className="text-[11px] text-paper-muted">· acknowledged by {data.acknowledgedByName}{data.acknowledgedAt ? ` ${formatAgo(data.acknowledgedAt)}` : ""}</span>}
            {data.rca && <span className="text-[11px] text-paper-muted">· root cause computed {formatAgo(data.rca.computedAt)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canAck && data.status !== "recovered" && data.status !== "acknowledged" && (
            <Button variant="outline" className="h-9 rounded-xs" onClick={() => void run(() => (source === "observe" ? ackObserve.mutateAsync(id) : ackHealth.mutateAsync(id)), "Incident acknowledged")}>
              <Check className="mr-1.5 h-3.5 w-3.5" /> Acknowledge
            </Button>
          )}
          {source === "data_health" && canEditHealth && data.status !== "recovered" && (
            <Button variant="ghost" className="h-9 rounded-xs" onClick={() => void run(() => snoozeHealth.mutateAsync({ id, until: Date.now() + 3_600_000 }), "Incident snoozed for one hour")}>
              <BellOff className="mr-1.5 h-3.5 w-3.5" /> Snooze 1h
            </Button>
          )}
          {canEditObserve && (
            <Button variant="outline" className="h-9 rounded-xs" disabled={recompute.isPending} onClick={() => void run(() => recompute.mutateAsync({ source, id }), "Root cause recomputed")}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", recompute.isPending && "animate-spin")} /> Recompute root cause
            </Button>
          )}
          {canExplain && (
            <Button variant="outline" className="h-9 rounded-xs border-brand/40 text-brand" disabled={explaining} onClick={() => void explain()}>
              {explaining ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}Explain with Chouse AI
            </Button>
          )}
        </div>
      </div>

      <Panel title="Root cause chain" meta="Each step links to the system-table evidence it came from">
        {data.rca && data.rca.chain.length > 0 ? (
          <ChainView chain={data.rca.chain} />
        ) : (
          <EmptyState title="No root cause yet" body={canEditObserve ? "Recompute to walk the evidence from this table down to the engine." : "The chain is computed when the incident opens."} />
        )}
      </Panel>

      {explanation && <ExplanationView explanation={explanation} />}

      <div className="grid gap-4 xl:grid-cols-2">
        <RemediationPanel context={{ incidentSource: source, incidentId: id }} drafts={drafts} title="Fix drafts" />
        <div className="space-y-4">
          <BlastRadius items={data.rca?.blastRadius ?? []} subject={subject} />
          {data.rca && data.rca.related.length > 0 && (
            <Panel title="Related">
              <ul className="space-y-1.5">
                {data.rca.related.map((r) => (
                  <li key={`${r.source}:${r.id}`}>
                    <button type="button" className="text-left text-[12px] text-paper hover:text-brand" onClick={() => navigate(dataPaths.incident(r.source, r.id))}>
                      {r.relation ? <span className="text-paper-muted">{humanize(r.relation)} · </span> : null}{r.title ?? "Related incident"}
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {data.events && data.events.length > 0 && (
            <Panel title="Timeline">
              <ol className="space-y-1.5">
                {data.events.map((e) => (
                  <li key={`${e.type}:${e.at}`} className="grid grid-cols-[110px_1fr] gap-3">
                    <span className="font-mono text-[10px] text-paper-faint">{new Date(e.at).toLocaleString()}</span>
                    <Mono className="text-paper">{humanize(e.type)}</Mono>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </div>
      </div>

      <NotebookPanel kind={source === "data_health" ? "incident_data_health" : "incident_observe"} attachedRef={id} title={data.title} />
    </div>
  );
}

export function IncidentsTab({ source, id }: { source?: string; id?: string }): ReactElement {
  if ((source === "data_health" || source === "observe") && id) return <IncidentDetailView source={source} id={id} />;
  return <IncidentList />;
}
