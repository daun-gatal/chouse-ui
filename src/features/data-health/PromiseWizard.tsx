import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronLeft, ChevronRight, Code2, Eye, ShieldCheck, Sparkles, Loader2, Info } from "lucide-react";

import { getDatabases, getTableDetails, type DatabaseInfo, type TableDetails } from "@/api/explorer";
import { listChannels, type NotificationChannel } from "@/api/alerting";
import { describeDataHealthColumns, previewDataHealthPromise, type DataHealthCheck, type DataHealthColumn, type DataHealthEventTimeEncoding, type DataHealthFrequency, type DataHealthPreview, type DataHealthPromise, type DataHealthPromiseInput } from "@/api/dataHealth";
import { recommendHealthPromise, type HealthPromiseRecommendation } from "@/api/dataOpsAi";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDataOpsModelId, useDebounce } from "@/hooks";
import { RBAC_PERMISSIONS, useAuthStore, useRbacStore } from "@/stores";
import { cn } from "@/lib/utils";
import { useCreateDataHealthPromise, useUpdateDataHealthPromise } from "./hooks";
import { detectEventTimeColumn, DH_LABEL, DH_PRIMARY, eventTimeSupport, isDateOnlyColumnType, isSupportedEventTimeColumnType, suggestEventTimeEncoding } from "./lib";
import { RuleEditors, type CompletenessRule, type CustomMetricRule, type UniquenessRule, type ValidityRule } from "./RuleEditors";

interface FormState {
  name: string;
  description: string;
  sourceType: "table" | "query";
  databaseName: string;
  tableName: string;
  sourceQuery: string;
  eventTimeColumn: string;
  eventTimeEncoding: DataHealthEventTimeEncoding;
  eventTimeTimezone: string;
  queryNativeEventTimeType: "DateTime" | "Date";
  rowFilter: string;
  criticality: "standard" | "important" | "critical";
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
    name: "", description: "", sourceType: "table", databaseName: "", tableName: "", sourceQuery: "", eventTimeColumn: "", eventTimeEncoding: "native", eventTimeTimezone: "", queryNativeEventTimeType: "DateTime", rowFilter: "",
    criticality: "important", runbookUrl: "", enabled: true,
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
  const savedEncoding = promise.eventTimeEncoding === "auto" && eventTimeSupport(promise.eventTimeType ?? "") === "native"
    ? "native"
    : promise.eventTimeEncoding;
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
    eventTimeColumn: promise.eventTimeColumn ?? "", eventTimeEncoding: savedEncoding, eventTimeTimezone: promise.eventTimeTimezone ?? "", queryNativeEventTimeType: isDateOnlyColumnType(promise.eventTimeType) ? "Date" : "DateTime", rowFilter: promise.rowFilter ?? "", criticality: promise.criticality,
    runbookUrl: promise.runbookUrl ?? "", enabled: promise.enabled,
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

function HintIcon({ label, hint }: { label: string; hint: string }) {
  return <TooltipProvider delayDuration={150}><Tooltip><TooltipTrigger asChild><button type="button" aria-label={`About ${label}`} className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-paper-faint transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"><Info className="h-3 w-3" /></button></TooltipTrigger><TooltipContent side="top" className="max-w-72 rounded-xs border-ink-500 bg-ink-200 text-[11px] leading-relaxed text-paper">{hint}</TooltipContent></Tooltip></TooltipProvider>;
}

function HintLabel({ children, hint }: { children: React.ReactNode; hint: string }) {
  const label = typeof children === "string" ? children : "this field";
  return <div className="flex items-center gap-1.5"><Label>{children}</Label><HintIcon label={label} hint={hint} /></div>;
}

function CheckToggle({ checked, onCheckedChange, title, description, hint, children }: { checked: boolean; onCheckedChange: (checked: boolean) => void; title: string; description: string; hint?: string; children?: React.ReactNode }) {
  return <div className={cn("rounded-xs border p-3", checked ? "border-brand/50 bg-brand/5" : "border-ink-500 bg-ink-200/30")}><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-1.5"><p className="text-[12px] font-medium text-paper">{title}</p>{hint && <HintIcon label={title} hint={hint} />}</div><p className="mt-0.5 text-[10px] text-paper-muted">{description}</p></div><Switch checked={checked} onCheckedChange={onCheckedChange} /></div>{checked && children && <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>}</div>;
}

export function PromiseWizard({ open, onOpenChange, promise }: { open: boolean; onOpenChange: (open: boolean) => void; promise?: DataHealthPromise }) {
  const activeConnectionId = useAuthStore((state) => state.activeConnectionId);
  const activeConnectionName = useAuthStore((state) => state.activeConnectionName);
  const canUseAi = useRbacStore((state) => state.hasPermission(RBAC_PERMISSIONS.AI_OPTIMIZE));
  const modelId = useDataOpsModelId();
  const createMutation = useCreateDataHealthPromise();
  const updateMutation = useUpdateDataHealthPromise();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [tableDetails, setTableDetails] = useState<TableDetails>();
  const [queryColumns, setQueryColumns] = useState<DataHealthColumn[]>([]);
  const [describingQuery, setDescribingQuery] = useState(false);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [preview, setPreview] = useState<DataHealthPreview>();
  const [previewing, setPreviewing] = useState(false);
  const [recommending, setRecommending] = useState(false);
  const [recommendation, setRecommendation] = useState<HealthPromiseRecommendation>();
  const update = (patch: Partial<FormState>) => setForm((current) => {
    if (patch.eventTimeColumn !== undefined && patch.eventTimeColumn !== current.eventTimeColumn && patch.eventTimeEncoding === undefined) {
      const source = current.sourceType === "table" ? tableDetails?.columns : queryColumns;
      const column = source?.find((candidate) => candidate.name === patch.eventTimeColumn);
      const requestedFreshnessMinutes = patch.freshnessMinutes ?? current.freshnessMinutes;
      const requestedFrequency = patch.frequency ?? current.frequency;
      return {
        ...current,
        ...patch,
        eventTimeEncoding: column ? suggestEventTimeEncoding(column) : "native",
        queryNativeEventTimeType: column && current.sourceType === "query" ? (isDateOnlyColumnType(column.type) ? "Date" : "DateTime") : current.queryNativeEventTimeType,
        eventTimeTimezone: "",
        freshnessMinutes: column && isDateOnlyColumnType(column.type) ? Math.max(requestedFreshnessMinutes, 1440) : requestedFreshnessMinutes,
        frequency: column && isDateOnlyColumnType(column.type) && (requestedFrequency === "cron" || requestedFrequency === "manual") ? "daily" : requestedFrequency,
      };
    }
    return { ...current, ...patch };
  });

  useEffect(() => {
    if (!open) return;
    setStep(0); setPreview(undefined); setRecommendation(undefined); setTableDetails(undefined); setQueryColumns([]); setForm(promise ? formFromPromise(promise) : defaultForm());
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
      setForm((current) => {
        if (current.databaseName !== details.database || current.tableName !== details.table) return current;
        const selectedColumnIsValid = details.columns.some((column) =>
          column.name === current.eventTimeColumn && isSupportedEventTimeColumnType(column.type));
        if (selectedColumnIsValid) return current;
        const eventTimeColumn = detectEventTimeColumn(details.columns);
        const column = details.columns.find((candidate) => candidate.name === eventTimeColumn);
        return {
          ...current,
          eventTimeColumn,
          eventTimeEncoding: column ? suggestEventTimeEncoding(column) : "native",
          eventTimeTimezone: "",
          freshnessMinutes: column && isDateOnlyColumnType(column.type) ? Math.max(current.freshnessMinutes, 1440) : current.freshnessMinutes,
          frequency: column && isDateOnlyColumnType(column.type) && (current.frequency === "cron" || current.frequency === "manual") ? "daily" : current.frequency,
        };
      });
    }).catch(() => { if (active) toast.error("Could not inspect the selected table"); });
    return () => { active = false; };
  }, [open, form.sourceType, form.databaseName, form.tableName]);

  const debouncedSourceQuery = useDebounce(form.sourceType === "query" ? form.sourceQuery : "", 600);
  useEffect(() => {
    if (!open || form.sourceType !== "query") { setQueryColumns([]); return; }
    const connectionId = promise?.connectionId ?? activeConnectionId;
    const query = debouncedSourceQuery.trim();
    if (!connectionId || !query) { setQueryColumns([]); return; }
    let active = true;
    setDescribingQuery(true);
    void describeDataHealthColumns({ connectionId, sourceQuery: query }).then((result) => {
      if (!active) return;
      setQueryColumns(result.columns);
      setForm((current) => {
        if (current.sourceType !== "query" || current.sourceQuery.trim() !== query) return current;
        const selectedColumnIsValid = result.columns.some((column) =>
          column.name === current.eventTimeColumn && isSupportedEventTimeColumnType(column.type));
        if (selectedColumnIsValid) return current;
        const eventTimeColumn = detectEventTimeColumn(result.columns);
        const column = result.columns.find((candidate) => candidate.name === eventTimeColumn);
        return {
          ...current,
          eventTimeColumn,
          eventTimeEncoding: column ? suggestEventTimeEncoding(column) : current.eventTimeEncoding,
          queryNativeEventTimeType: column ? (isDateOnlyColumnType(column.type) ? "Date" : "DateTime") : current.queryNativeEventTimeType,
          eventTimeTimezone: "",
          freshnessMinutes: column && isDateOnlyColumnType(column.type) ? Math.max(current.freshnessMinutes, 1440) : current.freshnessMinutes,
          frequency: column && isDateOnlyColumnType(column.type) && (current.frequency === "cron" || current.frequency === "manual") ? "daily" : current.frequency,
        };
      });
    }).catch(() => { if (active) setQueryColumns([]); }).finally(() => { if (active) setDescribingQuery(false); });
    return () => { active = false; };
  }, [open, form.sourceType, debouncedSourceQuery, promise?.connectionId, activeConnectionId]);

  const columns: DataHealthColumn[] = form.sourceType === "table" ? tableDetails?.columns ?? [] : queryColumns;
  const selectedEventTimeType = form.sourceType === "query" && form.eventTimeEncoding === "native"
    ? form.queryNativeEventTimeType
    : columns.find((column) => column.name === form.eventTimeColumn)?.type ?? promise?.eventTimeType ?? "";
  const selectedEventTimeSupport = eventTimeSupport(selectedEventTimeType);
  const dateOnlyEventTime = isDateOnlyColumnType(selectedEventTimeType);
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
    source: form.sourceType === "table" ? { sourceType: "table", databaseName: form.databaseName, tableName: form.tableName, eventTimeColumn: form.eventTimeColumn || undefined, eventTimeType: columns.find((column) => column.name === form.eventTimeColumn)?.type ?? promise?.eventTimeType ?? undefined, eventTimeEncoding: form.eventTimeColumn ? form.eventTimeEncoding : undefined, eventTimeTimezone: form.eventTimeEncoding === "string" || dateOnlyEventTime ? form.eventTimeTimezone.trim() || undefined : undefined, rowFilter: form.rowFilter.trim() || null } : { sourceType: "query", sourceQuery: form.sourceQuery.trim(), eventTimeColumn: form.eventTimeColumn || undefined, eventTimeType: form.eventTimeEncoding === "native" ? form.queryNativeEventTimeType : form.eventTimeEncoding === "string" ? "String" : "UInt64", eventTimeEncoding: form.eventTimeColumn ? form.eventTimeEncoding : undefined, eventTimeTimezone: form.eventTimeEncoding === "string" || dateOnlyEventTime ? form.eventTimeTimezone.trim() || undefined : undefined, rowFilter: form.rowFilter.trim() || null },
    ownerId: promise?.ownerId ?? null, criticality: form.criticality, runbookUrl: form.runbookUrl.trim() || null, enabled: form.enabled,
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
  const canContinue = step === 0
    ? Boolean((promise?.connectionId || activeConnectionId) && form.name.trim() && (form.sourceType === "table" ? form.databaseName && form.tableName : form.sourceQuery.trim()))
    : step === 1
      ? checks.length > 0 && ruleDefinitionsValid && (!needsEventTime || Boolean(form.eventTimeColumn)) && (!form.eventTimeColumn || form.eventTimeEncoding !== "auto") && (form.eventTimeEncoding !== "string" || Boolean(form.eventTimeTimezone.trim())) && (!dateOnlyEventTime || Boolean(form.eventTimeTimezone.trim())) && (!dateOnlyEventTime || (form.frequency !== "cron" && form.frequency !== "manual")) && (!dateOnlyEventTime || form.freshnessMinutes >= 1440) && (form.frequency !== "cron" || Boolean(form.cronExpr.trim()))
      : true;
  const runPreview = async () => { setPreviewing(true); try { const result = await previewDataHealthPromise(buildInput()); setPreview(result); toast.success("Promise validated"); } catch (error) { toast.error(error instanceof Error ? error.message : "Preview failed"); } finally { setPreviewing(false); } };
  const requestRecommendation = async () => {
    const connectionId = promise?.connectionId ?? activeConnectionId;
    if (!connectionId || form.sourceType !== "table" || !form.databaseName || !form.tableName) return;
    setRecommending(true);
    try {
      setRecommendation(await recommendHealthPromise({ connectionId, database: form.databaseName, table: form.tableName, criticality: form.criticality, existingChecks: checks }, { modelId }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not recommend health coverage");
    } finally {
      setRecommending(false);
    }
  };
  const applyRecommendation = () => {
    if (!recommendation) return;
    const freshness = recommendation.checks.find((check) => check.type === "freshness");
    const rowCount = recommendation.checks.find((check) => check.type === "row_count");
    const anomaly = recommendation.checks.find((check) => check.type === "volume_anomaly");
    const schema = recommendation.checks.find((check) => check.type === "schema_contract");
    update({
      eventTimeColumn: recommendation.eventTimeColumn ?? form.eventTimeColumn,
      freshness: Boolean(freshness),
      freshnessMinutes: freshness?.type === "freshness" ? Math.max(1, Math.round(freshness.config.maxAgeSeconds / 60)) : form.freshnessMinutes,
      rowCount: Boolean(rowCount),
      rowCountMin: rowCount?.type === "row_count" && rowCount.config.min != null ? String(rowCount.config.min) : "",
      rowCountMax: rowCount?.type === "row_count" && rowCount.config.max != null ? String(rowCount.config.max) : "",
      anomaly: Boolean(anomaly),
      anomalyHardMin: anomaly?.type === "volume_anomaly" && anomaly.config.hardMin != null ? String(anomaly.config.hardMin) : "",
      schemaContract: Boolean(schema),
      allowAdditionalColumns: schema?.type === "schema_contract" ? schema.config.allowAdditionalColumns : form.allowAdditionalColumns,
      completenessRules: recommendation.checks.flatMap((check) => check.type === "completeness" ? [{ checkKey: check.checkKey, column: check.config.column, minPercent: check.config.minRatio * 100 }] : []),
      uniquenessRules: recommendation.checks.flatMap((check) => check.type === "uniqueness" ? [{ checkKey: check.checkKey, columns: check.config.columns, maxDuplicatePercent: check.config.maxDuplicateRatio * 100 }] : []),
      validityRules: recommendation.checks.flatMap((check) => check.type === "validity" ? [{ checkKey: check.checkKey, name: check.name, predicate: check.config.predicate, minPercent: check.config.minRatio * 100 }] : []),
      customMetricRules: recommendation.checks.flatMap((check) => check.type === "custom_metric" ? [{ checkKey: check.checkKey, name: check.name, expression: check.config.expression, operator: check.config.operator, threshold: check.config.threshold, upperThreshold: check.config.upperThreshold ?? 0 }] : []),
      graceMinutes: Math.round(recommendation.graceSecs / 60),
      breachAfter: recommendation.breachAfter,
      recoverAfter: recommendation.recoverAfter,
    });
    toast.success("AI recommendations applied as an editable draft");
  };
  const submit = async () => { try { const input = buildInput(); if (promise) await updateMutation.mutateAsync({ id: promise.id, input }); else await createMutation.mutateAsync(input); toast.success(promise ? "Data Health promise updated" : "Dataset protection activated"); onOpenChange(false); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save the promise"); } };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[92vh] max-w-4xl flex-col overflow-hidden rounded-xs border-ink-500 bg-ink-100 p-0 text-paper"><DialogHeader className="border-b border-ink-500 px-6 py-5"><DialogTitle>{promise ? "Edit Data Health promise" : "Protect a dataset"}</DialogTitle><DialogDescription>Describe what healthy data means. CHouse will generate, schedule, and evaluate the monitor.</DialogDescription><div className="mt-4 flex gap-1">{STEPS.map((label, index) => <div key={label} className={cn("flex flex-1 items-center gap-2 border-t-2 pt-2", index <= step ? "border-brand text-paper" : "border-ink-500 text-paper-faint")}><span className="font-mono text-[9px]">0{index + 1}</span><span className="font-mono text-[10px] uppercase tracking-[0.12em]">{label}</span></div>)}</div></DialogHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {step === 0 && <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><div><Label>Promise name</Label><Input value={form.name} onChange={(event) => update({ name: event.target.value })} placeholder="Daily orders are ready" className="mt-1 rounded-xs" /></div><div><Label>Connection</Label><Input value={activeConnectionName ?? promise?.connectionId ?? "No active connection"} disabled className="mt-1 rounded-xs" /></div></div><div><Label>Description</Label><Textarea value={form.description} onChange={(event) => update({ description: event.target.value })} placeholder="Who relies on this data and why it matters…" className="mt-1 rounded-xs" /></div><div><HintLabel hint="Choose a table for automatic schema and partition inspection, or a read-only query when the monitored dataset needs joins, casts, or aliases.">Dataset source</HintLabel><div className="mt-1 grid grid-cols-2 gap-2"><Button type="button" variant={form.sourceType === "table" ? "default" : "outline"} className="rounded-xs" onClick={() => update({ sourceType: "table" })}>Table or view</Button><Button type="button" variant={form.sourceType === "query" ? "default" : "outline"} className="rounded-xs" onClick={() => update({ sourceType: "query", schemaContract: false })}><Code2 className="mr-2 h-3.5 w-3.5" /> Dataset query</Button></div></div>{form.sourceType === "table" ? <div className="grid gap-4 sm:grid-cols-2"><div><Label>Database</Label><Select value={form.databaseName} onValueChange={(value) => { setTableDetails(undefined); update({ databaseName: value, tableName: "", eventTimeColumn: "" }); }}><SelectTrigger className="mt-1 rounded-xs"><SelectValue placeholder="Select database" /></SelectTrigger><SelectContent>{databases.map((database) => <SelectItem key={database.name} value={database.name}>{database.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Table or view</Label><Select value={form.tableName} onValueChange={(value) => { setTableDetails(undefined); update({ tableName: value, eventTimeColumn: "" }); }}><SelectTrigger className="mt-1 rounded-xs"><SelectValue placeholder="Select table" /></SelectTrigger><SelectContent>{tables.map((table) => <SelectItem key={table.name} value={table.name}>{table.name}</SelectItem>)}</SelectContent></Select></div></div> : <div><Label>Read-only dataset query</Label><Textarea value={form.sourceQuery} onChange={(event) => update({ sourceQuery: event.target.value })} placeholder="SELECT * FROM analytics.orders" className="mt-1 min-h-32 rounded-xs font-mono text-[11px]" /><p className="mt-1 text-[10px] text-paper-faint">{describingQuery ? "Detecting columns…" : queryColumns.length > 0 ? `${queryColumns.length} columns detected — pick them below instead of typing names.` : "Columns are auto-detected once this resolves to a valid read-only SELECT."}</p></div>}<div className="grid gap-4 sm:grid-cols-2"><div><HintLabel hint="This column assigns rows to each evaluation window. DateTime values represent instants; Date values represent local calendar days and require a calendar timezone.">Event-time column</HintLabel>{columns.length > 0 ? <Select value={form.eventTimeColumn || "none"} onValueChange={(value) => update({ eventTimeColumn: value === "none" ? "" : value })}><SelectTrigger className="mt-1 rounded-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No event-time column</SelectItem>{columns.filter((column) => isSupportedEventTimeColumnType(column.type)).map((column) => <SelectItem key={column.name} value={column.name}>{column.name} · {column.type}</SelectItem>)}</SelectContent></Select> : <Input value={form.eventTimeColumn} onChange={(event) => update({ eventTimeColumn: event.target.value })} placeholder="created_at" className="mt-1 rounded-xs font-mono" />}<p className="mt-1 text-[10px] text-paper-faint">Required for windowed checks. Native times are used directly; encoded values need their stored format below.</p></div><div><HintLabel hint="Applied to every generated metric and diagnostic query. Use it to scope a shared table, for example to one environment or tenant.">Optional row filter</HintLabel><Input value={form.rowFilter} onChange={(event) => update({ rowFilter: event.target.value })} placeholder="environment = 'production'" className="mt-1 rounded-xs font-mono" /></div></div></div>}
        {step === 0 && form.eventTimeColumn && (form.sourceType === "query" || selectedEventTimeSupport !== "native" || dateOnlyEventTime) && <div className={cn("mt-4 grid gap-4 rounded-xs border border-ink-500 bg-ink-200/30 p-4", (form.sourceType === "query" || form.eventTimeEncoding === "string") && "sm:grid-cols-2")}>{(form.sourceType === "query" || selectedEventTimeSupport !== "native") && <div><HintLabel hint="Native ClickHouse times need no decoding. Integer timestamps need their exact seconds-to-nanoseconds unit, while timestamp text needs its stored-value timezone.">Stored timestamp format</HintLabel><Select value={form.eventTimeEncoding} onValueChange={(value) => update({ eventTimeEncoding: value as DataHealthEventTimeEncoding, eventTimeTimezone: value === "string" ? form.eventTimeTimezone : "" })}><SelectTrigger className="mt-1 rounded-xs"><SelectValue /></SelectTrigger><SelectContent>{form.sourceType === "query" && <SelectItem value="native">Native Date / DateTime</SelectItem>}{(form.sourceType === "query" || selectedEventTimeSupport === "unix") && <><SelectItem value="unix_seconds">Unix seconds</SelectItem><SelectItem value="unix_milliseconds">Unix milliseconds</SelectItem><SelectItem value="unix_microseconds">Unix microseconds</SelectItem><SelectItem value="unix_nanoseconds">Unix nanoseconds</SelectItem></>}{(form.sourceType === "query" || selectedEventTimeSupport === "string") && <SelectItem value="string">Timestamp text</SelectItem>}</SelectContent></Select>{form.eventTimeEncoding.startsWith("unix_") && <p className="mt-1 text-[10px] text-paper-faint">Choose the unit used by the stored integer timestamp.</p>}</div>}{form.sourceType === "query" && form.eventTimeEncoding === "native" && <div><HintLabel hint="For custom query sources, declare whether the selected alias returns an instant (DateTime) or a day-only calendar value (Date).">Native temporal type</HintLabel><Select value={form.queryNativeEventTimeType} onValueChange={(value) => update({ queryNativeEventTimeType: value as "DateTime" | "Date", eventTimeTimezone: "", freshnessMinutes: value === "Date" ? Math.max(form.freshnessMinutes, 1440) : form.freshnessMinutes, frequency: value === "Date" && (form.frequency === "cron" || form.frequency === "manual") ? "daily" : form.frequency })}><SelectTrigger className="mt-1 rounded-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="DateTime">DateTime / DateTime64</SelectItem><SelectItem value="Date">Date / Date32</SelectItem></SelectContent></Select></div>}{(form.eventTimeEncoding === "string" || dateOnlyEventTime) && <div><HintLabel hint={dateOnlyEventTime ? "Defines how UTC slot boundaries map to local Date or Date32 values. It does not change the UTC schedule." : "Used to interpret timestamp text that has no Z or numeric offset. Text containing an offset keeps that explicit instant."}>{dateOnlyEventTime ? "Calendar timezone" : "Timezone of stored text"}</HintLabel><Input value={form.eventTimeTimezone} onChange={(event) => update({ eventTimeTimezone: event.target.value })} placeholder="Asia/Jakarta" className="mt-1 rounded-xs font-mono" /><p className="mt-1 text-[10px] text-paper-faint">{dateOnlyEventTime ? "UTC slot boundaries are converted to calendar dates in this timezone." : "Used only when parsing text without an embedded UTC offset."}</p></div>}</div>}
        {step === 1 && (
          <div className="space-y-5">
            {!form.eventTimeColumn && <div className="rounded-xs border border-amber-500/40 bg-amber-500/10 p-4 text-[11px] text-amber-500"><p className="font-medium">This dataset has no selected event-time column.</p><p className="mt-1">Go back to choose a native Date/DateTime, Unix integer, or parseable string timestamp. Otherwise disable freshness, row volume, learned volume, completeness, uniqueness, and validity checks; schema and custom metric checks can run without event time.</p></div>}
            {canUseAi && form.sourceType === "table" && <div className="rounded-xs border border-brand/25 bg-brand/5 p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand" /><p className={DH_LABEL}>AI coverage advisor</p></div><p className="mt-1 text-[10px] text-paper-muted">Inspects schema and bounded evidence, then proposes explainable checks. Nothing changes until you apply the draft.</p></div><Button variant="outline" className="h-8 shrink-0 rounded-xs" onClick={() => void requestRecommendation()} disabled={recommending || !form.databaseName || !form.tableName}>{recommending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}{recommendation ? "Refresh" : "Recommend"}</Button></div>{recommendation && <div className="mt-3 border-t border-brand/20 pt-3"><p className="text-[11px] text-paper">{recommendation.summary}</p><p className="mt-1 text-[10px] text-paper-muted">{recommendation.checks.length} checks · {Math.round(recommendation.confidence * 100)}% confidence</p><ul className="mt-2 space-y-1">{recommendation.rationale.slice(0, 5).map((reason) => <li key={reason} className="text-[10px] text-paper-muted">• {reason}</li>)}</ul><Button className={`${DH_PRIMARY} mt-3`} onClick={applyRecommendation}>Apply editable draft</Button></div>}</div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div><HintLabel hint="The cadence defines UTC slot boundaries. Date event time supports daily, weekly, and monthly windows because it has day-only precision.">Evaluation cadence</HintLabel><Select value={form.frequency} onValueChange={(value) => update({ frequency: value as DataHealthFrequency })}><SelectTrigger className="mt-1 rounded-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem><SelectItem value="monthly">Monthly</SelectItem>{!dateOnlyEventTime && <><SelectItem value="cron">Custom cron</SelectItem><SelectItem value="manual">Manual only</SelectItem></>}</SelectContent></Select></div>
              {form.frequency !== "manual" && form.frequency !== "cron" && <div><HintLabel hint="The scheduled evaluation fires at this hour in UTC. A Date calendar timezone affects date boundaries, not the firing timezone.">UTC hour</HintLabel><Input type="number" min={0} max={23} value={form.hour} onChange={(event) => update({ hour: Number(event.target.value) })} className="mt-1 rounded-xs" /></div>}
              {form.frequency === "cron" && <div><HintLabel hint="A five-field cron evaluated in UTC. It is available only for timestamp event time, not day-only Date fields.">Cron expression</HintLabel><Input value={form.cronExpr} onChange={(event) => update({ cronExpr: event.target.value })} placeholder="0 8 * * *" className="mt-1 rounded-xs font-mono" /></div>}
            </div>
            <div>
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand" /><p className={DH_LABEL}>What must remain true?</p></div>
              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                <CheckToggle checked={form.freshness} onCheckedChange={(freshness) => update({ freshness })} title="Delivery freshness" hint="Checks how recently the dataset advanced. Date fields use completed local calendar days; timestamps use exact instants." description={dateOnlyEventTime ? "Latest completed calendar date must remain within the promised delay." : "Latest event must arrive within the promised delay."}><div><HintLabel hint={dateOnlyEventTime ? "Date freshness is measured from the end of the latest completed local calendar day." : "Freshness measures the seconds between the latest event instant and the UTC slot end."}>Maximum delay, {dateOnlyEventTime ? "days" : "minutes"}</HintLabel><Input type="number" min={1} value={dateOnlyEventTime ? form.freshnessMinutes / 1440 : form.freshnessMinutes} onChange={(event) => update({ freshnessMinutes: Number(event.target.value) * (dateOnlyEventTime ? 1440 : 1) })} className="mt-1 rounded-xs" /></div></CheckToggle>
                <CheckToggle checked={form.rowCount} onCheckedChange={(rowCount) => update({ rowCount })} title="Row volume" hint="Counts only rows inside the current event-time window after the optional row filter is applied." description="Protect against empty, partial, or unexpectedly large windows."><div><Label>Minimum rows</Label><Input type="number" value={form.rowCountMin} onChange={(event) => update({ rowCountMin: event.target.value })} className="mt-1 rounded-xs" /></div><div><Label>Maximum rows</Label><Input type="number" value={form.rowCountMax} onChange={(event) => update({ rowCountMax: event.target.value })} placeholder="Optional" className="mt-1 rounded-xs" /></div></CheckToggle>
                <CheckToggle checked={form.anomaly} onCheckedChange={(anomaly) => update({ anomaly })} title="Learned volume range" hint="Learns a robust baseline from prior windows. The hard minimum still protects the dataset while the baseline is learning." description="Compare each window with a transparent robust baseline."><div><Label>Hard minimum while learning</Label><Input type="number" value={form.anomalyHardMin} onChange={(event) => update({ anomalyHardMin: event.target.value })} placeholder="Optional" className="mt-1 rounded-xs" /></div></CheckToggle>
                <CheckToggle checked={form.schemaContract} onCheckedChange={(schemaContract) => update({ schemaContract })} title="Schema contract" hint="Compares the current table schema with the snapshot saved when this promise is activated or updated." description="Detect removed or retyped columns."><label className="col-span-full flex items-center gap-2 text-[11px] text-paper-muted"><Checkbox checked={form.allowAdditionalColumns} onCheckedChange={(checked) => update({ allowAdditionalColumns: checked === true })} /> Allow new columns</label></CheckToggle>
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
              <div><HintLabel hint="The incident opens only after this many consecutive breached evaluations, which reduces one-off noise.">Alert after breaches</HintLabel><Input type="number" min={1} max={20} value={form.breachAfter} onChange={(event) => update({ breachAfter: Number(event.target.value) })} className="mt-1 rounded-xs" /></div>
              <div><HintLabel hint="An open incident recovers only after this many consecutive passing evaluations.">Recover after passes</HintLabel><Input type="number" min={1} max={20} value={form.recoverAfter} onChange={(event) => update({ recoverAfter: Number(event.target.value) })} className="mt-1 rounded-xs" /></div>
              <div><HintLabel hint="Delays incident evaluation after the slot closes, allowing late-arriving data to land before the result counts.">Grace period, minutes</HintLabel><Input type="number" min={0} value={form.graceMinutes} onChange={(event) => update({ graceMinutes: Number(event.target.value) })} className="mt-1 rounded-xs" /></div>
            </div>
            <div><HintLabel hint="Notifications are sent on incident open, escalation, and recovery—not on every scheduled evaluation.">Notify on incident transitions</HintLabel><div className="mt-2 grid gap-2 sm:grid-cols-2">{channels.map((channel) => <label key={channel.id} className="flex items-center gap-2 rounded-xs border border-ink-500 p-2 text-[11px] text-paper-muted"><Checkbox checked={form.channelIds.includes(channel.id)} onCheckedChange={(checked) => update({ channelIds: checked === true ? [...form.channelIds, channel.id] : form.channelIds.filter((id) => id !== channel.id) })} />{channel.name}<span className="ml-auto font-mono text-[9px] uppercase text-paper-faint">{channel.type}</span></label>)}{channels.length === 0 && <p className="text-[11px] text-paper-faint">No enabled notification channels. Configure one under Admin → Alerting.</p>}</div></div>
          </div>
        )}
        {step === 2 && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xs border border-ink-500 bg-ink-200/30 p-3"><p className={DH_LABEL}>Dataset</p><p className="mt-2 text-[12px] text-paper">{form.sourceType === "table" ? `${form.databaseName}.${form.tableName}` : "Custom query"}</p></div><div className="rounded-xs border border-ink-500 bg-ink-200/30 p-3"><p className={DH_LABEL}>Evaluation</p><p className="mt-2 text-[12px] text-paper">{form.frequency} · UTC</p></div><div className="rounded-xs border border-ink-500 bg-ink-200/30 p-3"><p className={DH_LABEL}>Coverage</p><p className="mt-2 text-[12px] text-paper">{checks.length} checks · {form.channelIds.length} channels</p></div></div><div><p className={DH_LABEL}>Checks to activate</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{checks.map((check) => <div key={check.checkKey} className="flex items-center gap-2 rounded-xs border border-ink-500 p-3"><CheckCircle2 className="h-4 w-4 text-emerald-500" /><div><p className="text-[11px] text-paper">{check.name}</p><p className="font-mono text-[9px] uppercase text-paper-faint">{check.type.replace("_", " ")} · {check.severity}</p></div></div>)}</div></div><div className="rounded-xs border border-brand/30 bg-brand/5 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[12px] font-medium text-paper">Validate before activation</p><p className="mt-1 text-[10px] text-paper-muted">Checks access, generated SQL, cadence, and upcoming evaluation slots.</p></div><Button variant="outline" className="h-8 rounded-xs" onClick={() => void runPreview()} disabled={previewing}><Eye className="mr-2 h-3.5 w-3.5" /> {previewing ? "Validating…" : "Preview"}</Button></div>{preview && <div className="mt-3 border-t border-brand/20 pt-3"><p className="font-mono text-[10px] text-emerald-500">Valid · {preview.metricCheckKeys.length} metrics · {preview.schemaCheckKeys.length} schema checks</p>{preview.nextFireTimes.length > 0 && <p className="mt-1 text-[10px] text-paper-muted">Next (UTC): {preview.nextFireTimes.slice(0, 3).map((time) => new Date(time).toLocaleString(undefined, { timeZone: "UTC", timeZoneName: "short" })).join(" · ")}</p>}<details className="mt-2"><summary className="cursor-pointer font-mono text-[9px] uppercase text-paper-faint">Generated SQL</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-xs bg-ink-300 p-3 font-mono text-[10px] text-paper-muted">{preview.compiledSql}</pre></details></div>}</div></div>}
      </div><DialogFooter className="border-t border-ink-500 px-6 py-4"><div className="flex w-full items-center justify-between"><Button variant="ghost" onClick={() => step === 0 ? onOpenChange(false) : setStep((current) => current - 1)}><ChevronLeft className="mr-1 h-4 w-4" />{step === 0 ? "Cancel" : "Back"}</Button>{step < STEPS.length - 1 ? <Button className={DH_PRIMARY} disabled={!canContinue} onClick={() => setStep((current) => current + 1)}>Continue <ChevronRight className="h-4 w-4" /></Button> : <Button className={DH_PRIMARY} onClick={() => void submit()} disabled={createMutation.isPending || updateMutation.isPending || checks.length === 0}>{promise ? "Save changes" : "Activate promise"}</Button>}</div></DialogFooter></DialogContent></Dialog>
  );
}
