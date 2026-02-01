import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Play, Pause, RefreshCw, Clock } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface DataControlsProps {
    lastUpdated: string;
    isRefreshing?: boolean;
    onRefresh: () => void;
    autoRefresh: boolean;
    onAutoRefreshChange: (value: boolean) => void;
    className?: string;
    showLastUpdated?: boolean;
    showTimeRange?: boolean;
    timeRange?: string;
    onTimeRangeChange?: (value: string) => void;
}

export function DataControls({
    lastUpdated,
    isRefreshing = false,
    onRefresh,
    autoRefresh,
    onAutoRefreshChange,
    className,
    showLastUpdated = true,
    showTimeRange = false,
    timeRange = "1h",
    onTimeRangeChange,
}: DataControlsProps) {
    return (
        <div className={cn("flex items-center gap-3", className)}>
            {showLastUpdated && (
                <span className="text-xs text-gray-500 font-mono hidden xl:inline-block">
                    Updated {lastUpdated}
                </span>
            )}

            {showTimeRange && onTimeRangeChange && (
                <Select value={timeRange} onValueChange={onTimeRangeChange}>
                    <SelectTrigger className="w-[150px] bg-white/5 border-white/10 h-9">
                        <Clock className="h-4 w-4 mr-2 text-gray-400" />
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="15m">15 minutes</SelectItem>
                        <SelectItem value="1h">1 hour</SelectItem>
                        <SelectItem value="6h">6 hours</SelectItem>
                        <SelectItem value="24h">24 hours</SelectItem>
                    </SelectContent>
                </Select>
            )}

            <div className="flex items-center p-1 gap-1 bg-white/5 rounded-lg border border-white/10">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onAutoRefreshChange(!autoRefresh)}
                    className={cn(
                        "h-7 w-7 rounded-md",
                        autoRefresh
                            ? "text-green-400 bg-green-500/10 hover:bg-green-500/20"
                            : "text-gray-400 hover:text-white hover:bg-white/10"
                    )}
                    title={autoRefresh ? "Stop Auto Refresh" : "Auto Refresh (5s)"}
                >
                    {autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>

                <div className="w-px h-4 bg-white/10 mx-0.5" />

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onRefresh}
                    disabled={isRefreshing || autoRefresh}
                    className="h-7 w-7 rounded-md text-gray-400 hover:text-white hover:bg-white/10"
                    title={autoRefresh ? "Auto-refresh active" : "Refresh Data"}
                >
                    <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
                </Button>
            </div>
        </div>
    );
}
