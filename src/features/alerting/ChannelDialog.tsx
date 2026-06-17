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
import { Loader2, Radio } from "lucide-react";

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
import {
  createChannel,
  updateChannel,
  ChannelType,
  CHANNEL_FIELD_SPECS,
  CHANNEL_TYPE_LABELS,
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
  for (const s of specs) cfg[s.key] = s.kind === "boolean" ? true : "";
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

  const specs = CHANNEL_FIELD_SPECS[type];

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
    setConfig(defaultConfigFor(CHANNEL_FIELD_SPECS[next]));
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const cleaned: Record<string, unknown> = {};
      for (const s of specs) {
        const v = config[s.key];
        if (s.secret && (v === "" || v === undefined || v === null)) continue;
        cleaned[s.key] = s.kind === "number" ? Number(v) || 0 : v;
      }
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

  const canSave = name.trim().length > 0 && !mutation.isPending;

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
                Slack · Google Chat · Email · Webhook
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
            <Select value={type} onValueChange={(v) => onTypeChange(v as ChannelType)} disabled={isEdit}>
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
            const secretConfigured = spec.secret && isEdit && channel?.configured[spec.key];
            return (
              <div key={spec.key} className="space-y-1.5">
                <Label className={LABEL_CLASS}>
                  {spec.label}
                  {spec.required && <span className="text-brand"> *</span>}
                </Label>
                <Input
                  type={spec.kind === "password" ? "password" : spec.kind === "number" ? "number" : "text"}
                  value={value === undefined || value === null ? "" : String(value)}
                  onChange={(e) => setConfig((c) => ({ ...c, [spec.key]: e.target.value }))}
                  placeholder={secretConfigured ? "•••••••• (unchanged)" : spec.placeholder}
                />
              </div>
            );
          })}

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
