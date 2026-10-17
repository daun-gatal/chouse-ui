/**
 * AI Governance › Guardrails (ADR 0022): what every CHouse AI run, and MCP
 * tool results where enabled, passes through. Guardrails run in list order
 * within each stage; drag to reorder.
 */

import { useMemo, useState, type ReactElement } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, ShieldCheck } from "lucide-react";

import { GUARDRAIL_STAGES, type Guardrail, type GuardrailCatalog, type GuardrailStage } from "@/api/aiGuardrails";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatAgo, formatCount } from "@/features/observe/lib";
import { DataTable, EmptyState, ErrorState, Kpi, LoadingGrid, Mono, Panel, StatusPill } from "@/features/observe/ui";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { errorMessage, OriginBadge, SWITCH_CLASS } from "../assistant/shared";
import { GuardrailEditor } from "./GuardrailEditor";
import { useGuardrailEvents, useGuardrailMutations, useGuardrails } from "./hooks";
import { ACTION_TONE, moveId, STAGE_LABELS } from "./lib";
import { NewGuardrailDialog } from "./NewGuardrailDialog";

type StageFilter = "all" | GuardrailStage;

function Row({ g, catalog, canManage, sortable, onOpen }: { g: Guardrail; catalog: GuardrailCatalog; canManage: boolean; sortable: boolean; onOpen: () => void }): ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: g.id, disabled: !sortable });
  const { setState } = useGuardrailMutations();
  const change = async (state: { mode?: "shadow" | "enforce"; enabled?: boolean }, done: string): Promise<void> => {
    try {
      await setState.mutateAsync({ id: g.id, state, version: g.version });
      toast.success(done);
    } catch (error) {
      toast.error(errorMessage(error, "Could not change the guardrail"));
    }
  };
  return (
    <tr ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }} className="cursor-pointer hover:bg-ink-200/50" onClick={onOpen}>
      <td className="w-6">
        {sortable && (
          <button type="button" className="cursor-grab text-paper-faint hover:text-paper focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" aria-label={`Reorder ${g.name}`} onClick={(e) => e.stopPropagation()} {...attributes} {...listeners}>
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
      </td>
      <td>
        <button type="button" className="text-left text-[12px] text-paper hover:text-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" onClick={(e) => { e.stopPropagation(); onOpen(); }}>{g.name}</button>
        <span className="block max-w-md truncate text-[10px] text-paper-faint" title={g.description}>{catalog.kinds[g.kind].label}{g.description ? ` · ${g.description}` : ""}</span>
      </td>
      <td><span className="flex flex-wrap gap-1">{g.stages.map((s) => <span key={s} className="rounded-xs border border-ink-500 px-1.5 py-0.5 text-[10px] text-paper-muted">{STAGE_LABELS[s]}</span>)}</span></td>
      <td><StatusPill tone={ACTION_TONE[g.action]} dot={false}>{g.action}</StatusPill></td>
      <td className="text-[11px] text-paper-muted">
        {g.scope.agents === "all" ? "All agents" : `${g.scope.agents.length} agent${g.scope.agents.length === 1 ? "" : "s"}`}
        {g.scope.features !== "all" && ` · ${g.scope.features.length} feature${g.scope.features.length === 1 ? "" : "s"}`}
        {g.scope.mcp && " · MCP"}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <Select value={g.mode} disabled={!canManage || setState.isPending} onValueChange={(v) => void change({ mode: v === "shadow" ? "shadow" : "enforce" }, v === "shadow" ? `${g.name} now only records matches` : `${g.name} now enforces`)}>
          <SelectTrigger className={cn("h-7 w-28 rounded-xs text-[11px]", g.mode === "shadow" && "text-amber-500")} aria-label={`Mode of ${g.name}`}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="enforce">Enforce</SelectItem><SelectItem value="shadow">Shadow</SelectItem></SelectContent>
        </Select>
      </td>
      <td className="tabular-nums text-[11px] text-paper-muted" title={`${g.triggers24h.applied} applied, ${g.triggers24h.blocked} blocked`}>{formatCount(g.triggers24h.total)}</td>
      <td><OriginBadge row={g} /></td>
      <td onClick={(e) => e.stopPropagation()}>
        <Switch className={SWITCH_CLASS} checked={g.enabled} disabled={!canManage || setState.isPending} aria-label={`${g.enabled ? "Disable" : "Enable"} ${g.name}`}
          onCheckedChange={(enabled) => void change({ enabled }, `${g.name} ${enabled ? "enabled" : "disabled"}`)} />
      </td>
    </tr>
  );
}

function TriggersPanel({ catalog }: { catalog: GuardrailCatalog }): ReactElement {
  const [days, setDays] = useState(1);
  const events = useGuardrailEvents(days);
  return (
    <Panel title="Recent triggers" meta="Counts only: matched values are never stored"
      actions={
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="h-8 w-32 rounded-xs text-[11px]" aria-label="Trigger window"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="1">Today</SelectItem><SelectItem value="7">7 days</SelectItem><SelectItem value="30">30 days</SelectItem></SelectContent>
        </Select>
      }>
      {events.isLoading ? <LoadingGrid count={1} /> : events.isError ? <ErrorState title="Triggers could not be loaded." error={events.error} /> : (events.data ?? []).length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No triggers" body="Guardrails record here whenever they match, in shadow or enforce mode." />
      ) : (
        <DataTable label="Guardrail triggers" head={["When", "Guardrail", "Stage", "Action", "Matches", "Where", "Request"]}>
          {(events.data ?? []).map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap text-[11px] text-paper-muted">{formatAgo(e.createdAt)}</td>
              <td className="text-[12px] text-paper">{e.guardrailName}{e.reason && <span className="block text-[10px] text-paper-faint">{e.reason}</span>}</td>
              <td className="text-[11px] text-paper-muted">{STAGE_LABELS[e.stage] ?? e.stage}</td>
              <td><StatusPill tone={e.mode === "shadow" ? "muted" : ACTION_TONE[e.action]} dot={false}>{e.mode === "shadow" ? `${e.action} · shadow` : e.action}</StatusPill></td>
              <td className="tabular-nums text-[11px]">{formatCount(e.matchCount)}</td>
              <td className="text-[11px] text-paper-muted">{e.source === "mcp" ? "MCP" : e.agentPath ?? "—"}{e.tool && <Mono className="block text-[10px]">{e.tool}</Mono>}</td>
              <td className="text-[11px]">{e.requestId ? <Link className="text-brand hover:underline" to={`/ai/usage?request=${encodeURIComponent(e.requestId)}`}>Open</Link> : <span className="text-paper-faint">—</span>}</td>
            </tr>
          ))}
        </DataTable>
      )}
      <p className="mt-2 text-[11px] text-paper-faint">{catalog.guardrails.length} guardrails · triggers are kept as long as AI activity.</p>
    </Panel>
  );
}

export function GuardrailsPanel(): ReactElement {
  const canManage = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.AI_GUARDRAILS_MANAGE));
  const catalog = useGuardrails();
  const { reorder } = useGuardrailMutations();
  const [stage, setStage] = useState<StageFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const guardrails = useMemo(() => catalog.data?.guardrails ?? [], [catalog.data]);
  const shown = stage === "all" ? guardrails : guardrails.filter((g) => g.stages.includes(stage));
  if (catalog.isLoading) return <LoadingGrid count={3} />;
  if (catalog.isError || !catalog.data) return <ErrorState title="Guardrails could not be loaded." error={catalog.error} />;
  const data = catalog.data;
  const open = guardrails.find((g) => g.id === openId) ?? null;
  const totals = guardrails.reduce((t, g) => ({ total: t.total + g.triggers24h.total, applied: t.applied + g.triggers24h.applied, blocked: t.blocked + g.triggers24h.blocked }), { total: 0, applied: 0, blocked: 0 });
  const sortable = canManage && stage === "all" && !reorder.isPending;

  const onDragEnd = async (event: DragEndEvent): Promise<void> => {
    if (!event.over || event.active.id === event.over.id) return;
    const ids = moveId(guardrails.map((g) => g.id), String(event.active.id), String(event.over.id));
    try {
      await reorder.mutateAsync(ids);
    } catch (error) {
      toast.error(errorMessage(error, "Could not reorder the guardrails"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Active" value={`${guardrails.filter((g) => g.enabled).length} of ${guardrails.length}`} meta={`${guardrails.filter((g) => g.enabled && g.mode === "shadow").length} in shadow mode`} />
        <Kpi label="Triggers · 24h" value={formatCount(totals.total)} meta="Shadow and enforce" />
        <Kpi label="Applied · 24h" value={formatCount(totals.applied)} meta="Redacted, warned or logged" />
        <Kpi label="Runs blocked · 24h" value={formatCount(totals.blocked)} tone={totals.blocked > 0 ? "bad" : undefined} meta="Stopped by a block" />
      </div>
      <Panel title="Guardrails" meta={stage === "all" ? "Run top to bottom within each stage · drag to reorder" : `Only guardrails on ${STAGE_LABELS[stage].toLowerCase()}`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <Select value={stage} onValueChange={(v) => setStage(v as StageFilter)}>
              <SelectTrigger className="h-8 w-36 rounded-xs text-[11px]" aria-label="Stage"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">Every stage</SelectItem>{GUARDRAIL_STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}</SelectContent>
            </Select>
            {canManage && <Button variant="outline" className="h-8 rounded-xs text-[11px]" onClick={() => setCreating(true)}><Plus className="mr-1 h-3 w-3" /> New guardrail</Button>}
          </span>
        }>
        {shown.length === 0 ? <EmptyState icon={ShieldCheck} title="No guardrails on this stage" /> : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
            <SortableContext items={shown.map((g) => g.id)} strategy={verticalListSortingStrategy}>
              <DataTable label="Guardrails" head={["", "Guardrail", "Stages", "Action", "Scope", "Mode", "24h", "Origin", "On"]}>
                {shown.map((g) => <Row key={g.id} g={g} catalog={data} canManage={canManage} sortable={sortable} onOpen={() => setOpenId(g.id)} />)}
              </DataTable>
            </SortableContext>
          </DndContext>
        )}
      </Panel>
      <TriggersPanel catalog={data} />
      {open && <GuardrailEditor key={`${open.id}@${open.version}`} guardrail={open} catalog={data} canManage={canManage} onClose={() => setOpenId(null)} />}
      {creating && <NewGuardrailDialog catalog={data} onClose={() => setCreating(false)} />}
    </div>
  );
}
