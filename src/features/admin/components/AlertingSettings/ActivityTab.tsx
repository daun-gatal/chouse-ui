/**
 * Activity (ADR 0026 §7): what fired, where it went and whether it got there.
 * Search and filters run on the server (history can be large) and pages load
 * with a cursor. Clearing history works as before.
 */

import React, { useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Loader2, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import { clearEvents, EVENT_SOURCE_LABELS, listChannels, searchEvents } from "@/api/alerting";
import { ALERTING_KEYS } from "@/features/alerting/ChannelDialog";
import { eventSummary } from "@/lib/alertEvents";
import { ClearFilters, BADGE, EmptyFiltered, errMessage, FilterSelect, META, Panel, ROW, SearchBox, useUrlFilters } from "./shared";

const KEYS = ["q", "source", "channel", "severity", "result", "range"] as const;
const RANGES: Record<string, { label: string; ms: number }> = {
  "1h": { label: "Last hour", ms: 60 * 60_000 },
  "24h": { label: "Last 24 hours", ms: 24 * 60 * 60_000 },
  "7d": { label: "Last 7 days", ms: 7 * 24 * 60 * 60_000 },
  "30d": { label: "Last 30 days", ms: 30 * 24 * 60 * 60_000 },
};
const PAGE = 50;

const CLEAR_RANGES: { label: string; olderThanMs: number | null }[] = [
  { label: "Older than 24 hours", olderThanMs: 24 * 60 * 60 * 1000 },
  { label: "Older than 7 days", olderThanMs: 7 * 24 * 60 * 60 * 1000 },
  { label: "Older than 30 days", olderThanMs: 30 * 24 * 60 * 60 * 1000 },
  { label: "All recent alerts", olderThanMs: null },
];

export function ActivityTab({ canDelete }: { canDelete: boolean }): React.ReactElement {
  const queryClient = useQueryClient();
  const filters = useUrlFilters(KEYS, { source: Object.keys(EVENT_SOURCE_LABELS), severity: ["info", "warning", "critical"], result: ["sent", "failed"], range: Object.keys(RANGES) });
  const { values } = filters;
  const [confirming, setConfirming] = useState<{ label: string; olderThanMs: number | null } | null>(null);
  const channels = useQuery({ queryKey: ALERTING_KEYS.channels, queryFn: listChannels });

  // The time range is anchored when the filters change, so later pages stay in the same window.
  const from = useMemo(() => (values.range ? Date.now() - RANGES[values.range].ms : undefined), [values.range]);
  const events = useInfiniteQuery({
    queryKey: [...ALERTING_KEYS.events, "search", values, from],
    queryFn: ({ pageParam }) => searchEvents({
      q: values.q,
      source: values.source,
      channelId: values.channel,
      severity: values.severity,
      failed: values.result === "" ? undefined : values.result === "failed",
      from,
      cursor: pageParam,
      limit: PAGE,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const rows = events.data?.pages.flatMap((p) => p.events) ?? [];

  const clear = useMutation({
    mutationFn: (olderThanMs: number | null) => clearEvents(olderThanMs === null ? undefined : Date.now() - olderThanMs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ALERTING_KEYS.events });
      toast.success("Recent alerts cleared");
      setConfirming(null);
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  return (
    <Panel
      title="Activity"
      action={canDelete && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-2">Clear <ChevronDown className="h-3.5 w-3.5" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {CLEAR_RANGES.map((r) => (
              <DropdownMenuItem key={r.label} onSelect={() => setConfirming(r)}>{r.label}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchBox value={values.q} onChange={(v) => filters.set("q", v)} placeholder="Search alerts" />
        <FilterSelect label="Source" value={values.source} onChange={(v) => filters.set("source", v)} options={Object.entries(EVENT_SOURCE_LABELS).map(([value, label]) => ({ value, label }))} />
        <FilterSelect label="Channel" value={values.channel} onChange={(v) => filters.set("channel", v)} options={(channels.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
        <FilterSelect label="Severity" value={values.severity} onChange={(v) => filters.set("severity", v)} options={[{ value: "critical", label: "Critical" }, { value: "warning", label: "Warning" }, { value: "info", label: "Info" }]} />
        <FilterSelect label="Delivery" value={values.result} onChange={(v) => filters.set("result", v)} options={[{ value: "sent", label: "Sent everywhere" }, { value: "failed", label: "Some failed" }]} />
        <FilterSelect label="When" value={values.range} onChange={(v) => filters.set("range", v)} options={Object.entries(RANGES).map(([value, r]) => ({ value, label: r.label }))} />
        <ClearFilters active={filters.active} onClear={filters.clear} />
      </div>

      {events.isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-paper-dim" /></div>
      ) : events.isError ? (
        <p role="alert" className="text-[12px] text-red-300">{errMessage(events.error)}</p>
      ) : rows.length === 0 ? (
        <EmptyFiltered message={filters.active ? "No alerts match these filters" : "No recent alerts"} />
      ) : (
        <ul className="space-y-2">
          {rows.map((ev) => (
            <li key={ev.id} className={ROW} data-testid="event-row">
              <ShieldAlert className={cn("h-3.5 w-3.5 shrink-0", ev.severity === "critical" ? "text-red-400" : ev.severity === "warning" ? "text-amber-400" : "text-paper-dim")} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-paper" title={eventSummary(ev.payload)}>{eventSummary(ev.payload)}</div>
                <div className={META}>
                  {new Date(ev.firedAt).toLocaleString()} · {EVENT_SOURCE_LABELS[ev.source ?? "other"] ?? ev.source}
                  {ev.deliveredTo.length > 0 ? ` · to ${ev.deliveredTo.join(", ")}` : ""}
                </div>
              </div>
              {ev.deliveryFailed ? (
                <span className={cn(BADGE, "border-red-900/60 text-red-300")}>Some failed</span>
              ) : ev.deliveredTo.length > 0 ? (
                <span className={cn(BADGE, "border-emerald-900/60 text-emerald-400")}>{ev.deliveredTo.length} delivered</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {events.hasNextPage && (
        <div className="mt-3 flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => void events.fetchNextPage()} disabled={events.isFetchingNextPage} className="h-7 gap-1 font-mono text-[10px] uppercase tracking-[0.14em]">
            {events.isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Load more
          </Button>
        </div>
      )}

      <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear recent alerts?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.olderThanMs === null ? "All recorded alerts will be permanently removed." : `Alerts ${confirming?.label.toLowerCase()} will be permanently removed.`} This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirming && clear.mutate(confirming.olderThanMs)} className="bg-red-600 hover:bg-red-500">Clear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}
