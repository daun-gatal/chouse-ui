/**
 * FleetAlertDeliveryDialog — configure always-on alert delivery (Slack + email).
 *
 * This drives the SERVER-SIDE alerter (the poller delivers even with no browser
 * open), distinct from the bell's per-browser toast/desktop toggles. Super-admin
 * only. Secrets are never read back: a blank webhook/password means "keep the
 * existing one"; the trash button clears a channel.
 */

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Mail, Send, Loader2, Trash2, Radio, Stethoscope, Info } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  fetchFleetAlertConfig,
  updateFleetAlertConfig,
  testFleetAlertConfig,
  fetchDoctorModels,
} from "@/api/fleet";

const labelCls = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim";
const inputCls =
  "h-9 rounded-xs border-ink-500 bg-ink-200 text-[13px] text-paper focus-visible:border-brand focus-visible:ring-0";

export default function FleetAlertDeliveryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["fleet", "alert-config"],
    queryFn: fetchFleetAlertConfig,
    enabled: open,
  });
  const modelsQuery = useQuery({
    queryKey: ["fleet", "doctor", "models"],
    queryFn: fetchDoctorModels,
    enabled: open,
  });
  const models = modelsQuery.data ?? [];

  const [enabled, setEnabled] = useState(true);
  const [memoryPercent, setMemoryPercent] = useState(85);
  const [queryMemoryGb, setQueryMemoryGb] = useState(0);
  const [longQueryMin, setLongQueryMin] = useState(0);
  const [slackUrl, setSlackUrl] = useState("");
  const [emailUser, setEmailUser] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [slackEnabled, setSlackEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [aiRcaOnBreach, setAiRcaOnBreach] = useState(false);
  const [aiRcaModelId, setAiRcaModelId] = useState<string>();
  const resolvedRcaModelId = aiRcaModelId ?? models.find((m) => m.isDefault)?.id ?? models[0]?.id;

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setAiRcaOnBreach(data.aiRcaOnBreach);
    setAiRcaModelId(data.aiRcaModelId ?? undefined);
    setMemoryPercent(data.rules.memoryPercent);
    setQueryMemoryGb(data.rules.queryMemoryGb);
    setLongQueryMin(data.rules.longQueryMin);
    setSlackUrl("");
    setEmailUser(data.email.user);
    setEmailTo(data.email.to);
    setEmailPassword("");
    setSlackEnabled(data.slack.enabled);
    setEmailEnabled(data.email.enabled);
  }, [data]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["fleet", "alert-config"] });

  const save = useMutation({
    mutationFn: () =>
      updateFleetAlertConfig({
        enabled,
        aiRcaOnBreach,
        aiRcaModelId: resolvedRcaModelId,
        rules: { memoryPercent, queryMemoryGb, longQueryMin },
        slackWebhookUrl: slackUrl.trim() || undefined,
        slackEnabled,
        email:
          emailUser.trim() && emailTo.trim()
            ? { user: emailUser.trim(), to: emailTo.trim(), password: emailPassword || undefined }
            : undefined,
        emailEnabled,
      }),
    onSuccess: () => {
      toast.success("Delivery settings saved");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save"),
  });

  const test = useMutation({
    mutationFn: testFleetAlertConfig,
    onSuccess: (r) =>
      toast.success(
        `Test alert sent${r.slack ? " · Slack" : ""}${r.email ? " · email" : ""}`,
      ),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Test failed — save a channel first"),
  });

  const remove = useMutation({
    mutationFn: (which: "slack" | "email") =>
      updateFleetAlertConfig({
        enabled,
        rules: { memoryPercent, queryMemoryGb, longQueryMin },
        ...(which === "slack" ? { removeSlack: true } : {}),
        ...(which === "email" ? { removeEmail: true } : {}),
      }),
    onSuccess: () => {
      toast.success("Channel removed");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to remove"),
  });

  const busy = save.isPending || remove.isPending;
  const canTest = Boolean(data?.slack.configured || data?.email.configured);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto rounded-xs border-ink-500 bg-ink-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-paper">
            <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
              <Radio className="h-4 w-4" aria-hidden />
            </span>
            <span className="flex flex-col gap-0.5 text-left">
              <span className="text-[16px] font-semibold tracking-tight">Alert delivery</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                Slack &amp; email · always-on
              </span>
            </span>
          </DialogTitle>
          <DialogDescription className="text-paper-muted">
            Server-side delivery — fires even with no browser open. Separate from the
            bell's per-browser toast / desktop notifications.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-paper-dim" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Master enable */}
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled((v) => !v)}
              className="flex w-full items-center justify-between rounded-xs border border-ink-500 bg-ink-200 px-4 py-3"
            >
              <span className="text-[13px] font-medium text-paper">Delivery enabled</span>
              <span
                className={cn(
                  "inline-flex h-4 w-7 items-center rounded-full px-0.5 transition-colors",
                  enabled ? "bg-brand" : "bg-ink-400",
                )}
              >
                <span
                  className={cn(
                    "h-3 w-3 rounded-full bg-ink-50 transition-transform",
                    enabled ? "translate-x-3" : "translate-x-0",
                  )}
                />
              </span>
            </button>

            {/* Config sections dim while delivery is disabled — nothing fires. */}
            <div className={cn("space-y-5 transition-opacity", !enabled && "opacity-40")}>

            {/* Rules */}
            <div className="space-y-2">
              <div className={labelCls}>Thresholds · 0 = off</div>
              <div className="grid grid-cols-3 gap-2">
                <NumField label="Node mem %" value={memoryPercent} min={0} max={100} onChange={setMemoryPercent} />
                <NumField label="Query GB" value={queryMemoryGb} min={0} max={1024} onChange={setQueryMemoryGb} />
                <NumField label="Query min" value={longQueryMin} min={0} max={1440} onChange={setLongQueryMin} />
              </div>
            </div>

            {/* Slack */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[13px] font-medium text-paper">
                  <MessageSquare className="h-3.5 w-3.5 text-paper-muted" aria-hidden /> Slack
                  {data?.slack.configured && (
                    <span className="rounded-xs border border-emerald-300 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-600 dark:border-emerald-500/50 dark:text-emerald-400">
                      Configured
                    </span>
                  )}
                </span>
                <Switch checked={slackEnabled} onChange={setSlackEnabled} label="Enable Slack delivery" />
              </div>
              <Input
                value={slackUrl}
                onChange={(e) => setSlackUrl(e.target.value)}
                placeholder={data?.slack.configured ? "•••• keep current webhook (paste to replace)" : "https://hooks.slack.com/services/…"}
                className={cn(inputCls, !slackEnabled && "opacity-50")}
              />
              {data?.slack.configured && (
                <button
                  type="button"
                  onClick={() => remove.mutate("slack")}
                  className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint hover:text-red-600 dark:hover:text-red-400"
                >
                  <Trash2 className="h-3 w-3" aria-hidden /> Remove webhook
                </button>
              )}
            </div>

            {/* Email */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[13px] font-medium text-paper">
                  <Mail className="h-3.5 w-3.5 text-paper-muted" aria-hidden /> Email (Gmail)
                  {data?.email.configured && (
                    <span className="rounded-xs border border-emerald-300 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-emerald-600 dark:border-emerald-500/50 dark:text-emerald-400">
                      Configured
                    </span>
                  )}
                </span>
                <Switch checked={emailEnabled} onChange={setEmailEnabled} label="Enable email delivery" />
              </div>
              <div className={cn("space-y-2", !emailEnabled && "opacity-50")}>
                <div className="grid grid-cols-2 gap-2">
                  <Input value={emailUser} onChange={(e) => setEmailUser(e.target.value)} placeholder="you@gmail.com" className={inputCls} />
                  <Input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="send to: ops@team.com" className={inputCls} />
                </div>
                <Input
                  type="password"
                  value={emailPassword}
                  onChange={(e) => setEmailPassword(e.target.value)}
                  placeholder={data?.email.configured ? "•••• keep current app password" : "Gmail app password (16 chars)"}
                  className={inputCls}
                />
              </div>
              <p className="text-[11px] text-paper-faint">
                Gmail needs an <strong className="text-paper-muted">App Password</strong> (Account → Security → 2-Step Verification → App passwords), not your normal password.
              </p>
              {data?.email.configured && (
                <button
                  type="button"
                  onClick={() => remove.mutate("email")}
                  className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint hover:text-red-600 dark:hover:text-red-400"
                >
                  <Trash2 className="h-3 w-3" aria-hidden /> Remove email
                </button>
              )}
            </div>

            {/* AI auto-RCA on breach */}
            <div className="rounded-xs border border-ink-500 bg-ink-200 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[13px] font-medium text-paper">
                  <Stethoscope className="h-3.5 w-3.5 text-brand" aria-hidden /> AI auto-RCA on breach
                </span>
                <Switch checked={aiRcaOnBreach} onChange={setAiRcaOnBreach} label="Enable AI auto-RCA on breach" />
              </div>
              <p className="mt-1.5 text-[11px] text-paper-faint">
                When a new breach fires, Chouse AI investigates the fleet and posts a root-cause
                analysis to the channels above. Needs an AI provider configured (Settings → AI).
              </p>
              {aiRcaOnBreach && (
                <p className="mt-2 flex gap-1.5 rounded-xs bg-ink-100 px-2.5 py-2 text-[11px] leading-relaxed text-paper-faint">
                  <Info className="mt-0.5 h-3 w-3 shrink-0 text-paper-dim" aria-hidden />
                  <span>
                    To control cost, scans are throttled to <strong className="text-paper-muted">~once every 15 min</strong>.
                    A breach during the cooldown won't spawn its own scan — but that query still appears in the
                    next report's <strong className="text-paper-muted">Heavy Query Analysis</strong> (6h window).
                  </span>
                </p>
              )}
              {aiRcaOnBreach && models.length > 1 && (
                <label className="mt-2.5 flex items-center gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-dim">Model</span>
                  <select
                    value={resolvedRcaModelId ?? ""}
                    onChange={(e) => setAiRcaModelId(e.target.value)}
                    className="h-8 max-w-[230px] rounded-xs border border-ink-500 bg-ink-100 px-2 text-[11px] text-paper focus:border-brand focus:outline-none"
                    title="Model for the autonomous RCA scan"
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

            {/* Actions */}
            <div className="flex items-center justify-between border-t border-ink-500 pt-4">
              <Button
                variant="ghost"
                onClick={() => test.mutate()}
                disabled={!canTest || test.isPending}
                className="h-9 gap-2 rounded-xs border border-ink-500 bg-ink-200 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-300 hover:text-paper"
              >
                {test.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Send test
              </Button>
              <Button
                onClick={() => save.mutate()}
                disabled={busy}
                className="h-9 gap-2 rounded-xs bg-brand px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
              >
                {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>
        )}
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

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        checked ? "bg-brand" : "bg-ink-400",
      )}
    >
      <span
        className={cn(
          "h-3 w-3 rounded-full bg-ink-50 shadow-sm transition-transform",
          checked ? "translate-x-3" : "translate-x-0",
        )}
        aria-hidden
      />
    </button>
  );
}
