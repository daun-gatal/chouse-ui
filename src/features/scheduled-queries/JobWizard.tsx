/**
 * Scheduled Query builder — a multi-step wizard (create & edit), mirroring the
 * ClickHouseUserWizard shell: a STEPS array, a Dialog with a stepper header,
 * per-step validation gating Next, a final Review step, and Edit pre-filling
 * every step. Source → Schedule → Actions → Output[write-gated] → Review.
 * Builds only from the house design system (D10a/D10b).
 */

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertTriangle, Info } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useRbacStore, useAuthStore, RBAC_PERMISSIONS } from "@/stores";
import { listChannels, type NotificationChannel } from "@/api/alerting";
import {
  previewScheduledQuery,
  type PreviewResult,
  type ScheduledQuery,
  type ScheduledQueryInput,
  type SqFrequency,
  type SqOutputMode,
} from "@/api/scheduledQueries";
import { useCreateScheduledQuery, useUpdateScheduledQuery } from "./hooks";
import { SQ_BTN_GHOST, SQ_BTN_PRIMARY } from "./lib";
import { MultiSelect } from "./MultiSelect";
import { MacrosHelp } from "./MacrosHelp";

// Heavy Monaco editor — lazy so its chunk only loads when the builder opens.
const MonacoSqlInput = lazy(() => import("./MonacoSqlInput"));

const STEPS = ["Source", "Schedule", "Actions", "Output", "Review"] as const;

interface FormState {
  name: string;
  description: string;
  connectionId: string;
  query: string;
  enabled: boolean;
  frequency: SqFrequency;
  hour: number;
  dayOfWeek: number;
  dayOfMonth: number;
  cronExpr: string;
  channelIds: string[];
  outputMode: SqOutputMode;
  destDatabase: string;
  destTable: string;
  partitionExpr: string;
  engine: string;
  orderBy: string;
  partitionBy: string;
  createIfMissing: boolean;
  maxRows: number;
  timeoutSecs: number;
  useFinal: boolean;
  seqConsistency: boolean;
  maxAttempts: number;
  retentionDays: number;
}

function emptyForm(connectionId: string): FormState {
  return {
    name: "",
    description: "",
    connectionId,
    query: "",
    enabled: true,
    frequency: "daily",
    hour: 8,
    dayOfWeek: 1,
    dayOfMonth: 1,
    cronExpr: "",
    channelIds: [],
    outputMode: "none",
    destDatabase: "",
    destTable: "",
    partitionExpr: "",
    engine: "MergeTree",
    orderBy: "",
    partitionBy: "",
    createIfMissing: false,
    maxRows: 100,
    timeoutSecs: 60,
    useFinal: false,
    seqConsistency: false,
    maxAttempts: 2,
    retentionDays: 90,
  };
}

function formFromJob(job: ScheduledQuery): FormState {
  return {
    name: job.name,
    description: job.description ?? "",
    connectionId: job.connectionId,
    query: job.query,
    enabled: job.enabled,
    frequency: job.frequency,
    hour: job.hour,
    dayOfWeek: job.dayOfWeek,
    dayOfMonth: job.dayOfMonth,
    cronExpr: job.cronExpr ?? "",
    channelIds: job.channelIds,
    outputMode: job.outputMode,
    destDatabase: job.destDatabase ?? "",
    destTable: job.destTable ?? "",
    partitionExpr: job.outputConfig?.partitionExpr ?? "",
    engine: job.outputConfig?.engine ?? "MergeTree",
    orderBy: job.outputConfig?.orderBy ?? "",
    partitionBy: job.outputConfig?.partitionBy ?? "",
    createIfMissing: job.outputConfig?.createIfMissing ?? false,
    maxRows: job.maxRows,
    timeoutSecs: job.timeoutSecs,
    useFinal: job.useFinal,
    seqConsistency: job.seqConsistency,
    maxAttempts: job.maxAttempts,
    retentionDays: job.retentionDays,
  };
}

function buildInput(form: FormState): ScheduledQueryInput {
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    connectionId: form.connectionId,
    query: form.query,
    enabled: form.enabled,
    frequency: form.frequency,
    hour: form.hour,
    dayOfWeek: form.dayOfWeek,
    dayOfMonth: form.dayOfMonth,
    cronExpr: form.frequency === "cron" ? form.cronExpr.trim() : null,
    outputMode: form.outputMode,
    destDatabase: form.outputMode === "none" ? null : form.destDatabase.trim(),
    destTable: form.outputMode === "none" ? null : form.destTable.trim(),
    outputConfig:
      form.outputMode === "none"
        ? null
        : {
            partitionExpr: form.partitionExpr.trim() || undefined,
            engine: form.engine.trim() || undefined,
            orderBy: form.orderBy.trim() || undefined,
            partitionBy: form.partitionBy.trim() || undefined,
            createIfMissing: form.createIfMissing,
          },
    maxRows: form.maxRows,
    timeoutSecs: form.timeoutSecs,
    useFinal: form.useFinal,
    seqConsistency: form.seqConsistency,
    maxAttempts: form.maxAttempts,
    retentionDays: form.retentionDays,
    channelIds: form.channelIds,
  };
}

interface JobWizardProps {
  isOpen: boolean;
  onClose: () => void;
  /** Existing job to edit; undefined ⇒ create. */
  job?: ScheduledQuery;
  /** Optional prefill (e.g. "Schedule this query" from the editor). */
  prefill?: { query?: string; connectionId?: string };
}

const labelCls = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint";
const sectionCls = "space-y-2";

export function JobWizard({ isOpen, onClose, job, prefill }: JobWizardProps) {
  const { hasPermission } = useRbacStore();
  const { activeConnectionId, activeConnectionName } = useAuthStore();
  const canWrite = hasPermission(RBAC_PERMISSIONS.SCHEDULED_QUERIES_WRITE);
  const createMut = useCreateScheduledQuery();
  const updateMut = useUpdateScheduledQuery();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(emptyForm(""));
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // The job runs on the currently active connection (create); an edited job keeps
  // its original connection. No picker — it follows the connection the user has
  // selected in the app, exactly like an interactive query.
  const connectionName = job ? (job.connectionId === activeConnectionId ? activeConnectionName : job.connectionId) : activeConnectionName;

  // Steps shown — Output only when the user can author materialize jobs.
  const steps = useMemo(() => (canWrite ? STEPS : STEPS.filter((s) => s !== "Output")), [canWrite]);
  const stepName = steps[step];

  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setPreview(null);
    void listChannels().then((chs) => setChannels(chs));
    if (job) {
      setForm(formFromJob(job));
    } else {
      setForm({ ...emptyForm(prefill?.connectionId || activeConnectionId || ""), query: prefill?.query ?? "" });
    }
  }, [isOpen, job, prefill, activeConnectionId]);

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const result = await previewScheduledQuery(buildInput(form));
      setPreview(result);
      return result;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
      return null;
    } finally {
      setPreviewing(false);
    }
  };

  // Per-step Next gating.
  const canNext = useMemo(() => {
    switch (stepName) {
      case "Source":
        return form.name.trim().length > 0 && form.connectionId.length > 0 && form.query.trim().length > 0;
      case "Schedule":
        return form.frequency !== "cron" || form.cronExpr.trim().length > 0;
      case "Output":
        return form.outputMode === "none" || (form.destDatabase.trim().length > 0 && form.destTable.trim().length > 0);
      default:
        return true;
    }
  }, [stepName, form]);

  const isLast = step === steps.length - 1;
  const saving = createMut.isPending || updateMut.isPending;

  const goNext = async () => {
    // Validate Source/Output server-side before advancing.
    if (stepName === "Source" || stepName === "Output") {
      const result = await runPreview();
      if (result && stepName === "Source") {
        if (!result.readOnly.ok) {
          toast.error(result.readOnly.error ?? "Query must be a read-only SELECT");
          return;
        }
        if (result.dataAccess && !result.dataAccess.allowed) {
          toast.error(result.dataAccess.reason ?? "Your role can't access one or more tables in this query");
          return;
        }
      }
    }
    setStep((s) => Math.min(s + 1, steps.length - 1));
  };

  const handleSave = async () => {
    try {
      const input = buildInput(form);
      if (job) {
        await updateMut.mutateAsync({ id: job.id, input });
        toast.success("Scheduled query updated");
      } else {
        await createMut.mutateAsync(input);
        toast.success("Scheduled query created");
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden rounded-xs border-ink-500 bg-ink-100 p-0">
        <DialogHeader className="flex-shrink-0 border-b border-ink-500 px-6 pb-4 pt-6">
          <DialogTitle className="text-[16px] font-semibold text-paper">
            {job ? "Edit scheduled query" : "New scheduled query"}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[12px] text-paper-muted">
            Step {step + 1} of {steps.length} — {stepName}
          </DialogDescription>
          <div className="mt-4 flex items-center gap-2">
            {steps.map((label, i) => {
              // Editing a job → jump to any step freely; creating → only back to
              // already-visited (validated) steps. Save re-validates server-side.
              const canJump = Boolean(job) || i <= step;
              return (
                <div key={label} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => canJump && setStep(i)}
                    disabled={!canJump}
                    aria-current={i === step ? "step" : undefined}
                    className={cn("flex items-center gap-2", canJump && i !== step ? "cursor-pointer" : "cursor-default")}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full font-mono text-[10px]",
                        i === step ? "bg-brand text-ink-50" : i < step ? "bg-emerald-600 text-ink-50" : "bg-ink-300 text-paper-faint",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className={cn("font-mono text-[10px] uppercase tracking-[0.14em]", i === step ? "text-paper" : "text-paper-faint", canJump && i !== step && "hover:text-paper")}>
                      {label}
                    </span>
                  </button>
                  {i < steps.length - 1 && <span className="h-px w-4 bg-ink-400" aria-hidden />}
                </div>
              );
            })}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {stepName === "Source" && (
            <SourceStep form={form} update={update} connectionName={connectionName} preview={preview} onValidate={runPreview} validating={previewing} />
          )}
          {stepName === "Schedule" && (
            <ScheduleStep form={form} update={update} preview={preview} onPreview={runPreview} previewing={previewing} />
          )}
          {stepName === "Actions" && <ActionsStep form={form} update={update} channels={channels} />}
          {stepName === "Output" && (
            <OutputStep form={form} update={update} preview={preview} onPreview={runPreview} previewing={previewing} />
          )}
          {stepName === "Review" && <ReviewStep form={form} channels={channels} connectionName={connectionName} />}
        </div>

        <DialogFooter className="flex-shrink-0 items-center justify-between border-t border-ink-500 px-6 py-4 sm:justify-between">
          <Button variant="ghost" className={SQ_BTN_GHOST} onClick={() => (step === 0 ? onClose() : setStep((s) => s - 1))} disabled={saving}>
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {isLast ? (
            <Button className={SQ_BTN_PRIMARY} onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {job ? "Save changes" : "Create"}
            </Button>
          ) : (
            <Button className={SQ_BTN_PRIMARY} onClick={goNext} disabled={!canNext || previewing}>
              {previewing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Next
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface StepProps {
  form: FormState;
  update: (patch: Partial<FormState>) => void;
}

function SourceStep({ form, update, connectionName, preview, onValidate, validating }: StepProps & { connectionName: string | null; preview: PreviewResult | null; onValidate: () => Promise<unknown>; validating: boolean }) {
  return (
    <>
      <div className={sectionCls}>
        <Label className={labelCls}>Name</Label>
        <Input value={form.name} onChange={(e) => update({ name: e.target.value })} placeholder="errors_last_hour" />
      </div>
      <div className={sectionCls}>
        <Label className={labelCls}>Description</Label>
        <Input value={form.description} onChange={(e) => update({ description: e.target.value })} placeholder="Optional" />
      </div>
      <div className={sectionCls}>
        <Label className={labelCls}>Connection</Label>
        <div className="flex h-9 items-center rounded-xs border border-ink-500 bg-ink-50 px-3 text-[12px] text-paper">
          {connectionName || form.connectionId || "No active connection — select one in the app first"}
        </div>
        <p className="text-[11px] text-paper-muted">Runs on your active connection, using its ClickHouse credentials.</p>
      </div>
      <div className={sectionCls}>
        <div className="flex items-center justify-between">
          <Label className={labelCls}>Read-only SELECT</Label>
          <MacrosHelp />
        </div>
        <Suspense fallback={<div className="grid h-[220px] place-items-center rounded-xs border border-ink-500 bg-ink-50 text-[11px] text-paper-muted">Loading editor…</div>}>
          <MonacoSqlInput value={form.query} onChange={(v) => update({ query: v })} height={220} />
        </Suspense>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-paper-muted">
            Window macros (UTC): <code className="text-paper">{"{{slot_start}}"}</code>, <code className="text-paper">{"{{slot_end}}"}</code> … <span className="text-paper-faint">ⓘ for shift / extract</span>
          </p>
          <Button variant="outline" className="h-7 shrink-0 rounded-xs font-mono text-[10px] uppercase tracking-[0.14em]" onClick={() => void onValidate()} disabled={validating}>
            {validating && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            Validate
          </Button>
        </div>
        {preview?.readOnly && (
          <div className={cn("flex items-center gap-2 text-[11px]", preview.readOnly.ok ? "text-emerald-600" : "text-red-600")}>
            {preview.readOnly.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            {preview.readOnly.ok ? "Valid read-only SELECT" : preview.readOnly.error}
          </div>
        )}
        {preview?.dataAccess && (
          <div className={cn("flex items-start gap-2 text-[11px]", preview.dataAccess.allowed ? "text-emerald-600" : "text-red-600")}>
            {preview.dataAccess.allowed ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <span>{preview.dataAccess.allowed ? "Your role has data access to all referenced tables" : (preview.dataAccess.reason ?? "Access denied to one or more tables")}</span>
          </div>
        )}
      </div>
    </>
  );
}

function ScheduleStep({ form, update, preview, onPreview, previewing }: StepProps & { preview: PreviewResult | null; onPreview: () => Promise<unknown>; previewing: boolean }) {
  return (
    <>
      <div className={sectionCls}>
        <Label className={labelCls}>Frequency</Label>
        <Select value={form.frequency} onValueChange={(v) => update({ frequency: v as SqFrequency })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="cron">Custom cron</SelectItem>
            <SelectItem value="manual">Manual only</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {(form.frequency === "daily" || form.frequency === "weekly" || form.frequency === "monthly") && (
        <div className={sectionCls}>
          <Label className={labelCls}>Hour (UTC)</Label>
          <Input type="number" min={0} max={23} value={form.hour} onChange={(e) => update({ hour: Number(e.target.value) })} />
        </div>
      )}
      {form.frequency === "weekly" && (
        <div className={sectionCls}>
          <Label className={labelCls}>Day of week</Label>
          <Select value={String(form.dayOfWeek)} onValueChange={(v) => update({ dayOfWeek: Number(v) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
                <SelectItem key={d} value={String(i)}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {form.frequency === "monthly" && (
        <div className={sectionCls}>
          <Label className={labelCls}>Day of month (1–28)</Label>
          <Input type="number" min={1} max={28} value={form.dayOfMonth} onChange={(e) => update({ dayOfMonth: Number(e.target.value) })} />
        </div>
      )}
      {form.frequency === "cron" && (
        <div className={sectionCls}>
          <Label className={labelCls}>Cron expression (5-field, UTC)</Label>
          <div className="flex gap-2">
            <Input value={form.cronExpr} onChange={(e) => update({ cronExpr: e.target.value })} placeholder="*/15 * * * *" className="font-mono" />
            <Button variant="outline" onClick={() => void onPreview()} disabled={previewing}>Preview</Button>
          </div>
          {preview?.cron && !preview.cron.valid && <p className="text-[11px] text-red-600">{preview.cron.error}</p>}
        </div>
      )}
      {preview?.nextFireTimes && preview.nextFireTimes.length > 0 && (
        <div className="rounded-xs border border-ink-500 bg-ink-50 p-3">
          <p className={labelCls}>Next fire times</p>
          <ul className="mt-1 space-y-0.5">
            {preview.nextFireTimes.map((t) => (
              <li key={t} className="font-mono text-[11px] text-paper-muted">{new Date(t).toISOString()}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function ActionsStep({ form, update, channels }: StepProps & { channels: NotificationChannel[] }) {
  return (
    <>
      <div className="rounded-xs border border-ink-500 bg-ink-50 px-3 py-2.5">
        <p className="text-[12px] text-paper">Failure alerting</p>
        <p className="mt-0.5 text-[11px] text-paper-muted">
          The selected channels are notified when a run <span className="text-paper">fails</span>, and once more when it recovers.
          Sustained failures stay quiet (transition-based).
        </p>
      </div>
      <div className={sectionCls}>
        <Label className={labelCls}>Notification channels</Label>
        <MultiSelect
          options={channels.map((ch) => ({ value: ch.id, label: ch.name, hint: ch.type }))}
          selected={form.channelIds}
          onChange={(next) => update({ channelIds: next })}
          placeholder="Select channels to notify on failure…"
          emptyText="No channels — add one in Admin → Settings → Alerting"
        />
        {channels.length === 0 && (
          <p className="text-[11px] text-paper-muted">No channels configured yet. Add one in Admin → Settings → Alerting.</p>
        )}
      </div>
    </>
  );
}

function OutputStep({ form, update, preview, onPreview, previewing }: StepProps & { preview: PreviewResult | null; onPreview: () => Promise<unknown>; previewing: boolean }) {
  return (
    <>
      <div className={sectionCls}>
        <Label className={labelCls}>Output mode</Label>
        <Select value={form.outputMode} onValueChange={(v) => update({ outputMode: v as SqOutputMode })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None (read-only)</SelectItem>
            <SelectItem value="append">Append</SelectItem>
            <SelectItem value="replace">Replace partition</SelectItem>
            <SelectItem value="upsert">Upsert (ReplacingMergeTree)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {form.outputMode !== "none" && (
        <>
          <div className="flex gap-2">
            <div className={cn(sectionCls, "flex-1")}>
              <Label className={labelCls}>Destination database</Label>
              <Input value={form.destDatabase} onChange={(e) => update({ destDatabase: e.target.value })} />
            </div>
            <div className={cn(sectionCls, "flex-1")}>
              <Label className={labelCls}>Destination table</Label>
              <Input value={form.destTable} onChange={(e) => update({ destTable: e.target.value })} />
            </div>
          </div>
          {form.outputMode === "replace" && (
            <div className={sectionCls}>
              <Label className={labelCls}>Partition expression</Label>
              <Input value={form.partitionExpr} onChange={(e) => update({ partitionExpr: e.target.value })} placeholder="toYYYYMMDD({{slot_end}})" className="font-mono" />
            </div>
          )}
          <ToggleRow label="Create destination table if missing" checked={form.createIfMissing} onChange={(v) => update({ createIfMissing: v })} />
          <div className="space-y-3 border-t border-ink-500 pt-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Read semantics</p>
            <ToggleRow
              label="Apply FINAL (dedup *MergeTree)"
              hint="Tables like ReplacingMergeTree keep old/duplicate rows until a background merge removes them, so a read can briefly see duplicates. Turn this on to deduplicate at read time so you don't write duplicate rows to the destination. Slower; leave off unless the source reads those table engines."
              checked={form.useFinal}
              onChange={(v) => update({ useFinal: v })}
            />
            <ToggleRow
              label="Sequential consistency (Replicated*)"
              hint="On Replicated source tables, the server your query hits can lag a few seconds behind, so a read may miss the latest rows. Turn this on to force an up-to-date read so you don't write stale data. Small latency cost; only matters for Replicated* source tables."
              checked={form.seqConsistency}
              onChange={(v) => update({ seqConsistency: v })}
            />
          </div>
          {form.createIfMissing && (
            <div className="flex gap-2">
              <div className={cn(sectionCls, "flex-1")}>
                <Label className={labelCls}>Engine</Label>
                <Input value={form.engine} onChange={(e) => update({ engine: e.target.value })} />
              </div>
              <div className={cn(sectionCls, "flex-1")}>
                <Label className={labelCls}>ORDER BY</Label>
                <Input value={form.orderBy} onChange={(e) => update({ orderBy: e.target.value })} />
              </div>
            </div>
          )}
          <Button variant="outline" onClick={() => void onPreview()} disabled={previewing}>
            {previewing && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            Check destination
          </Button>
          {preview?.destination && (
            <div className="rounded-xs border border-ink-500 bg-ink-50 p-3 text-[11px]">
              {preview.destination.error && <p className="text-red-600">{preview.destination.error}</p>}
              {preview.destination.exists === true && (
                <p className={preview.destination.compatible && !preview.destination.engineError ? "text-emerald-600" : "text-amber-600"}>
                  {preview.destination.engineError ?? (preview.destination.compatible ? `Compatible (${preview.destination.engine})` : "Schema mismatch — see missing columns")}
                </p>
              )}
              {preview.destination.exists === false && (
                <div className="space-y-1">
                  <p className="text-amber-600">Destination does not exist{preview.destination.willCreate ? " — will be created on first run" : ""}.</p>
                  {preview.destination.createDDL && <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-paper-muted">{preview.destination.createDDL}</pre>}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

function ReviewStep({ form, channels, connectionName }: { form: FormState; channels: NotificationChannel[]; connectionName: string | null }) {
  const selectedChannels = channels.filter((c) => form.channelIds.includes(c.id)).map((c) => c.name);
  const rows: Array<[string, string]> = [
    ["Name", form.name],
    ["Connection", connectionName ?? form.connectionId],
    ["Frequency", form.frequency === "cron" ? `cron ${form.cronExpr}` : form.frequency],
    ["Alert on failure", selectedChannels.length > 0 ? selectedChannels.join(", ") : "no channels"],
    ["Output", form.outputMode === "none" ? "read-only" : `${form.outputMode} → ${form.destDatabase}.${form.destTable}`],
    ["Enabled", form.enabled ? "yes" : "no"],
  ];
  return (
    <div className="space-y-3">
      <ToggleRow label="Enabled" checked={form.enabled} onChange={() => undefined} disabled />
      <dl className="divide-y divide-ink-500 rounded-xs border border-ink-500">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between px-3 py-2">
            <dt className={labelCls}>{k}</dt>
            <dd className="text-right text-[12px] text-paper">{v}</dd>
          </div>
        ))}
      </dl>
      <details className="rounded-xs border border-ink-500 bg-ink-50 p-3">
        <summary className={cn(labelCls, "cursor-pointer")}>Query</summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-paper-muted">{form.query}</pre>
      </details>
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-paper">{label}</span>
        {hint && (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" aria-label={`What is ${label}?`} className="grid h-4 w-4 place-items-center rounded-full text-paper-faint hover:text-paper">
                <Info className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-72 rounded-xs border-ink-500 bg-ink-100 p-3 text-[11px] leading-relaxed text-paper-muted">
              {hint}
            </PopoverContent>
          </Popover>
        )}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} className="shrink-0" />
    </div>
  );
}
