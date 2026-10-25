/**
 * AI Governance › Assistant › Chobi › Alerts (ADR 0026 §6): send requests
 * that wait on a person to team channels. Who may approve from a channel is
 * set on the channel itself (Admin › Alerting), so it covers every feature's
 * buttons; here each channel only says whether its alerts carry Approve.
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";

import { updateChobiSettings, type ChobiAlerts, type ChobiSettings } from "@/api/chobi";
import { CHANNEL_TYPE_LABELS, isAppChannel, listChannels, type NotificationChannel } from "@/api/alerting";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ALERTING_KEYS } from "@/features/alerting/ChannelDialog";
import { chobiKeys } from "@/features/buddy/hooks";
import { errorMessage } from "./shared";

const EVENTS: Array<{ key: keyof ChobiAlerts["events"]; label: string; hint: string }> = [
  { key: "secondApprover", label: "Second-approver changes", hint: "High-risk (T3) changes waiting for a second person" },
  { key: "background", label: "Background approvals", hint: "Proposals from auto-triage and other runs with no person in the loop" },
  { key: "heldMcp", label: "Held MCP calls", hint: "MCP and CLI calls waiting for their own user to confirm" },
];

function same(a: ChobiAlerts, b: ChobiAlerts): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function ChobiAlertsSection({ settings, canManage }: { settings: ChobiSettings; canManage: boolean }): ReactElement {
  const client = useQueryClient();
  const [draft, setDraft] = useState<ChobiAlerts>(settings.alerts);
  const [adding, setAdding] = useState("");
  useEffect(() => setDraft(settings.alerts), [settings.alerts]);

  const channels = useQuery({ queryKey: ALERTING_KEYS.channels, queryFn: listChannels, enabled: canManage, retry: false });
  const byId = useMemo(() => new Map((channels.data ?? []).map((c) => [c.id, c])), [channels.data]);
  const addable = (channels.data ?? []).filter((c) => !draft.channels.some((t) => t.channelId === c.id));

  const save = useMutation({
    mutationFn: () => updateChobiSettings({ alerts: draft }),
    onSuccess: (saved) => {
      client.setQueryData(chobiKeys.settings(), saved);
      toast.success("Need You alerts saved");
    },
    onError: (error) => toast.error(errorMessage(error, "Could not save the alerts")),
  });

  const disabled = !canManage || save.isPending;
  const dirty = !same(draft, settings.alerts);
  const delayInvalid = !Number.isInteger(draft.delayMinutes) || draft.delayMinutes < 0 || draft.delayMinutes > 1440;
  const noEvent = draft.enabled && !Object.values(draft.events).some(Boolean);
  const noChannel = draft.enabled && draft.channels.length === 0;

  return (
    <div className="space-y-4" data-testid="chobi-alerts">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-paper">Need You alerts</p>
          <p className="mt-0.5 max-w-xl text-[12px] text-paper-faint">Send requests that wait for an answer to team channels, with a link to review them and, where the channel allows, Approve and Decline.</p>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-paper-muted">
          On
          <Switch checked={draft.enabled} disabled={disabled} onCheckedChange={(value) => setDraft((d) => ({ ...d, enabled: value }))} aria-label="Need You alerts" />
        </label>
      </div>

      {!settings.publicBaseUrl && (
        <div role="alert" className="flex items-start gap-2 rounded-xs border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>PUBLIC_BASE_URL is not set on the server, so alerts cannot link back to CHouse and are not sent.</span>
        </div>
      )}

      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Send for</legend>
        {EVENTS.map((event) => (
          <label key={event.key} className="flex items-start gap-2 text-[12px] text-paper">
            <Checkbox
              checked={draft.events[event.key]}
              onCheckedChange={(value) => setDraft((d) => ({ ...d, events: { ...d.events, [event.key]: value === true } }))}
              aria-label={event.label}
            />
            <span>
              {event.label}
              <span className="block text-[11px] text-paper-faint">{event.hint}</span>
            </span>
          </label>
        ))}
        {noEvent && <p className="text-[11px] text-amber-400">Pick at least one, or turn alerts off.</p>}
      </fieldset>

      <div className="flex items-center gap-2 text-[12px] text-paper">
        <span>Send if still waiting after</span>
        <Input
          type="number"
          min={0}
          max={1440}
          className="h-8 w-20"
          value={String(draft.delayMinutes)}
          disabled={disabled}
          aria-label="Delay in minutes"
          onChange={(e) => setDraft((d) => ({ ...d, delayMinutes: e.target.value === "" ? 0 : Number(e.target.value) }))}
        />
        <span>minutes</span>
        {delayInvalid && <span className="text-[11px] text-red-300">0 to 1440</span>}
      </div>

      <div className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Channels</p>
        {channels.isError && <p className="text-[12px] text-paper-faint">Picking channels needs alerting:view.</p>}
        {draft.channels.length === 0 && !channels.isError && <p className="text-[12px] text-paper-faint">No channels yet.</p>}
        <ul className="divide-y divide-ink-500 rounded-xs border border-ink-500">
          {draft.channels.map((target) => {
            const channel = byId.get(target.channelId);
            return (
              <ChannelRow
                key={target.channelId}
                channel={channel}
                approveFromChat={target.approveFromChat}
                disabled={disabled}
                onApprove={(value) => setDraft((d) => ({ ...d, channels: d.channels.map((t) => (t.channelId === target.channelId ? { ...t, approveFromChat: value } : t)) }))}
                onRemove={() => setDraft((d) => ({ ...d, channels: d.channels.filter((t) => t.channelId !== target.channelId) }))}
              />
            );
          })}
        </ul>
        {noChannel && <p className="text-[11px] text-amber-400">Add a channel, or turn alerts off.</p>}
        {canManage && addable.length > 0 && draft.channels.length < 10 && (
          <div className="flex items-center gap-2">
            <Select value={adding} onValueChange={setAdding}>
              <SelectTrigger className="h-8 w-64" aria-label="Channel to add">
                <SelectValue placeholder="Pick a channel" />
              </SelectTrigger>
              <SelectContent>
                {addable.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {CHANNEL_TYPE_LABELS[c.type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              disabled={!adding || disabled}
              onClick={() => {
                const channel = byId.get(adding);
                setDraft((d) => ({ ...d, channels: [...d.channels, { channelId: adding, approveFromChat: channel ? isAppChannel(channel) : false }] }));
                setAdding("");
              }}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> Add channel
            </Button>
          </div>
        )}
        <p className="text-[11px] text-paper-faint">Who can approve from a channel is set on the channel, in Admin › Alerting.</p>
      </div>

      {canManage && (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={!dirty || save.isPending} onClick={() => setDraft(settings.alerts)}>Discard</Button>
          <Button size="sm" disabled={!dirty || save.isPending || delayInvalid || noEvent || noChannel} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />} Save alerts
          </Button>
        </div>
      )}
    </div>
  );
}

function ChannelRow({ channel, approveFromChat, disabled, onApprove, onRemove }: { channel: NotificationChannel | undefined; approveFromChat: boolean; disabled: boolean; onApprove: (value: boolean) => void; onRemove: () => void }): ReactElement {
  const bot = channel ? isAppChannel(channel) : false;
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-[13px] text-paper">{channel?.name ?? "Deleted channel"}</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper-faint">
          {channel ? `${CHANNEL_TYPE_LABELS[channel.type]} · ${bot ? "app" : "webhook"}${channel.enabled ? "" : " · off"}` : "Remove it"}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {bot ? (
          <label className="flex items-center gap-2 text-[12px] text-paper-muted">
            <Checkbox checked={approveFromChat} disabled={disabled} onCheckedChange={(value) => onApprove(value === true)} aria-label={`Approve from chat in ${channel?.name ?? "channel"}`} />
            Approve from chat
          </label>
        ) : (
          <span className="text-[11px] text-paper-faint">Review link only</span>
        )}
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={disabled} onClick={onRemove} aria-label={`Remove ${channel?.name ?? "channel"}`}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </li>
  );
}
