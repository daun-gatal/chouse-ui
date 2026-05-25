/**
 * DataControls — shared refresh + auto-refresh widget used on top of every
 * monitoring sub-page (Logs, Live queries, Metrics, etc).
 *
 * Two buttons in one chrome-bar: auto-refresh toggle (play/pause) and a manual
 * refresh trigger that's disabled while auto-refresh is running so the two
 * don't race. Uses shadcn Tooltip for hover hints instead of the browser
 * `title=` attribute (slow, unstyled, inconsistent across OSes).
 */

import { Button } from "@/components/ui/button";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Play, Pause, RefreshCw } from "lucide-react";

interface DataControlsProps {
    lastUpdated: string;
    isRefreshing?: boolean;
    onRefresh: () => void;
    autoRefresh: boolean;
    onAutoRefreshChange: (value: boolean) => void;
    className?: string;
    showLastUpdated?: boolean;
}

export function DataControls({
    lastUpdated,
    isRefreshing = false,
    onRefresh,
    autoRefresh,
    onAutoRefreshChange,
    className,
    showLastUpdated = true,
}: DataControlsProps) {
    return (
        <TooltipProvider delayDuration={250}>
            <div className={cn("flex items-center gap-3", className)}>
                {showLastUpdated && (
                    <span className="hidden font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim xl:inline-block">
                        Updated {lastUpdated}
                    </span>
                )}

                <div
                    role="group"
                    aria-label="Refresh controls"
                    className="flex items-center gap-1 rounded-xs border border-ink-500 bg-ink-200 p-1"
                >
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onAutoRefreshChange(!autoRefresh)}
                                aria-pressed={autoRefresh}
                                aria-label={autoRefresh ? "Stop auto-refresh" : "Start auto-refresh"}
                                className={cn(
                                    "h-7 w-7 rounded-xs",
                                    autoRefresh
                                        ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400"
                                        : "text-paper-muted hover:bg-ink-300 hover:text-paper",
                                )}
                            >
                                {autoRefresh ? (
                                    <Pause className="h-3.5 w-3.5" />
                                ) : (
                                    <Play className="h-3.5 w-3.5" />
                                )}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="font-mono text-[10px] uppercase tracking-[0.14em]">
                            {autoRefresh ? "Auto-refresh on · click to pause" : "Auto-refresh off · click to start"}
                        </TooltipContent>
                    </Tooltip>

                    <div className="mx-0.5 h-4 w-px bg-ink-500" aria-hidden />

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onRefresh}
                                disabled={isRefreshing || autoRefresh}
                                aria-label="Refresh now"
                                className="h-7 w-7 rounded-xs text-paper-muted hover:bg-ink-300 hover:text-paper disabled:opacity-50"
                            >
                                <RefreshCw
                                    className={cn(
                                        "h-3.5 w-3.5",
                                        isRefreshing && "motion-safe:animate-spin",
                                    )}
                                />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="font-mono text-[10px] uppercase tracking-[0.14em]">
                            {autoRefresh
                                ? "Pause auto-refresh first"
                                : isRefreshing
                                    ? "Refreshing…"
                                    : "Refresh now"}
                        </TooltipContent>
                    </Tooltip>
                </div>
            </div>
        </TooltipProvider>
    );
}
