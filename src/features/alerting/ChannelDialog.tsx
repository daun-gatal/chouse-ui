/**
 * ChannelDialog — shared create/edit dialog for a notification channel, with a
 * dynamic per-type config form (driven by CHANNEL_FIELD_SPECS). Used by both the
 * Admin → Alerting section and the Fleet "Alert delivery" dialog so the two
 * surfaces edit channels identically. Secrets are write-only: a configured
 * secret shows a masked placeholder and is only sent when a new value is typed.
 */

import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Radio, AlertTriangle } from "lucide-react";

import { log } from "@/lib/log";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import {
  createChannel,
  updateChannel,
  ChannelType,
  CHANNEL_FIELD_SPECS,
  CHANNEL_TYPE_LABELS,
  visibleFieldSpecs,
  type NotificationChannel,
  type ChannelInput,
  type ChannelFieldSpec,
} from "@/api/alerting";

/** Shared React Query keys so every alerting surface dedupes + cross-refreshes. */
export const ALERTING_KEYS = {
  channels: ["alerting", "channels"] as const,
  rules: ["alerting", "rules"] as const,
  events: ["alerting", "events"] as const,
};

const LABEL_CLASS = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim";
/** Themed primary action button for the alerting dialogs (matches the SSO wizard). */
export const DIALOG_SAVE_BTN =
  "h-9 gap-2 rounded-xs bg-brand px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

function defaultConfigFor(specs: ChannelFieldSpec[]): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  for (const s of specs) cfg[s.key] = s.kind === "boolean" ? true : s.kind === "select" ? s.options?.[0]?.value ?? "" : "";
  return cfg;
}

interface ChannelDialogProps {
  open: boolean;
  channel: NotificationChannel | null; // null = create
  onClose: () => void;
}

export function ChannelDialog({ open, channel, onClose }: ChannelDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = channel !== null;

  const [name, setName] = useState("");
  const [type, setType] = useState<ChannelType>(ChannelType.Slack);
  const [enabled, setEnabled] = useState(true);
  const [config, setConfig] = useState<Record<string, unknown>>({});

  const specs = visibleFieldSpecs(type, config);

  useEffect(() => {
    if (!open) return;
    if (channel) {
      setName(channel.name);
      setType(channel.type);
      setEnabled(channel.enabled);
      setConfig({ ...defaultConfigFor(CHANNEL_FIELD_SPECS[channel.type]), ...channel.config });
    } else {
      setName("");
      setType(ChannelType.Slack);
      setEnabled(true);
      setConfig(defaultConfigFor(CHANNEL_FIELD_SPECS[ChannelType.Slack]));
    }
  }, [open, channel]);

  const onTypeChange = (next: ChannelType) => {
    setType(next);
    // Preserve values for keys shared between the old and new type — most
    // importantly `webhookUrl`, shared by Slack & Google Chat. This lets an
    // operator fix a mis-typed channel (e.g. a Google Chat webhook saved as
    // Slack) by just flipping the type, without re-pasting the URL.
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

  // Guard against the silent-failure trap: a webhook URL whose domain clearly
  // belongs to a DIFFERENT provider than the selected type. Sending Slack
  // Block Kit to a Google Chat webhook (or vice versa) is rejected at delivery
  // time but the bare-text "Send test" used to pass — so we block it up front.
  const webhookUrl = typeof config.webhookUrl === "string" ? config.webhookUrl : "";
  const urlTypeMismatch =
    type === ChannelType.Slack && /chat\.googleapis\.com/i.test(webhookUrl)
      ? "This looks like a Google Chat webhook URL, but the channel type is Slack. Switch the type to Google Chat — otherwise alerts go out in Slack format and Google Chat rejects them."
      : type === ChannelType.GoogleChat && /hooks\.slack\.com/i.test(webhookUrl)
        ? "This looks like a Slack webhook URL, but the channel type is Google Chat. Switch the type to Slack."
        : null;

  const mutation = useMutation({
    mutationFn: async () => {
      const cleaned: Record<string, unknown> = {};
      for (const s of specs) {
        const v = config[s.key];
        if (s.secret && (v === "" || v === undefined || v === null)) continue;
        if (s.kind === "number" && !s.required && (v === "" || v === undefined || v === null)) continue;
        cleaned[s.key] = s.kind === "number" ? Number(v) || 0 : v;
      }
      if (config.actors !== undefined) cleaned.actors = config.actors;
      const input: ChannelInput = { name: name.trim(), type, enabled, config: cleaned };
      if (isEdit && channel) await updateChannel(channel.id, input);
      else await createChannel(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALERTING_KEYS.channels });
      toast.success(isEdit ? "Channel updated" : "Channel created");
      onClose();
    },
    onError: (e) => {
      log.error("Failed to save channel", e);
      toast.error(errMessage(e));
    },
  });

  const canSave = name.trim().length > 0 && !mutation.isPending && !urlTypeMismatch;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto rounded-xs border-ink-500 bg-ink-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-paper">
            <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
              <Radio className="h-4 w-4" aria-hidden />
            </span>
            <span className="flex flex-col gap-0.5 text-left">
              <span className="text-[16px] font-semibold tracking-tight">
                {isEdit ? "Edit channel" : "New notification channel"}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                Slack · Google Chat · Telegram · Email · Webhook
              </span>
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className={LABEL_CLASS}>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. On-call Slack" />
          </div>

          <div className="space-y-1.5">
            <Label className={LABEL_CLASS}>Type</Label>
            <Select value={type} onValueChange={(v) => onTypeChange(v as ChannelType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(ChannelType).map((t) => (
                  <SelectItem key={t} value={t}>
                    {CHANNEL_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {specs.map((spec) => {
            const value = config[spec.key];
            if (spec.kind === "boolean") {
              return (
                <div key={spec.key} className="flex items-center justify-between">
                  <Label className={LABEL_CLASS}>{spec.label}</Label>
                  <Switch
                    checked={Boolean(value)}
                    onCheckedChange={(v) => setConfig((c) => ({ ...c, [spec.key]: v }))}
                  />
                </div>
              );
            }
            if (spec.kind === "select") {
              return (
                <div key={spec.key} className="space-y-1.5">
                  <Label className={LABEL_CLASS}>{spec.label}</Label>
                  <Select value={String(value || spec.options?.[0]?.value || "")} onValueChange={(v) => setConfig((c) => ({ ...c, [spec.key]: v }))}>
                    <SelectTrigger aria-label={spec.label}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(spec.options ?? []).map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {spec.hint && <p className="text-[11px] text-paper-faint">{spec.hint}</p>}
                </div>
              );
            }
            // A secret only counts as kept while the channel keeps its mode: the server drops the other mode's secrets.
            const sameMode = (channel?.config.mode ?? "webhook") === (config.mode ?? "webhook");
            const secretConfigured = spec.secret && isEdit && channel?.type === type && sameMode && channel?.configured[spec.key];
            const placeholder = secretConfigured ? "•••••••• (unchanged)" : spec.placeholder;
            const text = value === undefined || value === null ? "" : String(value);
            return (
              <div key={spec.key} className="space-y-1.5">
                <Label className={LABEL_CLASS} htmlFor={`channel-${spec.key}`}>
                  {spec.label}
                  {spec.required && <span className="text-brand"> *</span>}
                </Label>
                {spec.kind === "textarea" ? (
                  <Textarea
                    id={`channel-${spec.key}`}
                    rows={4}
                    className="font-mono text-[12px]"
                    value={text}
                    onChange={(e) => setConfig((c) => ({ ...c, [spec.key]: e.target.value }))}
                    placeholder={placeholder}
                  />
                ) : (
                  <Input
                    id={`channel-${spec.key}`}
                    type={spec.kind === "password" ? "password" : spec.kind === "number" ? "number" : "text"}
                    value={text}
                    onChange={(e) => setConfig((c) => ({ ...c, [spec.key]: e.target.value }))}
                    placeholder={placeholder}
                  />
                )}
                {spec.hint && <p className="text-[11px] text-paper-faint">{spec.hint}</p>}
              </div>
            );
          })}

          {urlTypeMismatch && (
            <div className="flex items-start gap-2 rounded-xs border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{urlTypeMismatch}</span>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-ink-500 pt-3">
            <Label className={LABEL_CLASS}>Enabled</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
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
