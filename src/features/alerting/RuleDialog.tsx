/**
 * RuleDialog — shared create/edit dialog for a fleet alert rule: thresholds,
 * severity, AI auto-RCA, and which notification channels deliver it. Used by the
 * Admin → Alerting "Alert rules" panel. The channel attachment is the rule's
 * delivery wiring — the same links the Fleet "Alert delivery" dialog edits.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Stethoscope, SlidersHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { log } from "@/lib/log";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchDoctorModels } from "@/api/fleet";
import {
  listChannels,
  listRules,
  createRule,
  updateRule,
  AlertSeverity,
  AlertSourceType,
  CHANNEL_TYPE_LABELS,
  ALERT_SOURCE_TYPE_LABELS,
  ALERT_SOURCE_SCOPE_LABELS,
  SUPPORTED_RULE_SOURCE_TYPES,
  RULE_SOURCE_FIELD_SPECS,
  type AlertRule,
} from "@/api/alerting";
import { ALERTING_KEYS, DIALOG_SAVE_BTN } from "./ChannelDialog";

const LABEL_CLASS = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

interface RuleDialogProps {
  open: boolean;
  rule: AlertRule | null; // null = create
  onClose: () => void;
}

export function RuleDialog({ open, rule, onClose }: RuleDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = rule !== null;

  const channelsQuery = useQuery({ queryKey: ALERTING_KEYS.channels, queryFn: listChannels, enabled: open });
  const rulesQuery = useQuery({ queryKey: ALERTING_KEYS.rules, queryFn: listRules, enabled: open });
  const modelsQuery = useQuery({
    queryKey: ["fleet", "doctor", "models"],
    queryFn: fetchDoctorModels,
    enabled: open,
  });
  // Disabled channels can't deliver, so they aren't offered for attachment.
  // (A disabled channel already linked to the rule stays linked — it's just
  // hidden here — because channelIds is seeded from the rule and sent as-is.)
  const channels = (channelsQuery.data ?? []).filter((c) => c.enabled);
  const models = modelsQuery.data ?? [];
  // Only one fleet rule may be enabled at a time — surface the conflict up front.
  const otherEnabledFleet = (rulesQuery.data ?? []).find(
    (r) => r.id !== rule?.id && r.sourceType === AlertSourceType.FleetThreshold && r.enabled,
  );

  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [sourceType, setSourceType] = useState<AlertSourceType>(AlertSourceType.FleetThreshold);
  const [severity, setSeverity] = useState<AlertSeverity>(AlertSeverity.Warning);
  const [config, setConfig] = useState<Record<string, number>>({});
  const [aiRcaEnabled, setAiRcaEnabled] = useState(false);
  const [aiRcaModelId, setAiRcaModelId] = useState<string>();
  const [channelIds, setChannelIds] = useState<string[]>([]);

  const specs = RULE_SOURCE_FIELD_SPECS[sourceType];
  const resolvedRcaModelId = aiRcaModelId ?? models.find((m) => m.isDefault)?.id ?? models[0]?.id;

  const configFromSpec = (
    src: AlertSourceType,
    from: Record<string, unknown>,
  ): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const s of RULE_SOURCE_FIELD_SPECS[src]) out[s.key] = Number(from[s.key] ?? 0);
    return out;
  };

  useEffect(() => {
    if (!open) return;
    if (rule) {
      setName(rule.name);
      setEnabled(rule.enabled);
      setSourceType(rule.sourceType);
      setSeverity(rule.severity);
      setConfig(configFromSpec(rule.sourceType, rule.config as Record<string, unknown>));
      setAiRcaEnabled(rule.aiRcaEnabled);
      setAiRcaModelId(rule.aiRcaModelId ?? undefined);
      setChannelIds(rule.channelIds);
    } else {
      setName("");
      setEnabled(true);
      setSourceType(AlertSourceType.FleetThreshold);
      setSeverity(AlertSeverity.Warning);
      setConfig(configFromSpec(AlertSourceType.FleetThreshold, {}));
      setAiRcaEnabled(false);
      setAiRcaModelId(undefined);
      setChannelIds([]);
    }
  }, [open, rule]);

  // Switching type during create re-seeds the config to that type's fields.
  const onSourceTypeChange = (next: AlertSourceType) => {
    setSourceType(next);
    setConfig(configFromSpec(next, {}));
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        sourceType,
        severity,
        enabled,
        aiRcaEnabled,
        aiRcaModelId: resolvedRcaModelId ?? null,
        config,
        channelIds,
      };
      if (isEdit && rule) await updateRule(rule.id, body);
      else await createRule(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALERTING_KEYS.rules });
      toast.success(isEdit ? "Rule updated" : "Rule created");
      onClose();
    },
    onError: (e) => {
      log.error("Failed to save rule", e);
      toast.error(errMessage(e));
    },
  });

  const toggleChannel = (id: string) =>
    setChannelIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const enableConflict =
    enabled && sourceType === AlertSourceType.FleetThreshold && Boolean(otherEnabledFleet);
  const canSave = name.trim().length > 0 && !mutation.isPending && !enableConflict;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto rounded-xs border-ink-500 bg-ink-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-paper">
            <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
            </span>
            <span className="flex flex-col gap-0.5 text-left">
              <span className="text-[16px] font-semibold tracking-tight">
                {isEdit ? "Edit alert rule" : "New alert rule"}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                Thresholds · channels · AI auto-RCA
              </span>
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className={LABEL_CLASS}>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Production thresholds" />
          </div>

          <div className="space-y-1.5">
            <Label className={LABEL_CLASS}>Type</Label>
            <Select
              value={sourceType}
              onValueChange={(v) => onSourceTypeChange(v as AlertSourceType)}
              disabled={isEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_RULE_SOURCE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ALERT_SOURCE_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className={LABEL_CLASS}>Severity</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as AlertSeverity)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(AlertSeverity).map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end justify-between">
              <Label className={LABEL_CLASS}>Active for {ALERT_SOURCE_SCOPE_LABELS[sourceType]}</Label>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
          </div>

          {enableConflict && (
            <p className="rounded-xs border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
              Fleet rule “{otherEnabledFleet?.name}” is already enabled. Only one fleet rule can be
              active at a time — disable it first.
            </p>
          )}

          {/* Config fields generated dynamically from the source type's spec */}
          {specs.length > 0 && (
            <div className="space-y-1.5">
              <Label className={LABEL_CLASS}>Thresholds · 0 = off</Label>
              <div className="grid grid-cols-2 gap-2">
                {specs.map((spec) => (
                  <NumField
                    key={spec.key}
                    label={spec.label}
                    value={config[spec.key] ?? 0}
                    min={spec.min}
                    max={spec.max}
                    onChange={(n) => setConfig((c) => ({ ...c, [spec.key]: n }))}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Channel attachment = delivery wiring */}
          <div className="space-y-1.5">
            <Label className={LABEL_CLASS}>Deliver to channels</Label>
            {channels.length === 0 ? (
              <p className="rounded-xs border border-dashed border-ink-500 px-3 py-3 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                No channels — add one first
              </p>
            ) : (
              <ul className="divide-y divide-ink-500 rounded-xs border border-ink-500">
                {channels.map((ch) => {
                  const selected = channelIds.includes(ch.id);
                  return (
                    <li key={ch.id} className="flex items-center gap-2.5 px-3 py-2">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={selected}
                        onClick={() => toggleChannel(ch.id)}
                        className={cn(
                          "grid h-4 w-4 shrink-0 place-items-center rounded-xs border",
                          selected ? "border-brand bg-brand text-ink-50" : "border-ink-500 bg-ink-200",
                        )}
                      >
                        {selected && <span className="text-[10px] leading-none">✓</span>}
                      </button>
                      <span className="inline-flex items-center rounded-xs border border-ink-500 bg-ink-100 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-muted">
                        {CHANNEL_TYPE_LABELS[ch.type]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-paper">{ch.name}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* AI auto-RCA */}
          <div className="rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[13px] font-medium text-paper">
                <Stethoscope className="h-3.5 w-3.5 text-brand" aria-hidden /> AI auto-RCA on breach
              </span>
              <Switch checked={aiRcaEnabled} onCheckedChange={setAiRcaEnabled} />
            </div>
            {aiRcaEnabled && models.length > 1 && (
              <label className="mt-2.5 flex items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-dim">Model</span>
                <select
                  value={resolvedRcaModelId ?? ""}
                  onChange={(e) => setAiRcaModelId(e.target.value)}
                  className="h-8 max-w-[230px] rounded-xs border border-ink-500 bg-ink-100 px-2 text-[11px] text-paper focus:border-brand focus:outline-none"
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} · {m.model}
                      {m.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>

        <DialogFooter className="border-t border-ink-500 pt-4">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={mutation.isPending}
            className="h-9 rounded-xs font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper"
          >
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSave} className={DIALOG_SAVE_BTN}>
            {mutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint">{label}</span>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
        }}
        className="h-9 rounded-xs border-ink-500 bg-ink-200 text-right font-mono text-[13px] text-paper focus-visible:border-brand focus-visible:ring-0"
      />
    </label>
  );
}
