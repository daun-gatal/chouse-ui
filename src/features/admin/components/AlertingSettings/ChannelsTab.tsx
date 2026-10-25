/**
 * Channels (ADR 0026 §7): every notification channel with its delivery
 * health, what sends to it and who can act from it; search, filters and pages
 * in the URL. Deleting warns with what still uses the channel; fleet rules,
 * panel alerts and reports still block the delete, as before.
 */

import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Send, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CHANNEL_TYPE_LABELS,
  ChannelType,
  deleteChannel,
  isAppChannel,
  listChannels,
  testChannel,
  usageTotal,
  USAGE_LABELS,
  type ChannelUsage,
  type NotificationChannel,
} from "@/api/alerting";
import { ALERTING_KEYS, ChannelDialog } from "@/features/alerting/ChannelDialog";
import { actorsOf, actorsSummary } from "@/features/alerting/actors";
import { ClearFilters, BADGE, clampPage, EmptyFiltered, errMessage, FilterSelect, META, PAGE_SIZE, Pager, Panel, ROW, SearchBox, useUrlFilters, ADD_BTN } from "./shared";

const KEYS = ["q", "platform", "mode", "health", "used"] as const;
const HEALTH = ["ok", "failing", "never"] as const;

type Health = (typeof HEALTH)[number];

/** Failing: its latest delivery failed. Never: nothing was ever sent. */
export function healthOf(ch: NotificationChannel): Health {
  const h = ch.health;
  if (!h || (h.lastSentAt === null && h.lastFailedAt === null)) return "never";
  if ((h.lastFailedAt ?? 0) > (h.lastSentAt ?? 0)) return "failing";
  return "ok";
}

function usageLine(usage: ChannelUsage | undefined): string {
  if (!usage || usageTotal(usage) === 0) return "Not used by anything";
  return `Used by: ${(Object.keys(USAGE_LABELS) as Array<keyof ChannelUsage>).filter((k) => usage[k] > 0).map((k) => `${USAGE_LABELS[k]}${usage[k] > 1 ? ` (${usage[k]})` : ""}`).join(" · ")}`;
}

/** Where a channel delivers, for search (no secrets are ever in the list). */
function target(ch: NotificationChannel): string {
  const c = ch.config;
  return [c.channelId, c.space, c.chatId, c.to, c.url, c.botUsername].filter((v) => typeof v === "string").join(" ");
}

function when(ms: number | null): string {
  if (!ms) return "";
  const minutes = Math.round((Date.now() - ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h ago`;
  return new Date(ms).toLocaleDateString();
}

export function ChannelsTab({ canEdit, canDelete }: { canEdit: boolean; canDelete: boolean }): React.ReactElement {
  const queryClient = useQueryClient();
  const filters = useUrlFilters(KEYS, { platform: Object.values(ChannelType), mode: ["webhook", "app"], health: HEALTH, used: ["used", "unused"] });
  const { values } = filters;
  const [dialog, setDialog] = useState<{ open: boolean; channel: NotificationChannel | null }>({ open: false, channel: null });
  const [deleting, setDeleting] = useState<NotificationChannel | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const channels = useQuery({ queryKey: ALERTING_KEYS.channels, queryFn: listChannels });

  const filtered = useMemo(() => {
    const q = values.q.trim().toLowerCase();
    return (channels.data ?? []).filter((ch) => {
      if (q && !`${ch.name} ${target(ch)}`.toLowerCase().includes(q)) return false;
      if (values.platform && ch.type !== values.platform) return false;
      if (values.mode && (isAppChannel(ch) ? "app" : "webhook") !== values.mode) return false;
      if (values.health && healthOf(ch) !== values.health) return false;
      if (values.used && (usageTotal(ch.usedBy) > 0 ? "used" : "unused") !== values.used) return false;
      return true;
    });
  }, [channels.data, values]);
  const page = clampPage(filters.page, filtered.length);
  const shown = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const remove = useMutation({
    mutationFn: (id: string) => deleteChannel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALERTING_KEYS.channels });
      toast.success("Channel deleted");
      setDeleting(null);
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  const runTest = async (ch: NotificationChannel): Promise<void> => {
    setTestingId(ch.id);
    try {
      const result = await testChannel(ch.id);
      const warnings = (result?.checks ?? []).filter((c) => !c.ok).map((c) => c.label);
      toast.success(`Test message sent to ${ch.name}`, warnings.length ? { description: warnings.join(" · ") } : undefined);
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setTestingId(null);
      queryClient.invalidateQueries({ queryKey: ALERTING_KEYS.channels });
    }
  };

  return (
    <Panel
      title={`Channels${channels.data ? ` · ${channels.data.length}` : ""}`}
      action={canEdit && (
        <Button size="sm" className={ADD_BTN} onClick={() => setDialog({ open: true, channel: null })}>
          <Plus className="h-3.5 w-3.5" /> Add channel
        </Button>
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchBox value={values.q} onChange={(v) => filters.set("q", v)} placeholder="Search name or target" />
        <FilterSelect label="Platform" value={values.platform} onChange={(v) => filters.set("platform", v)} options={Object.values(ChannelType).map((t) => ({ value: t, label: CHANNEL_TYPE_LABELS[t] }))} />
        <FilterSelect label="Mode" value={values.mode} onChange={(v) => filters.set("mode", v)} options={[{ value: "webhook", label: "Webhook" }, { value: "app", label: "App" }]} />
        <FilterSelect label="Health" value={values.health} onChange={(v) => filters.set("health", v)} options={[{ value: "ok", label: "OK" }, { value: "failing", label: "Failing" }, { value: "never", label: "Never sent" }]} />
        <FilterSelect label="Use" value={values.used} onChange={(v) => filters.set("used", v)} options={[{ value: "used", label: "In use" }, { value: "unused", label: "Not used" }]} />
        <ClearFilters active={filters.active} onClear={filters.clear} />
      </div>

      {channels.isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-paper-dim" /></div>
      ) : channels.isError ? (
        <p role="alert" className="text-[12px] text-red-300">{errMessage(channels.error)}</p>
      ) : filtered.length === 0 ? (
        <EmptyFiltered message={filters.active ? "No channels match these filters" : "No channels yet"} />
      ) : (
        <ul className="space-y-2">
          {shown.map((ch) => {
            const health = healthOf(ch);
            const app = isAppChannel(ch);
            return (
              <li key={ch.id} className={ROW} data-testid="channel-row">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn(BADGE, "border-ink-500 bg-ink-100", ch.enabled ? "text-paper-muted" : "text-paper-faint")}>{CHANNEL_TYPE_LABELS[ch.type]}</span>
                    <span className="min-w-0 max-w-full truncate text-[13px] text-paper">{ch.name}</span>
                    {(ch.type === ChannelType.Slack || ch.type === ChannelType.GoogleChat) && <span className={cn(BADGE, "border-ink-500 text-paper-faint")}>{app ? "App" : "Webhook"}</span>}
                    {!ch.enabled && <span className={cn(BADGE, "border-ink-500 text-paper-faint")}>Off</span>}
                    {health === "failing" && <span className={cn(BADGE, "border-red-900/60 text-red-300")}>{ch.health?.failed24h ?? 0} failed · 24h</span>}
                    {health === "ok" && <span className={cn(BADGE, "border-emerald-900/60 text-emerald-400")}>Last sent {when(ch.health?.lastSentAt ?? null)}</span>}
                    {ch.type === ChannelType.Telegram && ch.config.webhookRegistered !== true && <span className={cn(BADGE, "border-amber-900/60 text-amber-400")}>Buttons off</span>}
                  </div>
                  <div className={META}>{usageLine(ch.usedBy)}{app ? ` · ${actorsSummary(actorsOf(ch.config))}` : ""}</div>
                  {health === "failing" && ch.health?.lastError && <div className="truncate text-[11px] text-red-300" title={ch.health.lastError}>{ch.health.lastError}</div>}
                </div>
                {(canEdit || canDelete) && (
                  <div className="flex items-center gap-1">
                    {canEdit && (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Send test" aria-label={`Send a test to ${ch.name}`} onClick={() => void runTest(ch)} disabled={testingId === ch.id}>
                          {testingId === ch.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" aria-label={`Edit ${ch.name}`} onClick={() => setDialog({ open: true, channel: ch })}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    {canDelete && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-300" title="Delete" aria-label={`Delete ${ch.name}`} onClick={() => setDeleting(ch)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Pager page={page} total={filtered.length} onPage={filters.setPage} />

      <ChannelDialog open={dialog.open} channel={dialog.channel} onClose={() => setDialog({ open: false, channel: null })} />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete channel?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.name}” will be removed. {deleting && usageTotal(deleting.usedBy) > 0 ? `${usageLine(deleting.usedBy)}; those stop sending here. ` : ""}This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && remove.mutate(deleting.id)} className="bg-red-600 hover:bg-red-500">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
