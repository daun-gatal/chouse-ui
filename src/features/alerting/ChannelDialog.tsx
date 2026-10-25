/**
 * ChannelDialog — shared create/edit dialog for a notification channel, in
 * steps (ADR 0026 §7): Platform → Connect → Test → Who can act. Connect renders
 * its fields from CHANNEL_FIELD_SPECS, so each channel type and mode gets the
 * right form. Secrets are write-only: a configured secret shows a masked
 * placeholder and is only sent when a new value is typed. "Who can act" only
 * appears for channels whose messages carry buttons (App mode, Telegram).
 */

import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, Copy, Loader2, Radio, X } from "lucide-react";

import { log } from "@/lib/log";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createChannel,
  updateChannel,
  testChannel,
  ChannelType,
  CHANNEL_FIELD_SPECS,
  CHANNEL_TYPE_LABELS,
  isAppChannel,
  visibleFieldSpecs,
  type ChannelCheck,
  type NotificationChannel,
  type ChannelInput,
  type ChannelFieldSpec,
} from "@/api/alerting";
import { actorsOf, type ChannelActors } from "./actors";
import { WhoCanActEditor } from "./WhoCanActEditor";

/** Shared React Query keys so every alerting surface dedupes + cross-refreshes. */
export const ALERTING_KEYS = {
  channels: ["alerting", "channels"] as const,
  rules: ["alerting", "rules"] as const,
  events: ["alerting", "events"] as const,
  overview: ["alerting", "overview"] as const,
};

const LABEL_CLASS = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim";
/** Themed primary action button for the alerting dialogs (matches the SSO wizard). */
export const DIALOG_SAVE_BTN =
  "h-9 gap-2 rounded-xs bg-brand px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50";
const GHOST_BTN = "h-9 rounded-xs font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper";

type Step = "platform" | "connect" | "test" | "who";
const STEP_LABELS: Record<Step, string> = { platform: "Platform", connect: "Connect", test: "Test", who: "Who can act" };

const PLATFORM_HINTS: Record<ChannelType, string> = {
  [ChannelType.Slack]: "Webhook, or an app with buttons",
  [ChannelType.GoogleChat]: "Webhook, or a Chat app with buttons",
  [ChannelType.Telegram]: "A bot in a group, with buttons",
  [ChannelType.Email]: "SMTP",
  [ChannelType.Webhook]: "JSON to your endpoint",
};

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

function defaultConfigFor(specs: ChannelFieldSpec[]): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  for (const s of specs) cfg[s.key] = s.kind === "boolean" ? true : s.kind === "select" ? s.options?.[0]?.value ?? "" : "";
  return cfg;
}

/** Where a platform calls back for button presses, to paste into its app settings. */
function callbackUrl(type: ChannelType, config: Record<string, unknown>): string | null {
  if (config.mode !== "app") return null;
  const origin = window.location.origin;
  if (type === ChannelType.Slack) return `${origin}/api/integrations/slack/interactions`;
  if (type === ChannelType.GoogleChat) return `${origin}/api/integrations/google-chat/events`;
  return null;
}

interface ChannelDialogProps {
  open: boolean;
  channel: NotificationChannel | null; // null = create
  onClose: () => void;
}

export function ChannelDialog({ open, channel, onClose }: ChannelDialogProps) {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState<NotificationChannel | null>(null);
  const current = saved ?? channel;
  const isEdit = current !== null;

  const [step, setStep] = useState<Step>("platform");
  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>(ChannelType.Slack);
  const [enabled, setEnabled] = useState(true);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [actors, setActors] = useState<ChannelActors>(actorsOf({}));
  const [checks, setChecks] = useState<{ ok: boolean; checks: ChannelCheck[]; error: string | null } | null>(null);

  const specs = visibleFieldSpecs(type, config);
  const bot = isAppChannel({ type, config });
  const steps: Step[] = [...(channel ? [] : ["platform" as const]), "connect", "test", ...(bot ? ["who" as const] : [])];

  useEffect(() => {
    if (!open) return;
    setSaved(null);
    setChecks(null);
    if (channel) {
      setStep("connect");
      setName(channel.name);
      setType(channel.type);
      setEnabled(channel.enabled);
      setConfig({ ...defaultConfigFor(CHANNEL_FIELD_SPECS[channel.type]), ...channel.config });
      setActors(actorsOf(channel.config));
    } else {
      setStep("platform");
      setName("");
      setType(ChannelType.Slack);
      setEnabled(true);
      setConfig(defaultConfigFor(CHANNEL_FIELD_SPECS[ChannelType.Slack]));
      setActors(actorsOf({}));
    }
  }, [open, channel]);

  const pickType = (next: ChannelType) => {
    setType(next);
    // Keep values for keys the new type shares (notably `webhookUrl`, shared by
    // Slack and Google Chat), so a mis-typed channel is fixed by flipping the type.
    setConfig((prev) => {
      const base = defaultConfigFor(CHANNEL_FIELD_SPECS[next]);
      const nextKeys = new Set(CHANNEL_FIELD_SPECS[next].map((s) => s.key));
      const carried: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (nextKeys.has(k) && v !== "" && v !== undefined && v !== null) carried[k] = v;
      }
      return { ...base, ...carried };
    });
  };

  // A webhook URL that clearly belongs to the other provider is rejected at
  // delivery time, so it is blocked here.
  const webhookUrl = typeof config.webhookUrl === "string" ? config.webhookUrl : "";
  const urlTypeMismatch =
    type === ChannelType.Slack && config.mode !== "app" && /chat\.googleapis\.com/i.test(webhookUrl)
      ? "This looks like a Google Chat webhook URL, but the channel type is Slack. Switch the type to Google Chat — otherwise alerts go out in Slack format and Google Chat rejects them."
      : type === ChannelType.GoogleChat && config.mode !== "app" && /hooks\.slack\.com/i.test(webhookUrl)
        ? "This looks like a Slack webhook URL, but the channel type is Google Chat. Switch the type to Slack."
        : null;

  const input = (withActors: boolean): ChannelInput => {
    const cleaned: Record<string, unknown> = {};
    for (const s of specs) {
      const v = config[s.key];
      if (s.secret && (v === "" || v === undefined || v === null)) continue;
      if (s.kind === "number" && !s.required && (v === "" || v === undefined || v === null)) continue;
      cleaned[s.key] = s.kind === "number" ? Number(v) || 0 : v;
    }
    // The list is sent as edited; leaving it out keeps the stored one.
    if (withActors && bot) cleaned.actors = actors;
    return { name: name.trim(), type, enabled, config: cleaned };
  };

  const runTest = async (id: string): Promise<void> => {
    setChecks(null);
    try {
      const result = await testChannel(id);
      setChecks({ ok: true, checks: result?.checks ?? [{ label: "Test message sent", ok: true }], error: null });
    } catch (e) {
      setChecks({ ok: false, checks: [], error: errMessage(e) });
    }
  };

  const saveConnect = useMutation({
    mutationFn: async (): Promise<NotificationChannel> => {
      const body = input(false);
      if (current) {
        await updateChannel(current.id, body);
        return { ...current, ...body, config: { ...current.config, ...body.config } };
      }
      const { id } = await createChannel(body);
      return { id, ...body, configured: {}, createdAt: Date.now(), updatedAt: Date.now() };
    },
    onSuccess: (row) => {
      setSaved(row);
      queryClient.invalidateQueries({ queryKey: ALERTING_KEYS.channels });
      toast.success(isEdit ? "Channel updated" : "Channel created");
      setStep("test");
      void runTest(row.id);
    },
    onError: (e) => {
      log.error("Failed to save channel", e);
      toast.error(errMessage(e));
    },
  });

  const saveActors = useMutation({
    mutationFn: async () => {
      if (!current) return;
      await updateChannel(current.id, input(true));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALERTING_KEYS.channels });
      toast.success("Saved who can act from this channel");
      onClose();
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  const canSave = name.trim().length > 0 && !saveConnect.isPending && !urlTypeMismatch;
  const callback = callbackUrl(type, config);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-xs border-ink-500 bg-ink-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-paper">
            <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
              <Radio className="h-4 w-4" aria-hidden />
            </span>
            <span className="flex flex-col gap-0.5 text-left">
              <span className="text-[16px] font-semibold tracking-tight">{channel ? "Edit channel" : "New notification channel"}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Slack · Google Chat · Telegram · Email · Webhook</span>
            </span>
          </DialogTitle>
        </DialogHeader>

        <ol className="flex flex-wrap items-center gap-1.5" aria-label="Steps">
          {steps.map((s, i) => {
            const index = steps.indexOf(step);
            const reachable = s === "platform" ? !channel : s === "connect" ? true : current !== null;
            return (
              <li key={s}>
                <button
                  type="button"
                  disabled={!reachable || saveConnect.isPending}
                  onClick={() => {
                    setStep(s);
                    if (s === "test" && current) void runTest(current.id);
                  }}
                  aria-current={s === step ? "step" : undefined}
                  className={cn(
                    "rounded-xs border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] disabled:opacity-50",
                    s === step ? "border-brand bg-brand/10 text-paper" : i < index ? "border-ink-500 text-paper-muted" : "border-ink-500 text-paper-faint",
                  )}
                >
                  {i + 1} {STEP_LABELS[s]}
                </button>
              </li>
            );
          })}
        </ol>

        {step === "platform" && (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Platform">
            {Object.values(ChannelType).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => pickType(t)}
                className={cn("rounded-xs border px-3 py-2.5 text-left", type === t ? "border-brand bg-brand/10" : "border-ink-500 bg-ink-200 hover:border-ink-400")}
              >
                <span className="block text-[13px] text-paper">{CHANNEL_TYPE_LABELS[t]}</span>
                <span className="block text-[11px] text-paper-faint">{PLATFORM_HINTS[t]}</span>
              </button>
            ))}
          </div>
        )}

        {step === "connect" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className={LABEL_CLASS} htmlFor="channel-name">Name</Label>
              <Input id="channel-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. On-call Slack" />
            </div>
            {channel && (
              <div className="space-y-1.5">
                <Label className={LABEL_CLASS}>Type</Label>
                <Select value={type} onValueChange={(v) => pickType(v as ChannelType)}>
                  <SelectTrigger aria-label="Type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.values(ChannelType).map((t) => (
                      <SelectItem key={t} value={t}>{CHANNEL_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {specs.map((spec) => (
              <Field
                key={spec.key}
                spec={spec}
                value={config[spec.key]}
                onChange={(v) => setConfig((c) => ({ ...c, [spec.key]: v }))}
                configured={Boolean(channel && channel.type === type && (channel.config.mode ?? "webhook") === (config.mode ?? "webhook") && channel.configured[spec.key])}
              />
            ))}
            {callback && (
              <div className="rounded-xs border border-ink-500 bg-ink-200 px-3 py-2">
                <p className={LABEL_CLASS}>{type === ChannelType.Slack ? "Interactivity request URL" : "App endpoint URL"} — paste it into the app settings</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-paper">{callback}</code>
                  <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label="Copy URL" onClick={() => void navigator.clipboard?.writeText(callback).then(() => toast.success("Copied"))}>
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              </div>
            )}
            {urlTypeMismatch && (
              <div className="flex items-start gap-2 rounded-xs border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{urlTypeMismatch}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-ink-500 pt-3">
              <Label className={LABEL_CLASS}>Enabled</Label>
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enabled" />
            </div>
          </div>
        )}

        {step === "test" && (
          <div className="space-y-3" aria-live="polite">
            <p className="text-[13px] text-paper">Send a test message</p>
            {!checks ? (
              <p className="flex items-center gap-2 text-[12px] text-paper-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</p>
            ) : (
              <ul className="space-y-1.5 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2">
                {checks.checks.map((c) => (
                  <li key={c.label} className={cn("flex items-center gap-2 text-[12px]", c.ok ? "text-emerald-400" : "text-amber-400")}>
                    {c.ok ? <Check className="h-3.5 w-3.5" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden />} {c.label}
                  </li>
                ))}
                {checks.error && (
                  <li className="flex items-start gap-2 text-[12px] text-red-300"><X className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {checks.error}</li>
                )}
              </ul>
            )}
            <p className="text-[11px] text-paper-faint">Check it arrived. You can fix the settings in Connect and test again.</p>
          </div>
        )}

        {step === "who" && current && (
          <div className="space-y-2">
            <p className="text-[13px] text-paper">Who can act from this channel</p>
            <WhoCanActEditor type={type} value={actors} onChange={setActors} disabled={saveActors.isPending} />
          </div>
        )}

        <DialogFooter className="border-t border-ink-500 pt-4">
          <Button variant="ghost" onClick={onClose} disabled={saveConnect.isPending || saveActors.isPending} className={GHOST_BTN}>
            {current && step !== "connect" ? "Close" : "Cancel"}
          </Button>
          {step === "platform" && (
            <Button onClick={() => setStep("connect")} className={DIALOG_SAVE_BTN}>Continue</Button>
          )}
          {step === "connect" && (
            <Button onClick={() => saveConnect.mutate()} disabled={!canSave} className={DIALOG_SAVE_BTN}>
              {saveConnect.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {current ? "Save and test" : "Create and test"}
            </Button>
          )}
          {step === "test" && current && (
            <>
              <Button variant="ghost" onClick={() => void runTest(current.id)} disabled={!checks} className={GHOST_BTN}>Test again</Button>
              {bot ? (
                <Button onClick={() => setStep("who")} className={DIALOG_SAVE_BTN}>Continue</Button>
              ) : (
                <Button onClick={onClose} className={DIALOG_SAVE_BTN}>Done</Button>
              )}
            </>
          )}
          {step === "who" && (
            <Button onClick={() => saveActors.mutate()} disabled={saveActors.isPending} className={DIALOG_SAVE_BTN}>
              {saveActors.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ spec, value, onChange, configured }: { spec: ChannelFieldSpec; value: unknown; onChange: (v: unknown) => void; configured: boolean }): React.ReactElement {
  if (spec.kind === "boolean") {
    return (
      <div className="flex items-center justify-between">
        <Label className={LABEL_CLASS}>{spec.label}</Label>
        <Switch checked={Boolean(value)} onCheckedChange={onChange} aria-label={spec.label} />
      </div>
    );
  }
  if (spec.kind === "select") {
    return (
      <div className="space-y-1.5">
        <Label className={LABEL_CLASS}>{spec.label}</Label>
        <Select value={String(value || spec.options?.[0]?.value || "")} onValueChange={onChange}>
          <SelectTrigger aria-label={spec.label}><SelectValue /></SelectTrigger>
          <SelectContent>
            {(spec.options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {spec.hint && <p className="text-[11px] text-paper-faint">{spec.hint}</p>}
      </div>
    );
  }
  const placeholder = spec.secret && configured ? "•••••••• (unchanged)" : spec.placeholder;
  const text = value === undefined || value === null ? "" : String(value);
  return (
    <div className="space-y-1.5">
      <Label className={LABEL_CLASS} htmlFor={`channel-${spec.key}`}>
        {spec.label}
        {spec.required && <span className="text-brand"> *</span>}
      </Label>
      {spec.kind === "textarea" ? (
        <Textarea id={`channel-${spec.key}`} rows={4} className="font-mono text-[12px]" value={text} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      ) : (
        <Input id={`channel-${spec.key}`} type={spec.kind === "password" ? "password" : spec.kind === "number" ? "number" : "text"} value={text} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
      {spec.hint && <p className="text-[11px] text-paper-faint">{spec.hint}</p>}
    </div>
  );
}
