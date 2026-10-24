import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronRight, CircleAlert, Info, MessageCircleQuestion, RefreshCw, Sparkles, WifiOff } from "lucide-react";

import type { Briefing, BriefingItem, ConnectionBriefing } from "@/api/chobi";
import { dataPaths } from "@/features/observe/paths";
import { formatAgo } from "@/features/observe/lib";
import { log } from "@/lib/log";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores";
import { askContext, useChobiStore } from "@/stores/chobi";
import { useRefreshBriefing } from "./hooks";

interface NowTabProps {
  briefing: Briefing | undefined;
  loading: boolean;
  error: boolean;
  /** Approvals open in the Activity tab. */
  onOpenActivity: () => void;
  /** After following a link: a panel that covers the page steps aside. */
  onNavigated: () => void;
}

const SEVERITY_ICON = { bad: CircleAlert, warn: AlertTriangle, info: Info } as const;
const SEVERITY_TONE = { bad: "text-red-400", warn: "text-amber-400", info: "text-paper-faint" } as const;
const SEVERITY_LABEL = { bad: "Problem", warn: "Warning", info: "Note" } as const;

/** Where an item leads; null when it opens something inside Chobi. */
export function itemPath(item: BriefingItem): string | null {
  const ref = item.ref;
  if (ref?.type === "incident") return dataPaths.incident(ref.source === "observe" ? "observe" : "data_health", ref.id);
  if (ref?.type === "job") return dataPaths.job(ref.id);
  if (ref?.type === "promise") return dataPaths.promises();
  if (item.kind === "connection") return "/fleet";
  return null;
}

/** Ask Chobi to look into an item, with the item attached so it starts from the facts. */
export function askAbout(item: BriefingItem, connectionName: string | null): void {
  const where = connectionName ? ` on ${connectionName}` : "";
  useChobiStore.getState().askChobi(`Look into this${where}: ${item.title}. What happened, why, and what should I do?`, {
    context: askContext(`${item.kind}.json`, JSON.stringify({ ...item, connection: connectionName }, null, 2)),
    send: true,
  });
}

/** Your connections first-hand: the active one first, then those that need a look, then the quiet ones. */
export function orderConnections(connections: ConnectionBriefing[], activeId: string | null): ConnectionBriefing[] {
  const weight = (c: ConnectionBriefing): number => (c.id === activeId ? 0 : c.status === "unreachable" ? 1 : c.status === "attention" ? 2 : 3);
  return [...connections].sort((a, b) => weight(a) - weight(b) || a.name.localeCompare(b.name));
}

/**
 * The Now tab (ADR 0025 §6): what needs a look across every connection you
 * can reach, built from data with no model call.
 */
export function NowTab({ briefing, loading, error, onOpenActivity, onNavigated }: NowTabProps): React.JSX.Element {
  const navigate = useNavigate();
  const activeConnectionId = useAuthStore((s) => s.activeConnectionId);
  const refresh = useRefreshBriefing();
  const [refreshing, setRefreshing] = useState(false);
  const [showQuiet, setShowQuiet] = useState(false);

  const open = (item: BriefingItem): void => {
    if (item.kind === "approval") {
      onOpenActivity();
      return;
    }
    const path = itemPath(item);
    if (!path) return;
    if (item.connectionId && item.connectionId !== activeConnectionId) {
      const name = briefing?.connections.find((c) => c.id === item.connectionId)?.name ?? null;
      useAuthStore.getState().setActiveConnection(item.connectionId, name);
      toast.success(`Switched to connection: ${name ?? "target connection"}`);
    }
    navigate(path);
    onNavigated();
  };

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await refresh();
    } catch (err) {
      log.error("[Chobi] Briefing refresh failed", err);
      toast.error("Could not refresh the briefing");
    } finally {
      setRefreshing(false);
    }
  };

  if (loading && !briefing) return <p className="p-4 text-[12px] text-paper-faint">Looking around…</p>;
  if (error && !briefing) return <p className="p-4 text-[12px] text-red-400">The briefing could not be loaded.</p>;
  if (!briefing) return <p className="p-4 text-[12px] text-paper-faint">Nothing to show yet.</p>;

  const ordered = orderConnections(briefing.connections, activeConnectionId);
  const busy = ordered.filter((c) => c.status !== "ok" || c.id === activeConnectionId);
  const quiet = ordered.filter((c) => c.status === "ok" && c.id !== activeConnectionId);
  const allClear = briefing.general.length === 0 && busy.every((c) => c.items.length === 0);

  return (
    <div className="flex h-full flex-col overflow-y-auto" data-testid="chobi-now">
      <div className="flex items-center justify-between px-3 pt-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">Updated {formatAgo(briefing.generatedAt)}</p>
        <button type="button" onClick={() => void onRefresh()} disabled={refreshing} className="grid h-6 w-6 place-items-center rounded-xs text-paper-dim hover:bg-ink-300 hover:text-paper disabled:opacity-50" aria-label="Refresh the briefing" title="Refresh">
          <RefreshCw className={cn("h-3 w-3", refreshing && "motion-safe:animate-spin")} />
        </button>
      </div>

      {allClear && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-sm border border-emerald-900/50 bg-emerald-950/20 px-3 py-2.5 text-[12px] text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> All clear — nothing needs a look right now.
        </div>
      )}

      {briefing.general.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5 px-3">
          {briefing.general.map((item) => <Item key={item.key} item={item} onOpen={open} onAsk={null} />)}
        </ul>
      )}

      {briefing.ai.changedToday > 0 && (
        <button type="button" onClick={onOpenActivity} className="mx-3 mt-2 flex items-center gap-2 rounded-sm px-1.5 py-1 text-left text-[11px] text-paper-muted hover:bg-ink-200/60 hover:text-paper">
          <Sparkles className="h-3 w-3 text-brand" />
          AI changed {briefing.ai.changedToday} {briefing.ai.changedToday === 1 ? "thing" : "things"} for you today
          {briefing.ai.undoable > 0 ? ` · ${briefing.ai.undoable} can be undone` : ""}
          <ChevronRight className="ml-auto h-3 w-3" />
        </button>
      )}

      {busy.map((connection) => (
        <section key={connection.id} className="mt-3 border-t border-ink-500 px-3 pt-3" aria-label={connection.name}>
          <h3 className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold text-paper">
            {connection.status === "unreachable" && <WifiOff className="h-3 w-3 text-red-400" aria-label="Unreachable" />}
            <span className="truncate">{connection.name}</span>
            {connection.production && <span className="rounded-xs border border-red-900/60 px-1 font-mono text-[9px] uppercase tracking-[0.12em] text-red-300">Prod</span>}
            {connection.id === activeConnectionId && <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-paper-faint">active</span>}
          </h3>
          {connection.items.length === 0 ? (
            <p className="px-1 pb-1 text-[11px] text-paper-faint">Nothing needs a look.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {connection.items.map((item) => <Item key={item.key} item={item} onOpen={open} onAsk={item.kind === "watch" ? null : () => askAbout(item, connection.name)} />)}
            </ul>
          )}
        </section>
      ))}

      {quiet.length > 0 && (
        <div className="mt-3 border-t border-ink-500 px-3 py-3">
          <button type="button" onClick={() => setShowQuiet((v) => !v)} className="flex w-full items-center gap-2 text-left text-[11px] text-paper-faint hover:text-paper-muted" aria-expanded={showQuiet}>
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
            {quiet.length} quiet {quiet.length === 1 ? "connection" : "connections"}
            <ChevronRight className={cn("ml-auto h-3 w-3 transition-transform", showQuiet && "rotate-90")} />
          </button>
          {showQuiet && <p className="mt-1.5 pl-5 text-[11px] text-paper-muted">{quiet.map((c) => c.name).join(" · ")}</p>}
        </div>
      )}

      {briefing.unavailable.length > 0 && (
        <p className="mt-auto px-3 py-3 text-[10px] text-paper-faint">Not included: {briefing.unavailable.join(", ")}.</p>
      )}
    </div>
  );
}

function Item({ item, onOpen, onAsk }: { item: BriefingItem; onOpen: (item: BriefingItem) => void; onAsk: (() => void) | null }): React.JSX.Element {
  const Icon = SEVERITY_ICON[item.severity];
  const actionable = item.kind === "approval" || itemPath(item) !== null;
  return (
    <li className="group/item relative">
      <button
        type="button"
        disabled={!actionable}
        onClick={() => onOpen(item)}
        className="group flex w-full items-start gap-2 rounded-sm px-1.5 py-1.5 text-left hover:bg-ink-200/60 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", SEVERITY_TONE[item.severity])} aria-hidden />
        <span className="sr-only">{SEVERITY_LABEL[item.severity]}: </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] text-paper">{item.title}</span>
          {item.detail && <span className="mt-0.5 line-clamp-2 block text-[11px] text-paper-muted">{item.detail}</span>}
        </span>
        {item.at && (
          <span className="shrink-0 font-mono text-[10px] text-paper-faint">
            {item.kind === "watch" ? `until ${new Date(item.at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : formatAgo(item.at)}
          </span>
        )}
      </button>
      {onAsk && (
        <button
          type="button"
          onClick={onAsk}
          className="absolute right-1 top-1 hidden h-6 items-center gap-1 rounded-xs border border-ink-500 bg-ink-100 px-1.5 text-[10px] text-paper-muted hover:border-brand hover:text-brand focus-visible:flex group-hover/item:flex"
          aria-label={`Ask Chobi about ${item.title}`}
        >
          <MessageCircleQuestion className="h-3 w-3" /> Ask
        </button>
      )}
    </li>
  );
}
