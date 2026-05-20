import { Button } from "@/components/ui/button";
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
        <div className={cn("flex items-center gap-3", className)}>
            {showLastUpdated && (
                <span className="text-xs text-paper-faint font-mono hidden xl:inline-block">
                    Updated {lastUpdated}
                </span>
            )}

            <div className="flex items-center p-1 gap-1 bg-ink-200 rounded-xs border border-ink-500">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onAutoRefreshChange(!autoRefresh)}
                    className={cn(
                        "h-7 w-7 rounded-xs",
                        autoRefresh
                            ? "text-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/20 dark:text-emerald-400"
                            : "text-paper-muted hover:text-paper hover:bg-ink-300"
                    )}
                    title={autoRefresh ? "Stop Auto Refresh" : "Auto Refresh (5s)"}
                >
                    {autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>

                <div className="w-px h-4 bg-ink-500 mx-0.5" />

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onRefresh}
                    disabled={isRefreshing || autoRefresh}
                    className="h-7 w-7 rounded-xs text-paper-muted hover:text-paper hover:bg-ink-300"
                    title={autoRefresh ? "Auto-refresh active" : "Refresh Data"}
                >
                    <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
                </Button>
            </div>
        </div>
    );
}
