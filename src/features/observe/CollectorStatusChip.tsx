/**
 * Header chip: which ClickHouse version the collector sees and how fresh its
 * evidence is. Turns amber when a collector errors or lacks privileges.
 */

import type { ReactElement } from "react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCollectorStatus } from "./hooks";
import { formatAgo } from "./lib";

export function CollectorStatusChip(): ReactElement | null {
  const { data } = useCollectorStatus();
  if (!data) return null;
  const failing = data.collectors.filter((c) => c.state === "error" || (c.missingPrivileges?.length ?? 0) > 0);
  const lastOk = Math.max(0, ...data.collectors.map((c) => c.lastOkAt ?? 0));
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex h-9 items-center gap-2 rounded-xs border border-ink-500 px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" data-onboarding-id="data-collector-status">
            <span className={cn("h-1.5 w-1.5 rounded-full", failing.length > 0 ? "bg-amber-500" : "bg-emerald-500")} aria-hidden />
            {data.serverVersion ? `CH ${data.serverVersion.split(".").slice(0, 2).join(".")}` : "Collector"} · {lastOk ? formatAgo(lastOk) : "pending"}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-80 rounded-xs border-ink-500 bg-ink-200 text-[11px] text-paper">
          {failing.length === 0 ? (
            <p>All {data.collectors.length} collectors healthy.</p>
          ) : (
            <ul className="space-y-1">
              {failing.map((c) => (
                <li key={c.collector}>
                  <span className="font-mono">{c.collector}</span>: {c.missingPrivileges?.length ? `missing ${c.missingPrivileges.join(", ")}` : c.lastError ?? c.state}
                </li>
              ))}
            </ul>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
