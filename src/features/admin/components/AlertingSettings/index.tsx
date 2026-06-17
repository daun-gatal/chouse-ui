/**
 * Alerting settings — a single Admin → Settings section that stacks three
 * panels (notification channels, alert rules, recent alerts) over the normalized
 * alerting model, mirroring the SSO section's single-section / stacked-panel
 * layout.
 *
 * The channel editor renders its config fields dynamically from
 * CHANNEL_FIELD_SPECS, so each channel type (Slack / Google Chat / Email /
 * Webhook) gets the right form. Secrets are write-only: on edit a configured
 * secret shows a masked placeholder and is only sent when the user types a new
 * value.
 */

import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bell,
  Plus,
  Pencil,
  Trash2,
  Send,
  Loader2,
  ShieldAlert,
  Radio,
  SlidersHorizontal,
  Activity,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listChannels,
  deleteChannel,
  testChannel,
  listRules,
  deleteRule,
  listEvents,
  clearEvents,
  CHANNEL_TYPE_LABELS,
  ALERT_SOURCE_TYPE_LABELS,
  type NotificationChannel,
  type AlertRule,
} from "@/api/alerting";
import { ChannelDialog, ALERTING_KEYS } from "@/features/alerting/ChannelDialog";
import { RuleDialog } from "@/features/alerting/RuleDialog";

const PANEL_TITLE = "font-mono text-[11px] uppercase tracking-[0.14em] text-paper";
const ADD_BTN =
  "ml-auto h-8 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft";
const ROW = "flex items-center gap-3 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5";
const PAGE_SIZE = 10;

/** Client-side pager — only renders once a list exceeds one page. */
function Pager({ page, total, onPage }: { page: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between">
      <Button
        variant="ghost"
        size="sm"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        className="h-7 gap-1 px-2 font-mono text-[10px] uppercase tracking-[0.14em] disabled:opacity-40"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Prev
      </Button>
      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-paper-faint">
        Page {page + 1} of {pages}
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={page >= pages - 1}
        onClick={() => onPage(page + 1)}
        className="h-7 gap-1 px-2 font-mono text-[10px] uppercase tracking-[0.14em] disabled:opacity-40"
      >
        Next <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/** Keep the current page in range as a list shrinks (e.g. after a delete). */
function useClampedPage(total: number): [number, (p: number) => void] {
  const [page, setPage] = useState(0);
  React.useEffect(() => {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > pages - 1) setPage(pages - 1);
  }, [total, page]);
  return [page, setPage];
}

/**
 * Collapsible card-with-header-bar wrapper matching the SSO / Intelligence
 * panels. The title area toggles open/closed; the action button (Add / Clear)
 * stays clickable and only shows while expanded.
 */
function PanelCard({
  icon: Icon,
  title,
  action,
  children,
  defaultOpen = true,
}: {
  icon: LucideIcon;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [openState, setOpenState] = useState(defaultOpen);
  return (
    <section className="rounded-xs border border-ink-500 bg-ink-100">
      <div className={cn("flex items-center gap-2 px-4 py-3", openState && "border-b border-ink-500")}>
        <button
          type="button"
          onClick={() => setOpenState((o) => !o)}
          aria-expanded={openState}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 shrink-0 text-paper-dim transition-transform", !openState && "-rotate-90")}
            aria-hidden
          />
          <Icon className="h-3.5 w-3.5 shrink-0 text-paper-dim" aria-hidden />
          <h3 className={PANEL_TITLE}>{title}</h3>
        </button>
        {openState && action}
      </div>
      {openState && <div className="p-4">{children}</div>}
    </section>
  );
}
const CHANNELS_KEY = ALERTING_KEYS.channels;
const RULES_KEY = ALERTING_KEYS.rules;
const EVENTS_KEY = ALERTING_KEYS.events;

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

// ============================================
// Channels panel
// ============================================

function ChannelsPanel({ canEdit, canDelete }: { canEdit: boolean; canDelete: boolean }) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationChannel | null>(null);
  const [deleting, setDeleting] = useState<NotificationChannel | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const { data: channels, isLoading } = useQuery({
    queryKey: CHANNELS_KEY,
    queryFn: listChannels,
  });
  // A channel linked to any rule can't be deleted until it's detached.
  const { data: rules } = useQuery({ queryKey: RULES_KEY, queryFn: listRules });
  const usedChannelIds = useMemo(
    () => new Set((rules ?? []).flatMap((r) => r.channelIds)),
    [rules],
  );
  const total = channels?.length ?? 0;
  const [page, setPage] = useClampedPage(total);
  const pagedChannels = (channels ?? []).slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteChannel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CHANNELS_KEY });
      toast.success("Channel deleted");
      setDeleting(null);
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  const runTest = async (ch: NotificationChannel) => {
    setTestingId(ch.id);
    try {
      await testChannel(ch.id);
      toast.success(`Test message sent to ${ch.name}`);
    } catch (e) {
      toast.error(errMessage(e));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <PanelCard
      icon={Radio}
      title="Notification channels"
      action={
        canEdit && (
          <Button
            size="sm"
            className={ADD_BTN}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add channel
          </Button>
        )
      }
    >
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-paper-dim" />
        </div>
      ) : !channels || channels.length === 0 ? (
        <p className="py-6 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim">
          No channels yet
        </p>
      ) : (
        <div className="space-y-2">
          {pagedChannels.map((ch) => (
            <div key={ch.id} className={ROW}>
              <span
                className={cn(
                  "inline-flex items-center rounded-xs border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]",
                  ch.enabled
                    ? "border-ink-500 bg-ink-100 text-paper-muted"
                    : "border-ink-500 bg-ink-100 text-paper-faint",
                )}
              >
                {CHANNEL_TYPE_LABELS[ch.type]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-paper">{ch.name}</div>
                {!ch.enabled && (
                  <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint">
                    Disabled
                  </div>
                )}
              </div>
              {(canEdit || canDelete) && (
                <div className="flex items-center gap-1">
                  {canEdit && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Send test"
                        onClick={() => runTest(ch)}
                        disabled={testingId === ch.id}
                      >
                        {testingId === ch.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Edit"
                        onClick={() => {
                          setEditing(ch);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-400 hover:text-red-300 disabled:text-paper-faint"
                      title={usedChannelIds.has(ch.id) ? "In use by a rule — detach first" : "Delete"}
                      disabled={usedChannelIds.has(ch.id)}
                      onClick={() => setDeleting(ch)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <Pager page={page} total={total} onPage={setPage} />

      <ChannelDialog open={dialogOpen} channel={editing} onClose={() => setDialogOpen(false)} />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete channel?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.name}” will be removed and unlinked from any alert rules that use it. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
              className="bg-red-600 hover:bg-red-500"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PanelCard>
  );
}

// ============================================
// Rules panel
// ============================================

function RulesPanel({ canEdit, canDelete }: { canEdit: boolean; canDelete: boolean }) {
  const queryClient = useQueryClient();
  const { data: rules, isLoading } = useQuery({ queryKey: RULES_KEY, queryFn: listRules });
  const total = rules?.length ?? 0;
  const [page, setPage] = useClampedPage(total);
  const pagedRules = (rules ?? []).slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const [dialog, setDialog] = useState<{ open: boolean; rule: AlertRule | null }>({ open: false, rule: null });
  const [deleting, setDeleting] = useState<AlertRule | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: RULES_KEY });
      toast.success("Rule deleted");
      setDeleting(null);
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  return (
    <PanelCard
      icon={SlidersHorizontal}
      title="Alert rules"
      action={
        canEdit && (
          <Button size="sm" className={ADD_BTN} onClick={() => setDialog({ open: true, rule: null })}>
            <Plus className="h-3.5 w-3.5" />
            Add rule
          </Button>
        )
      }
    >
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-paper-dim" />
        </div>
      ) : !rules || rules.length === 0 ? (
        <p className="py-6 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim">
          No alert rules
        </p>
      ) : (
        <div className="space-y-2">
          {pagedRules.map((r) => (
            <div key={r.id} className={ROW}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-paper">{r.name}</div>
                <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint">
                  {ALERT_SOURCE_TYPE_LABELS[r.sourceType] ?? r.sourceType} · {r.severity} ·{" "}
                  {r.channelIds.length} channel{r.channelIds.length === 1 ? "" : "s"}
                  {r.aiRcaEnabled ? " · AI RCA" : ""}
                  {r.enabled ? "" : " · disabled"}
                </div>
              </div>
              {(canEdit || canDelete) && (
                <div className="flex items-center gap-1">
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Edit"
                      onClick={() => setDialog({ open: true, rule: r })}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-400 hover:text-red-300 disabled:text-paper-faint"
                      title={r.enabled ? "Enabled — disable first" : "Delete"}
                      disabled={r.enabled}
                      onClick={() => setDeleting(r)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <Pager page={page} total={total} onPage={setPage} />

      <RuleDialog open={dialog.open} rule={dialog.rule} onClose={() => setDialog({ open: false, rule: null })} />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete rule?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.name}” will stop evaluating and its channel links are removed. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
              className="bg-red-600 hover:bg-red-500"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PanelCard>
  );
}

// ============================================
// Events panel
// ============================================

const CLEAR_RANGES: { label: string; olderThanMs: number | null }[] = [
  { label: "Older than 24 hours", olderThanMs: 24 * 60 * 60 * 1000 },
  { label: "Older than 7 days", olderThanMs: 7 * 24 * 60 * 60 * 1000 },
  { label: "Older than 30 days", olderThanMs: 30 * 24 * 60 * 60 * 1000 },
  { label: "All recent alerts", olderThanMs: null },
];

function EventsPanel({ canDelete }: { canDelete: boolean }) {
  const queryClient = useQueryClient();
  const { data: events, isLoading } = useQuery({ queryKey: EVENTS_KEY, queryFn: () => listEvents(50) });
  const [confirming, setConfirming] = useState<(typeof CLEAR_RANGES)[number] | null>(null);

  const clearMutation = useMutation({
    mutationFn: (range: (typeof CLEAR_RANGES)[number]) =>
      clearEvents(range.olderThanMs === null ? undefined : Date.now() - range.olderThanMs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EVENTS_KEY });
      toast.success("Recent alerts cleared");
      setConfirming(null);
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  return (
    <PanelCard
      icon={Activity}
      title="Recent alerts"
      action={
        canDelete && events && events.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="ml-auto h-8 gap-2">
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {CLEAR_RANGES.map((r) => (
                <DropdownMenuItem key={r.label} onSelect={() => setConfirming(r)}>
                  {r.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-paper-dim" />
        </div>
      ) : !events || events.length === 0 ? (
        <p className="py-6 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim">
          No alerts recorded yet
        </p>
      ) : (
        <div className="space-y-2">
          {events.map((ev) => (
            <div key={ev.id} className="flex items-start gap-3 rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5">
              <ShieldAlert
                className={cn(
                  "mt-0.5 h-3.5 w-3.5 shrink-0",
                  ev.severity === "critical" ? "text-red-400" : "text-amber-400",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-paper">{ev.payload ?? "—"}</div>
                <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint">
                  {new Date(ev.firedAt).toLocaleString()}
                  {ev.deliveredTo.length > 0 ? ` · ${ev.deliveredTo.length} delivered` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear recent alerts?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.olderThanMs === null
                ? "All recorded alerts will be permanently removed."
                : `Alerts ${confirming?.label.toLowerCase()} will be permanently removed.`}{" "}
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirming && clearMutation.mutate(confirming)}
              className="bg-red-600 hover:bg-red-500"
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PanelCard>
  );
}

// ============================================
// Section root
// ============================================

const AlertingSettings: React.FC = () => {
  const { hasPermission } = useRbacStore();
  const canEdit = useMemo(() => hasPermission(RBAC_PERMISSIONS.ALERTING_EDIT), [hasPermission]);
  const canDelete = useMemo(() => hasPermission(RBAC_PERMISSIONS.ALERTING_DELETE), [hasPermission]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
          <Bell className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[18px] font-semibold tracking-tight text-paper">Alerting</h2>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
            Notification channels, alert rules & recent alerts
          </p>
        </div>
      </div>

      <ChannelsPanel canEdit={canEdit} canDelete={canDelete} />
      <RulesPanel canEdit={canEdit} canDelete={canDelete} />
      <EventsPanel canDelete={canDelete} />
    </div>
  );
};

export default AlertingSettings;
