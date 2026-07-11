import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronLeft, ChevronRight, Code2, Eye, ShieldCheck } from "lucide-react";

import { getDatabases, getTableDetails, type DatabaseInfo, type TableDetails } from "@/api/explorer";
import { listChannels, type NotificationChannel } from "@/api/alerting";
import { previewDataHealthPromise, type DataHealthCheck, type DataHealthFrequency, type DataHealthPreview, type DataHealthPromise, type DataHealthPromiseInput } from "@/api/dataHealth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore } from "@/stores";
import { cn } from "@/lib/utils";
import { useCreateDataHealthPromise, useUpdateDataHealthPromise } from "./hooks";
import { DH_LABEL, DH_PRIMARY } from "./lib";
import { RuleEditors, type CompletenessRule, type CustomMetricRule, type UniquenessRule, type ValidityRule } from "./RuleEditors";

interface FormState {
  name: string;
  description: string;
  sourceType: "table" | "query";
  databaseName: string;
  tableName: string;
  sourceQuery: string;
  eventTimeColumn: string;
  rowFilter: string;
  criticality: "standard" | "important" | "critical";
  timezone: string;
  runbookUrl: string;
  enabled: boolean;
  frequency: DataHealthFrequency;
  hour: number;
  dayOfWeek: number;
  dayOfMonth: number;
  cronExpr: string;
  graceMinutes: number;
  breachAfter: number;
  recoverAfter: number;
  retentionDays: number;
  timeoutSecs: number;
  channelIds: string[];
  freshness: boolean;
  freshnessMinutes: number;
  rowCount: boolean;
  rowCountMin: string;
  rowCountMax: string;
  anomaly: boolean;
  anomalyHardMin: string;
  completenessRules: CompletenessRule[];
  uniquenessRules: UniquenessRule[];
  validityRules: ValidityRule[];
  schemaContract: boolean;
  allowAdditionalColumns: boolean;
  customMetricRules: CustomMetricRule[];
}

const STEPS = ["Dataset", "Health promise", "Review"] as const;

function defaultForm(): FormState {
  return {
    name: "", description: "", sourceType: "table", databaseName: "", tableName: "", sourceQuery: "", eventTimeColumn: "", rowFilter: "",
    criticality: "important", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", runbookUrl: "", enabled: true,
    frequency: "daily", hour: 8, dayOfWeek: 1, dayOfMonth: 1, cronExpr: "", graceMinutes: 15, breachAfter: 2, recoverAfter: 2, retentionDays: 90, timeoutSecs: 60, channelIds: [],
    freshness: true, freshnessMinutes: 60, rowCount: true, rowCountMin: "1", rowCountMax: "", anomaly: true, anomalyHardMin: "",
    completenessRules: [], uniquenessRules: [], validityRules: [], schemaContract: true, allowAdditionalColumns: true,
    customMetricRules: [],
  };
}

function findCheck(promise: DataHealthPromise, type: DataHealthCheck["type"]): DataHealthCheck | undefined {
  return promise.checks.find((check) => check.type === type);
}

function formFromPromise(promise: DataHealthPromise): FormState {
  const form = defaultForm();
  const freshness = findCheck(promise, "freshness");
  const rows = findCheck(promise, "row_count");
  const anomaly = findCheck(promise, "volume_anomaly");
  const schema = findCheck(promise, "schema_contract");
  const completenessRules: CompletenessRule[] = promise.checks.flatMap((check) => check.type === "completeness" ? [{ checkKey: check.checkKey, column: check.config.column, minPercent: check.config.minRatio * 100 }] : []);
  const uniquenessRules: UniquenessRule[] = promise.checks.flatMap((check) => check.type === "uniqueness" ? [{ checkKey: check.checkKey, columns: check.config.columns, maxDuplicatePercent: check.config.maxDuplicateRatio * 100 }] : []);
  const validityRules: ValidityRule[] = promise.checks.flatMap((check) => check.type === "validity" ? [{ checkKey: check.checkKey, name: check.name, predicate: check.config.predicate, minPercent: check.config.minRatio * 100 }] : []);
  const customMetricRules: CustomMetricRule[] = promise.checks.flatMap((check) => check.type === "custom_metric" ? [{ checkKey: check.checkKey, name: check.name, expression: check.config.expression, operator: check.config.operator, threshold: check.config.threshold, upperThreshold: check.config.upperThreshold ?? 0 }] : []);
  return {
    ...form,
    name: promise.name, description: promise.description ?? "", sourceType: promise.sourceType,
    databaseName: promise.databaseName ?? "", tableName: promise.tableName ?? "", sourceQuery: promise.sourceQuery ?? "",
    eventTimeColumn: promise.eventTimeColumn ?? "", rowFilter: promise.rowFilter ?? "", criticality: promise.criticality,
    timezone: promise.timezone, runbookUrl: promise.runbookUrl ?? "", enabled: promise.enabled,
    frequency: promise.schedule.frequency, hour: promise.schedule.hour, dayOfWeek: promise.schedule.dayOfWeek,
    dayOfMonth: promise.schedule.dayOfMonth, cronExpr: promise.schedule.cronExpr ?? "", graceMinutes: Math.round(promise.graceSecs / 60),
    breachAfter: promise.breachAfter, recoverAfter: promise.recoverAfter, retentionDays: promise.retentionDays,
    timeoutSecs: promise.schedule.timeoutSecs, channelIds: promise.channelIds,
    freshness: Boolean(freshness), freshnessMinutes: freshness?.type === "freshness" ? Math.round(freshness.config.maxAgeSeconds / 60) : 60,
    rowCount: Boolean(rows), rowCountMin: rows?.type === "row_count" && rows.config.min != null ? String(rows.config.min) : "", rowCountMax: rows?.type === "row_count" && rows.config.max != null ? String(rows.config.max) : "",
    anomaly: Boolean(anomaly), anomalyHardMin: anomaly?.type === "volume_anomaly" && anomaly.config.hardMin != null ? String(anomaly.config.hardMin) : "",
    completenessRules, uniquenessRules, validityRules,
    schemaContract: Boolean(schema), allowAdditionalColumns: schema?.type === "schema_contract" ? schema.config.allowAdditionalColumns : true,
    customMetricRules,
  };
}

function CheckToggle({ checked, onCheckedChange, title, description, children }: { checked: boolean; onCheckedChange: (checked: boolean) => void; title: string; description: string; children?: React.ReactNode }) {
  return <div className={cn("rounded-xs border p-3", checked ? "border-brand/50 bg-brand/5" : "border-ink-500 bg-ink-200/30")}><div className="flex items-start justify-between gap-3"><div><p className="text-[12px] font-medium text-paper">{title}</p><p className="mt-0.5 text-[10px] text-paper-muted">{description}</p></div><Switch checked={checked} onCheckedChange={onCheckedChange} /></div>{checked && children && <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>}</div>;
}

export function PromiseWizard({ open, onOpenChange, promise }: { open: boolean; onOpenChange: (open: boolean) => void; promise?: DataHealthPromise }) {
  const activeConnectionId = useAuthStore((state) => state.activeConnectionId);
  const activeConnectionName = useAuthStore((state) => state.activeConnectionName);
  const createMutation = useCreateDataHealthPromise();
  const updateMutation = useUpdateDataHealthPromise();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [tableDetails, setTableDetails] = useState<TableDetails>();
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [preview, setPreview] = useState<DataHealthPreview>();
  const [previewing, setPreviewing] = useState(false);
  const update = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  useEffect(() => {
    if (!open) return;
    setStep(0); setPreview(undefined); setTableDetails(undefined); setForm(promise ? formFromPromise(promise) : defaultForm());
    let active = true;
    void Promise.all([getDatabases(), listChannels()]).then(([databaseRows, channelRows]) => { if (active) { setDatabases(databaseRows); setChannels(channelRows.filter((channel) => channel.enabled)); } }).catch(() => { if (active) toast.error("Could not load dataset metadata"); });
    return () => { active = false; };
  }, [open, promise]);

  useEffect(() => {
    if (!open || form.sourceType !== "table" || !form.databaseName || !form.tableName) return;
    let active = true;
    void getTableDetails(form.databaseName, form.tableName).then((details) => {
      if (!active) return;
      setTableDetails(details);
      if (!promise) {
        const timeColumn = details.columns.find((column) => /Date|Time/i.test(column.type))?.name ?? "";
        update({ eventTimeColumn: form.eventTimeColumn || timeColumn });
      }
    }).catch(() => { if (active) toast.error("Could not inspect the selected table"); });
    return () => { active = false; };
  }, [open, promise, form.sourceType, form.databaseName, form.tableName]);

  const columns = tableDetails?.columns ?? [];
  const tables = databases.find((database) => database.name === form.databaseName)?.children ?? [];
  const checks = useMemo<DataHealthCheck[]>(() => {
    const result: DataHealthCheck[] = [];
    if (form.freshness && form.eventTimeColumn) result.push({ checkKey: "freshness", name: "Delivery freshness", type: "freshness", severity: "critical", enabled: true, config: { eventTimeColumn: form.eventTimeColumn, maxAgeSeconds: form.freshnessMinutes * 60 } });
    if (form.rowCount) result.push({ checkKey: "row_count", name: "Row volume", type: "row_count", severity: "critical", enabled: true, config: { min: form.rowCountMin ? Number(form.rowCountMin) : undefined, max: form.rowCountMax ? Number(form.rowCountMax) : undefined } });
    if (form.anomaly) result.push({ checkKey: "volume_anomaly", name: "Learned volume range", type: "volume_anomaly", severity: "warning", enabled: true, config: { minSamples: 7, sensitivity: 3, minRelativeBand: 0.1, hardMin: form.anomalyHardMin ? Number(form.anomalyHardMin) : undefined } });
    for (const rule of form.completenessRules) if (rule.column) result.push({ checkKey: rule.checkKey, name: `${rule.column} completeness`, type: "completeness", severity: "warning", enabled: true, config: { column: rule.column, minRatio: rule.minPercent / 100 } });
    for (const rule of form.uniquenessRules) if (rule.columns.length > 0) result.push({ checkKey: rule.checkKey, name: `${rule.columns.join(" + ")} uniqueness`, type: "uniqueness", severity: "critical", enabled: true, config: { columns: rule.columns, maxDuplicateRatio: rule.maxDuplicatePercent / 100 } });
    for (const rule of form.validityRules) if (rule.predicate.trim()) result.push({ checkKey: rule.checkKey, name: rule.name.trim() || "Business-rule validity", type: "validity", severity: "warning", enabled: true, config: { predicate: rule.predicate.trim(), minRatio: rule.minPercent / 100 } });
    if (form.schemaContract && columns.length > 0) result.push({ checkKey: "schema_contract", name: "Schema contract", type: "schema_contract", severity: "critical", enabled: true, config: { expectedColumns: columns.map((column) => ({ name: column.name, type: column.type })), allowAdditionalColumns: form.allowAdditionalColumns } });
    for (const rule of form.customMetricRules) if (rule.expression.trim()) result.push({ checkKey: rule.checkKey, name: rule.name.trim() || "Custom metric", type: "custom_metric", severity: "warning", enabled: true, config: { expression: rule.expression.trim(), operator: rule.operator, threshold: rule.threshold, upperThreshold: rule.operator === "between" ? rule.upperThreshold : undefined } });
    return result;
  }, [form, columns]);

  const buildInput = (): DataHealthPromiseInput => ({
    name: form.name.trim(), description: form.description.trim() || null, connectionId: promise?.connectionId ?? activeConnectionId ?? "",
    source: form.sourceType === "table" ? { sourceType: "table", databaseName: form.databaseName, tableName: form.tableName, eventTimeColumn: form.eventTimeColumn || undefined, rowFilter: form.rowFilter.trim() || null } : { sourceType: "query", sourceQuery: form.sourceQuery.trim(), eventTimeColumn: form.eventTimeColumn || undefined, rowFilter: form.rowFilter.trim() || null },
    ownerId: promise?.ownerId ?? null, criticality: form.criticality, timezone: form.timezone, runbookUrl: form.runbookUrl.trim() || null, enabled: form.enabled,
    frequency: form.frequency, hour: form.hour, dayOfWeek: form.dayOfWeek, dayOfMonth: form.dayOfMonth, cronExpr: form.frequency === "cron" ? form.cronExpr.trim() : null,
    graceSecs: form.graceMinutes * 60, breachAfter: form.breachAfter, recoverAfter: form.recoverAfter, retentionDays: form.retentionDays, timeoutSecs: form.timeoutSecs,
    channelIds: form.channelIds, checks, runNow: !promise,
  });

  const createRuleKey = (prefix: string): string => {
    const used = new Set([
      ...form.completenessRules.map((rule) => rule.checkKey),
      ...form.uniquenessRules.map((rule) => rule.checkKey),
      ...form.validityRules.map((rule) => rule.checkKey),
      ...form.customMetricRules.map((rule) => rule.checkKey),
      "freshness", "row_count", "volume_anomaly", "schema_contract",
    ]);
    let index = 1;
    while (used.has(`${prefix}_${index}`)) index++;
    return `${prefix}_${index}`;
  };

  const ruleDefinitionsValid = form.completenessRules.every((rule) => Boolean(rule.column.trim()) && Number.isFinite(rule.minPercent) && rule.minPercent >= 0 && rule.minPercent <= 100)
    && new Set(form.completenessRules.map((rule) => rule.column)).size === form.completenessRules.length
    && form.uniquenessRules.every((rule) => rule.columns.length > 0 && rule.columns.length <= 10 && new Set(rule.columns).size === rule.columns.length && Number.isFinite(rule.maxDuplicatePercent) && rule.maxDuplicatePercent >= 0 && rule.maxDuplicatePercent <= 100)
    && form.validityRules.every((rule) => Boolean(rule.name.trim()) && Boolean(rule.predicate.trim()) && Number.isFinite(rule.minPercent) && rule.minPercent >= 0 && rule.minPercent <= 100)
    && form.customMetricRules.every((rule) => Boolean(rule.name.trim()) && Boolean(rule.expression.trim()) && Number.isFinite(rule.threshold) && (rule.operator !== "between" || (Number.isFinite(rule.upperThreshold) && rule.threshold <= rule.upperThreshold)));
  const needsEventTime = form.freshness || form.rowCount || form.anomaly || form.completenessRules.length > 0 || form.uniquenessRules.length > 0 || form.validityRules.length > 0;
  const canContinue = step === 0 ? Boolean((promise?.connectionId || activeConnectionId) && form.name.trim() && (form.sourceType === "table" ? form.databaseName && form.tableName : form.sourceQuery.trim()) && (!needsEventTime || form.eventTimeColumn)) : step === 1 ? checks.length > 0 && ruleDefinitionsValid && (form.frequency !== "cron" || Boolean(form.cronExpr.trim())) : true;
  const runPreview = async () => { setPreviewing(true); try { const result = await previewDataHealthPromise(buildInput()); setPreview(result); toast.success("Promise validated"); } catch (error) { toast.error(error instanceof Error ? error.message : "Preview failed"); } finally { setPreviewing(false); } };
  const submit = async () => { try { const input = buildInput(); if (promise) await updateMutation.mutateAsync({ id: promise.id, input }); else await createMutation.mutateAsync(input); toast.success(promise ? "Data Health promise updated" : "Dataset protection activated"); onOpenChange(false); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save the promise"); } };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[92vh] max-w-4xl flex-col overflow-hidden rounded-xs border-ink-500 bg-ink-100 p-0 text-paper"><DialogHeader className="border-b border-ink-500 px-6 py-5"><DialogTitle>{promise ? "Edit Data Health promise" : "Protect a dataset"}</DialogTitle><DialogDescription>Describe what healthy data means. CHouse will generate, schedule, and evaluate the monitor.</DialogDescription><div className="mt-4 flex gap-1">{STEPS.map((label, index) => <div key={label} className={cn("flex flex-1 items-center gap-2 border-t-2 pt-2", index <= step ? "border-brand text-paper" : "border-ink-500 text-paper-faint")}><span className="font-mono text-[9px]">0{index + 1}</span><span className="font-mono text-[10px] uppercase tracking-[0.12em]">{label}</span></div>)}</div></DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {step === 0 && <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><div><Label>Promise name</Label><Input value={form.name} onChange={(event) => update({ name: event.target.value })} placeholder="Daily orders are ready" className="mt-1 rounded-xs" /></div><div><Label>Connection</Label><Input value={activeConnectionName ?? promise?.connectionId ?? "No active connection"} disabled className="mt-1 rounded-xs" /></div></div><div><Label>Description</Label><Textarea value={form.description} onChange={(event) => update({ description: event.target.value })} placeholder="Who relies on this data and why it matters…" className="mt-1 rounded-xs" /></div><div><Label>Dataset source</Label><div className="mt-1 grid grid-cols-2 gap-2"><Button type="button" variant={form.sourceType === "table" ? "default" : "outline"} className="rounded-xs" onClick={() => update({ sourceType: "table" })}>Table or view</Button><Button type="button" variant={form.sourceType === "query" ? "default" : "outline"} className="rounded-xs" onClick={() => update({ sourceType: "query", schemaContract: false })}><Code2 className="mr-2 h-3.5 w-3.5" /> Dataset query</Button></div></div>{form.sourceType === "table" ? <div className="grid gap-4 sm:grid-cols-2"><div><Label>Database</Label><Select value={form.databaseName} onValueChange={(value) => update({ databaseName: value, tableName: "" })}><SelectTrigger className="mt-1 rounded-xs"><SelectValue placeholder="Select database" /></SelectTrigger><SelectContent>{databases.map((database) => <SelectItem key={database.name} value={database.name}>{database.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Table or view</Label><Select value={form.tableName} onValueChange={(value) => update({ tableName: value })}><SelectTrigger className="mt-1 rounded-xs"><SelectValue placeholder="Select table" /></SelectTrigger><SelectContent>{tables.map((table) => <SelectItem key={table.name} value={table.name}>{table.name}</SelectItem>)}</SelectContent></Select></div></div> : <div><Label>Read-only dataset query</Label><Textarea value={form.sourceQuery} onChange={(event) => update({ sourceQuery: event.target.value })} placeholder="SELECT * FROM analytics.orders" className="mt-1 min-h-32 rounded-xs font-mono text-[11px]" /></div>}<div className="grid gap-4 sm:grid-cols-2"><div><Label>Event-time column</Label>{form.sourceType === "query" ? <Input value={form.eventTimeColumn} onChange={(event) => update({ eventTimeColumn: event.target.value })} placeholder="created_at" className="mt-1 rounded-xs font-mono" /> : <Select value={form.eventTimeColumn || "none"} onValueChange={(value) => update({ eventTimeColumn: value === "none" ? "" : value })}><SelectTrigger className="mt-1 rounded-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No event-time column</SelectItem>{columns.filter((column) => /Date|Time/i.test(column.type)).map((column) => <SelectItem key={column.name} value={column.name}>{column.name} · {column.type}</SelectItem>)}</SelectContent></Select>}<p className="mt-1 text-[10px] text-paper-faint">Required for windowed checks and bounded scans.</p></div><div><Label>Optional row filter</Label><Input value={form.rowFilter} onChange={(event) => update({ rowFilter: event.target.value })} placeholder="environment = 'production'" className="mt-1 rounded-xs font-mono" /></div></div></div>}
        {step === 1 && (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <div><Label>Evaluation cadence</Label><Select value={form.frequency} onValueChange={(value) => update({ frequency: value as DataHealthFrequency })}><SelectTrigger className="mt-1 rounded-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="cron">Custom cron</SelectItem><SelectItem value="manual">Manual only</SelectItem></SelectContent></Select></div>
              {form.frequency !== "manual" && form.frequency !== "cron" && <div><Label>Business hour</Label><Input type="number" min={0} max={23} value={form.hour} onChange={(event) => update({ hour: Number(event.target.value) })} className="mt-1 rounded-xs" /></div>}
              {form.frequency === "cron" && <div><Label>Cron expression</Label><Input value={form.cronExpr} onChange={(event) => update({ cronExpr: event.target.value })} placeholder="0 8 * * *" className="mt-1 rounded-xs font-mono" /></div>}
              <div><Label>Business timezone</Label><Input value={form.timezone} onChange={(event) => update({ timezone: event.target.value })} className="mt-1 rounded-xs" /></div>
            </div>
            <div>
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand" /><p className={DH_LABEL}>What must remain true?</p></div>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                <CheckToggle checked={form.freshness} onCheckedChange={(freshness) => update({ freshness })} title="Delivery freshness" description="Latest event must arrive within the promised delay."><div><Label>Maximum delay, minutes</Label><Input type="number" min={1} value={form.freshnessMinutes} onChange={(event) => update({ freshnessMinutes: Number(event.target.value) })} className="mt-1 rounded-xs" /></div></CheckToggle>
                <CheckToggle checked={form.rowCount} onCheckedChange={(rowCount) => update({ rowCount })} title="Row volume" description="Protect against empty, partial, or unexpectedly large windows."><div><Label>Minimum rows</Label><Input type="number" value={form.rowCountMin} onChange={(event) => update({ rowCountMin: event.target.value })} className="mt-1 rounded-xs" /></div><div><Label>Maximum rows</Label><Input type="number" value={form.rowCountMax} onChange={(event) => update({ rowCountMax: event.target.value })} placeholder="Optional" className="mt-1 rounded-xs" /></div></CheckToggle>
                <CheckToggle checked={form.anomaly} onCheckedChange={(anomaly) => update({ anomaly })} title="Learned volume range" description="Compare each window with a transparent robust baseline."><div><Label>Hard minimum while learning</Label><Input type="number" value={form.anomalyHardMin} onChange={(event) => update({ anomalyHardMin: event.target.value })} placeholder="Optional" className="mt-1 rounded-xs" /></div></CheckToggle>
                <CheckToggle checked={form.schemaContract} onCheckedChange={(schemaContract) => update({ schemaContract })} title="Schema contract" description="Detect removed or retyped columns."><label className="col-span-full flex items-center gap-2 text-[11px] text-paper-muted"><Checkbox checked={form.allowAdditionalColumns} onCheckedChange={(checked) => update({ allowAdditionalColumns: checked === true })} /> Allow new columns</label></CheckToggle>
              </div>
            </div>
            <RuleEditors
              columns={columns}
              completenessRules={form.completenessRules}
              uniquenessRules={form.uniquenessRules}
              validityRules={form.validityRules}
              customMetricRules={form.customMetricRules}
              onCompletenessRulesChange={(completenessRules) => update({ completenessRules })}
              onUniquenessRulesChange={(uniquenessRules) => update({ uniquenessRules })}
              onValidityRulesChange={(validityRules) => update({ validityRules })}
              onCustomMetricRulesChange={(customMetricRules) => update({ customMetricRules })}
              createKey={createRuleKey}
            />
            {!ruleDefinitionsValid && <p className="text-[11px] text-red-500">Complete every added rule, keep percentages between 0 and 100, and ensure “between” minimums do not exceed maximums.</p>}
            <div className="grid gap-4 sm:grid-cols-3">
              <div><Label>Alert after breaches</Label><Input type="number" min={1} max={20} value={form.breachAfter} onChange={(event) => update({ breachAfter: Number(event.target.value) })} className="mt-1 rounded-xs" /></div>
              <div><Label>Recover after passes</Label><Input type="number" min={1} max={20} value={form.recoverAfter} onChange={(event) => update({ recoverAfter: Number(event.target.value) })} className="mt-1 rounded-xs" /></div>
              <div><Label>Grace period, minutes</Label><Input type="number" min={0} value={form.graceMinutes} onChange={(event) => update({ graceMinutes: Number(event.target.value) })} className="mt-1 rounded-xs" /></div>
            </div>
            <div><Label>Notify on incident transitions</Label><div className="mt-2 grid gap-2 sm:grid-cols-2">{channels.map((channel) => <label key={channel.id} className="flex items-center gap-2 rounded-xs border border-ink-500 p-2 text-[11px] text-paper-muted"><Checkbox checked={form.channelIds.includes(channel.id)} onCheckedChange={(checked) => update({ channelIds: checked === true ? [...form.channelIds, channel.id] : form.channelIds.filter((id) => id !== channel.id) })} />{channel.name}<span className="ml-auto font-mono text-[9px] uppercase text-paper-faint">{channel.type}</span></label>)}{channels.length === 0 && <p className="text-[11px] text-paper-faint">No enabled notification channels. Configure one under Admin → Alerting.</p>}</div></div>
          </div>
        )}
        {step === 2 && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xs border border-ink-500 bg-ink-200/30 p-3"><p className={DH_LABEL}>Dataset</p><p className="mt-2 text-[12px] text-paper">{form.sourceType === "table" ? `${form.databaseName}.${form.tableName}` : "Custom query"}</p></div><div className="rounded-xs border border-ink-500 bg-ink-200/30 p-3"><p className={DH_LABEL}>Evaluation</p><p className="mt-2 text-[12px] text-paper">{form.frequency} · {form.timezone}</p></div><div className="rounded-xs border border-ink-500 bg-ink-200/30 p-3"><p className={DH_LABEL}>Coverage</p><p className="mt-2 text-[12px] text-paper">{checks.length} checks · {form.channelIds.length} channels</p></div></div><div><p className={DH_LABEL}>Checks to activate</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{checks.map((check) => <div key={check.checkKey} className="flex items-center gap-2 rounded-xs border border-ink-500 p-3"><CheckCircle2 className="h-4 w-4 text-emerald-500" /><div><p className="text-[11px] text-paper">{check.name}</p><p className="font-mono text-[9px] uppercase text-paper-faint">{check.type.replace("_", " ")} · {check.severity}</p></div></div>)}</div></div><div className="rounded-xs border border-brand/30 bg-brand/5 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[12px] font-medium text-paper">Validate before activation</p><p className="mt-1 text-[10px] text-paper-muted">Checks access, generated SQL, cadence, and upcoming evaluation slots.</p></div><Button variant="outline" className="h-8 rounded-xs" onClick={() => void runPreview()} disabled={previewing}><Eye className="mr-2 h-3.5 w-3.5" /> {previewing ? "Validating…" : "Preview"}</Button></div>{preview && <div className="mt-3 border-t border-brand/20 pt-3"><p className="font-mono text-[10px] text-emerald-500">Valid · {preview.metricCheckKeys.length} metrics · {preview.schemaCheckKeys.length} schema checks</p>{preview.nextFireTimes.length > 0 && <p className="mt-1 text-[10px] text-paper-muted">Next: {preview.nextFireTimes.slice(0, 3).map((time) => new Date(time).toLocaleString()).join(" · ")}</p>}<details className="mt-2"><summary className="cursor-pointer font-mono text-[9px] uppercase text-paper-faint">Generated SQL</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-3 font-mono text-[10px] text-paper-muted">{preview.compiledSql}</pre></details></div>}</div></div>}
      </div><DialogFooter className="border-t border-ink-500 px-6 py-4"><div className="flex w-full items-center justify-between"><Button variant="ghost" onClick={() => step === 0 ? onOpenChange(false) : setStep((current) => current - 1)}><ChevronLeft className="mr-1 h-4 w-4" />{step === 0 ? "Cancel" : "Back"}</Button>{step < STEPS.length - 1 ? <Button className={DH_PRIMARY} disabled={!canContinue} onClick={() => setStep((current) => current + 1)}>Continue <ChevronRight className="h-4 w-4" /></Button> : <Button className={DH_PRIMARY} onClick={() => void submit()} disabled={createMutation.isPending || updateMutation.isPending || checks.length === 0}>{promise ? "Save changes" : "Activate promise"}</Button>}</div></DialogFooter></DialogContent></Dialog>
  );
}
