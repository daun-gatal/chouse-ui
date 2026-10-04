/**
 * Data › Context: what a table means, for people and agents (ADR 0016 §11).
 * Derived facts come from the collectors; curated fields, canonical metrics
 * and dbt imports are owned by people. Watchers turn a sentence into a Data
 * Health promise draft that opens in the usual wizard.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { BadgeCheck, BookOpen, Eye, FileUp, Loader2, Plus, Search, Sparkles, Trash2 } from "lucide-react";

import type { CompiledWatcher, CuratedContext, TableContext } from "@/api/context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PromiseWizard, type PromiseWizardDraft } from "@/features/data-health";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { useDataOpsModelId } from "@/hooks";
import { cn } from "@/lib/utils";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { useContextMutations, useContextTables, useMetrics, useTableContext } from "./hooks";
import { formatAgo, formatBytes, formatCount, formatDuration, formatPercent, TRUST_TONE, trustTone } from "./lib";
import { DataTable, EmptyState, ErrorState, Mono, OBS_LABEL, Panel, StatusPill } from "./ui";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function emptyCurated(context: TableContext | undefined): CuratedContext {
  const c = context?.curated;
  return { description: c?.description ?? "", grain: c?.grain ?? "", owner: c?.owner ?? "", insteadOf: c?.insteadOf ?? "", deprecated: c?.deprecated ?? false, tags: c?.tags ?? [] };
}

function CuratedEditor({ context }: { context: TableContext }): ReactElement {
  const canEdit = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.CONTEXT_EDIT));
  const { save, verify } = useContextMutations();
  const [form, setForm] = useState<CuratedContext>(() => emptyCurated(context));
  const [tags, setTags] = useState((context.curated?.tags ?? []).join(", "));
  useEffect(() => {
    setForm(emptyCurated(context));
    setTags((context.curated?.tags ?? []).join(", "));
  }, [context]);

  const submit = async (): Promise<void> => {
    try {
      await save.mutateAsync({ database: context.database, table: context.table, curated: { ...form, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) } });
      toast.success("Context saved");
    } catch (e) {
      toast.error(errorMessage(e, "Could not save context"));
    }
  };

  const field = (key: "description" | "grain" | "owner" | "insteadOf", label: string, placeholder: string, multiline = false): ReactElement => (
    <div>
      <Label htmlFor={`ctx-${key}`}>{label}</Label>
      {multiline ? (
        <Textarea id={`ctx-${key}`} value={form[key] ?? ""} readOnly={!canEdit} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder} className="mt-1 rounded-xs" />
      ) : (
        <Input id={`ctx-${key}`} value={form[key] ?? ""} readOnly={!canEdit} onChange={(e) => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder} className="mt-1 rounded-xs" />
      )}
    </div>
  );

  return (
    <Panel
      title="Curated context"
      meta={context.curated?.verifiedAt ? `Verified ${formatAgo(context.curated.verifiedAt)}` : context.curated ? `Source: ${context.curated.source}` : "Nothing curated yet"}
      actions={canEdit ? (
        <>
          <Button variant="ghost" className="h-8 rounded-xs text-[11px]" disabled={!context.curated || verify.isPending} onClick={() => void verify.mutateAsync({ database: context.database, table: context.table }).then(() => toast.success("Marked as verified"), (e: unknown) => toast.error(errorMessage(e, "Could not verify")))}>
            <BadgeCheck className="mr-1.5 h-3 w-3" /> Mark verified
          </Button>
          <Button className={DH_PRIMARY} disabled={save.isPending} onClick={() => void submit()}>Save</Button>
        </>
      ) : undefined}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">{field("description", "What this table is", "One row per paid order, written by the checkout service…", true)}</div>
        {field("grain", "Grain", "one row per order")}
        {field("owner", "Owner", "finance-data")}
        {field("insteadOf", "Use instead of", "analytics.orders_v1")}
        <div>
          <Label htmlFor="ctx-tags">Tags</Label>
          <Input id="ctx-tags" value={tags} readOnly={!canEdit} onChange={(e) => setTags(e.target.value)} placeholder="finance, pii" className="mt-1 rounded-xs" />
        </div>
        <label className="flex items-center gap-2 text-[12px] text-paper-muted">
          <Checkbox checked={form.deprecated} disabled={!canEdit} onCheckedChange={(checked) => setForm({ ...form, deprecated: checked === true })} /> Deprecated — agents are told to avoid it
        </label>
      </div>
    </Panel>
  );
}

function MetricsEditor({ context }: { context: TableContext }): ReactElement {
  const canEdit = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.CONTEXT_EDIT));
  const { saveMetric, deleteMetric } = useContextMutations();
  const [name, setName] = useState("");
  const [expression, setExpression] = useState("");
  const [description, setDescription] = useState("");
  const add = async (): Promise<void> => {
    try {
      await saveMetric.mutateAsync({ database: context.database, table: context.table, metric: { name: name.trim(), expression: expression.trim(), description: description.trim() || null } });
      setName("");
      setExpression("");
      setDescription("");
      toast.success("Metric saved");
    } catch (e) {
      toast.error(errorMessage(e, "Could not save metric"));
    }
  };
  return (
    <Panel title="Canonical metrics" meta="Agents use these definitions instead of inventing aggregations">
      {context.metrics.length === 0 ? <p className="text-[12px] text-paper-muted">No metrics defined on this table.</p> : (
        <ul className="divide-y divide-ink-500/60">
          {context.metrics.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="font-mono text-[12px] text-paper">{m.name} = <span className="text-paper-muted">{m.expression}</span></p>
                {m.description && <p className="text-[11px] text-paper-muted">{m.description}</p>}
              </div>
              {canEdit && <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={`Delete metric ${m.name}`} onClick={() => void deleteMetric.mutateAsync(m.id).catch((e: unknown) => toast.error(errorMessage(e, "Delete failed")))}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-3 grid gap-2 rounded-xs border border-ink-500 p-3 md:grid-cols-[160px_1fr]">
          <Input aria-label="Metric name" value={name} onChange={(e) => setName(e.target.value)} placeholder="gmv" className="rounded-xs font-mono" />
          <Input aria-label="Metric expression" value={expression} onChange={(e) => setExpression(e.target.value)} placeholder="sumIf(amount, status = 'paid')" className="rounded-xs font-mono" />
          <Input aria-label="Metric description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it means (optional)" className="rounded-xs md:col-span-2" />
          <div className="flex justify-end md:col-span-2">
            <Button variant="outline" className="h-8 rounded-xs text-[11px]" disabled={!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.trim()) || !expression.trim() || saveMetric.isPending} onClick={() => void add()}><Plus className="mr-1 h-3 w-3" /> Add metric</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function DerivedFacts({ context }: { context: TableContext }): ReactElement {
  const d = context.derived;
  return (
    <Panel title="What CHouse learned" meta="From the catalog and query_log">
      <dl className="grid gap-x-6 gap-y-2 text-[12px] md:grid-cols-2">
        <div><dt className={OBS_LABEL}>Engine</dt><dd className="mt-0.5 font-mono text-paper">{d.engine ?? "—"}</dd></div>
        <div><dt className={OBS_LABEL}>Size</dt><dd className="mt-0.5 font-mono text-paper">{formatBytes(d.totalBytes)} · {formatCount(d.totalRows)} rows</dd></div>
        <div><dt className={OBS_LABEL}>Sorting key</dt><dd className="mt-0.5 font-mono text-paper">{d.sortingKey || "—"}</dd></div>
        <div><dt className={OBS_LABEL}>Partition key</dt><dd className="mt-0.5 font-mono text-paper">{d.partitionKey || "—"}</dd></div>
      </dl>
      {d.queryGuidance.length > 0 && (
        <>
          <p className={`${OBS_LABEL} mt-4`}>Query guidance</p>
          <ul className="mt-1 space-y-1">{d.queryGuidance.map((g) => <li key={g} className="text-[12px] text-paper">• {g}</li>)}</ul>
        </>
      )}
      {d.joins.length > 0 && (
        <>
          <p className={`${OBS_LABEL} mt-4`}>Common joins</p>
          <ul className="mt-1 space-y-1">{d.joins.map((j) => <li key={`${j.column}:${j.target}`} className="font-mono text-[11px] text-paper-muted">{j.column} → {j.target} · {formatPercent(j.share)}</li>)}</ul>
        </>
      )}
      {context.patterns.length > 0 && (
        <>
          <p className={`${OBS_LABEL} mt-4`}>Known-good query shapes</p>
          <ul className="mt-1 space-y-2">
            {context.patterns.slice(0, 5).map((p) => (
              <li key={p.fingerprint}>
                <pre className="max-h-20 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[10px] text-paper">{p.sampleQuery}</pre>
                <p className="mt-0.5 text-[10px] text-paper-faint">{formatCount(p.runs)} runs · {p.users} users · p95 {formatDuration(p.p95Ms === null ? null : p.p95Ms / 1000)}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      {d.columns.length > 0 && (
        <details className="mt-4">
          <summary className={`${OBS_LABEL} cursor-pointer`}>Columns · {d.columns.length}</summary>
          <DataTable label="Columns" head={["Column", "Type", "Comment"]}>
            {d.columns.map((c) => <tr key={c.name}><td><Mono className="text-paper">{c.name}</Mono></td><td><Mono className="text-paper-muted">{c.type}</Mono></td><td className="text-paper-muted">{c.comment ?? ""}</td></tr>)}
          </DataTable>
        </details>
      )}
    </Panel>
  );
}

function Watchers(): ReactElement {
  const { hasPermission } = useRbacStore();
  const canCompile = hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_EDIT) && hasPermission(RBAC_PERMISSIONS.AI_OPTIMIZE);
  const { compileWatcher } = useContextMutations();
  const modelId = useDataOpsModelId();
  const [text, setText] = useState("");
  const [compiled, setCompiled] = useState<CompiledWatcher>();
  const [draft, setDraft] = useState<PromiseWizardDraft>();
  if (!canCompile) return <Panel title="Watchers"><p className="text-[12px] text-paper-muted">Plain-language watchers need data_health:edit and ai:optimize.</p></Panel>;
  const compile = async (): Promise<void> => {
    try {
      setCompiled(await compileWatcher.mutateAsync({ text: text.trim(), modelId }));
    } catch (e) {
      toast.error(errorMessage(e, "Chouse AI could not compile this watcher"));
    }
  };
  return (
    <Panel title="Watchers" meta="Describe what should stay true; it becomes a reviewed Data Health promise">
      <Textarea aria-label="Watcher" value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell me when checkout orders drop more than 30% compared with the same hour last week" className="rounded-xs" />
      <div className="mt-2 flex justify-end">
        <Button variant="outline" className="h-8 rounded-xs border-brand/40 text-[11px] text-brand" disabled={text.trim().length < 5 || compileWatcher.isPending} onClick={() => void compile()}>
          {compileWatcher.isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1.5 h-3 w-3" />}Compile with Chouse AI
        </Button>
      </div>
      {compiled && (
        <div className="mt-3 rounded-xs border border-brand/30 bg-brand/[0.04] p-3">
          <p className="text-[12px] text-paper">{compiled.explanation}</p>
          <p className="mt-1 font-mono text-[10px] text-paper-faint">{compiled.draft.source.databaseName}.{compiled.draft.source.tableName} · {compiled.draft.frequency} · {compiled.model}</p>
          <details className="mt-2"><summary className={`${OBS_LABEL} cursor-pointer`}>Compiled SQL</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-2 font-mono text-[10px] text-paper-muted">{compiled.compiledSql}</pre></details>
          <Button className={cn(DH_PRIMARY, "mt-3")} onClick={() => setDraft({ databaseName: compiled.draft.source.databaseName, tableName: compiled.draft.source.tableName, name: compiled.draft.name, frequency: compiled.draft.frequency, criticality: compiled.draft.criticality, eventTimeColumn: compiled.draft.source.eventTimeColumn, checks: compiled.draft.checks })}>
            <Eye className="h-3.5 w-3.5" /> Review as promise
          </Button>
        </div>
      )}
      <PromiseWizard open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(undefined)} initialDraft={draft} />
    </Panel>
  );
}

function DbtImport(): ReactElement | null {
  const canEdit = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.CONTEXT_EDIT));
  const { importDbt } = useContextMutations();
  const input = useRef<HTMLInputElement>(null);
  if (!canEdit) return null;
  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const manifest: unknown = JSON.parse(await file.text());
      const result = await importDbt.mutateAsync(manifest);
      toast.success(`Imported ${result.imported} model descriptions${result.skipped ? ` · ${result.skipped} skipped` : ""}`);
    } catch (e) {
      toast.error(errorMessage(e, "Not a dbt manifest.json"));
    } finally {
      if (input.current) input.current.value = "";
    }
  };
  return (
    <>
      <input ref={input} type="file" accept="application/json,.json" className="hidden" aria-label="dbt manifest.json" onChange={(e) => void onFile(e.target.files?.[0])} />
      <Button variant="outline" className="h-9 rounded-xs" disabled={importDbt.isPending} onClick={() => input.current?.click()}>
        {importDbt.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileUp className="mr-1.5 h-3.5 w-3.5" />}Import dbt manifest
      </Button>
    </>
  );
}

export function ContextTab(): ReactElement {
  const [params, setParams] = useSearchParams();
  const selected = params.get("table");
  const dot = selected ? selected.indexOf(".") : -1;
  const database = selected && dot > 0 ? selected.slice(0, dot) : null;
  const table = selected && dot > 0 ? selected.slice(dot + 1) : null;
  const [search, setSearch] = useState("");
  const tables = useContextTables(search);
  const context = useTableContext(database, table);
  const metrics = useMetrics();

  const select = (fq: string): void => setParams(new URLSearchParams({ table: fq }));

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]" data-onboarding-id="data-context">
      <aside className="space-y-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-paper-faint" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tables…" aria-label="Search tables" className="h-9 rounded-xs pl-8" />
        </div>
        <DbtImport />
        <nav aria-label="Tables" className="max-h-[60vh] overflow-y-auto rounded-xs border border-ink-500 bg-ink-100">
          {(tables.data ?? []).length === 0 ? <p className="p-3 text-[11px] text-paper-muted">{tables.isLoading ? "Loading…" : "No tables"}</p> : (
            <ul>
              {(tables.data ?? []).map((t) => {
                const fq = `${t.database}.${t.table}`;
                return (
                  <li key={fq}>
                    <button type="button" aria-current={fq === selected ? "true" : undefined} onClick={() => select(fq)} className={cn("flex w-full items-center justify-between gap-2 border-b border-ink-500/60 px-3 py-2 text-left hover:bg-ink-200/60", fq === selected && "bg-ink-200")}>
                      <span className="truncate font-mono text-[11px] text-paper">{fq}</span>
                      <StatusPill tone={TRUST_TONE[t.state] ?? "muted"} className="shrink-0">{t.criticality}</StatusPill>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
        <Panel title="All metrics" meta={`${metrics.data?.length ?? 0}`}>
          {(metrics.data ?? []).length === 0 ? <p className="text-[11px] text-paper-muted">None yet.</p> : (
            <ul className="space-y-1">{(metrics.data ?? []).slice(0, 30).map((m) => <li key={m.id}><button type="button" className="text-left font-mono text-[11px] text-paper hover:text-brand" onClick={() => select(`${m.database}.${m.table}`)}>{m.name}</button> <span className="text-[10px] text-paper-faint">{m.database}.{m.table}</span></li>)}</ul>
          )}
        </Panel>
      </aside>
      <div className="min-w-0 space-y-4">
        {!selected ? (
          <Panel title="Context"><EmptyState icon={BookOpen} title="Pick a table" body="Context tells people and agents what a table means, how to query it, and which metrics are canonical." /></Panel>
        ) : context.isLoading ? (
          <p className="text-[11px] text-paper-muted">Loading context…</p>
        ) : context.isError || !context.data ? (
          <ErrorState title={`Context for ${selected} could not be loaded.`} error={context.error} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-mono text-[16px] font-semibold text-paper">{selected}</h2>
              {context.data.health.state && <StatusPill tone={trustTone(context.data.health.state)}>{context.data.health.state}</StatusPill>}
              {context.data.curated?.deprecated && <StatusPill tone="warn" dot={false}>Deprecated</StatusPill>}
            </div>
            <CuratedEditor context={context.data} />
            <div className="grid gap-4 xl:grid-cols-2">
              <MetricsEditor context={context.data} />
              <DerivedFacts context={context.data} />
            </div>
          </>
        )}
        <Watchers />
      </div>
    </div>
  );
}
