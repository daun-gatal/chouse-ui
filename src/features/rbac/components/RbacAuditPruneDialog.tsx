import React, { useState, useCallback } from 'react';
import { subDays, format } from 'date-fns';
import { Trash2, AlertTriangle, Calendar as CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';
import { log } from '@/lib/log';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { rbacAuditApi } from '@/api/rbac';

interface RbacAuditPruneDialogProps {
    onPruneSuccess: () => void;
    actionFilter?: string;
    usernameFilter?: string;
    emailFilter?: string;
    statusFilter?: 'all' | 'success' | 'failed' | 'failure';
    dateRange?: { start?: Date; end?: Date };
}

type RetentionPeriod = '7d' | '30d' | '90d' | 'all' | 'custom' | 'current_filter';

export const RbacAuditPruneDialog: React.FC<RbacAuditPruneDialogProps> = ({
    onPruneSuccess,
    actionFilter,
    usernameFilter,
    emailFilter,
    statusFilter,
    dateRange,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [retentionPeriod, setRetentionPeriod] = useState<RetentionPeriod>('30d');
    const [customDate, setCustomDate] = useState<Date | undefined>(undefined);
    const [isPruning, setIsPruning] = useState(false);

    const getCutoffDate = useCallback((): Date | undefined => {
        const now = new Date();
        switch (retentionPeriod) {
            case '7d':
                return subDays(now, 7);
            case '30d':
                return subDays(now, 30);
            case '90d':
                return subDays(now, 90);
            case 'all':
                return now; // Delete everything up to now
            case 'custom':
                return customDate;
            case 'current_filter':
                return undefined; // We use dateRange from props
            default:
                return undefined;
        }
    }, [retentionPeriod, customDate]);

    const handlePrune = async () => {
        const cutoffDate = getCutoffDate();
        if (!cutoffDate && retentionPeriod !== 'custom' && retentionPeriod !== 'current_filter') return;
        if (retentionPeriod === 'custom' && !customDate) {
            toast.error('Please select a custom date');
            return;
        }

        try {
            setIsPruning(true);
            const uniqueId = `rbac_prune_${Date.now()}`;
            toast.loading('Pruning audit logs...', { id: uniqueId });

            // Calculate endDate - we delete everything BEFORE or EQUAL to this date
            // For 'Keep last X days', we want to delete logs older than X days.
            // So endDate should be (now - X days).
            // For 'all', endDate is now.

            // Calculate options based on retention period
            const deleteOptions: any = {};

            if (retentionPeriod === 'current_filter') {
                // Use current filters from props
                if (actionFilter !== 'all') deleteOptions.action = actionFilter;
                if (usernameFilter) deleteOptions.username = usernameFilter;
                if (emailFilter) deleteOptions.email = emailFilter;
                if (statusFilter !== 'all') deleteOptions.status = statusFilter;
                if (dateRange?.start) deleteOptions.startDate = dateRange.start.toISOString();
                if (dateRange?.end) deleteOptions.endDate = new Date(new Date(dateRange.end).setHours(23, 59, 59, 999)).toISOString();
            } else {
                // Retention policy logic
                // We delete everything BEFORE or EQUAL to this date
                if (cutoffDate) {
                    deleteOptions.endDate = cutoffDate.toISOString();
                }
                // For retention policies, we generally ignore action filters unless specifically requested.
                // But to be safe and consistent with previous "Delete Logs" behavior which respected filters,
                // we might want to respect it if the user expects it.
                // However, "Retention" usually implies "Clean up old stuff regardless of type".
                // The previous implementation of Prune respected actionFilter if provided.
                if (actionFilter !== 'all') deleteOptions.action = actionFilter;
                if (usernameFilter) deleteOptions.username = usernameFilter;
                if (emailFilter) deleteOptions.email = emailFilter;
                if (statusFilter !== 'all') deleteOptions.status = statusFilter;
            }

            const result = await rbacAuditApi.delete(deleteOptions);

            toast.success(`Successfully pruned ${result.deletedCount} audit logs`, { id: uniqueId });
            onPruneSuccess();
            setIsOpen(false);
        } catch (error) {
            log.error('Prune failed:', error);
            toast.error('Failed to prune audit logs', { id: 'rbac_prune_error' });
        } finally {
            setIsPruning(false);
        }
    };

    const cutoffDate = getCutoffDate();

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-2 rounded-xs border-red-300 bg-red-50 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-red-700 hover:border-red-400 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:border-red-800 dark:hover:bg-red-950/60 dark:hover:text-red-200"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete logs
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md rounded-xs border-ink-500 bg-ink-100 text-paper">
                <DialogHeader>
                    <div className="mb-2 flex items-center gap-3">
                        <span className="grid h-9 w-9 place-items-center rounded-xs border border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                            <AlertTriangle className="h-4 w-4" aria-hidden />
                        </span>
                        <DialogTitle className="text-[16px] font-semibold tracking-tight text-paper">Delete audit logs</DialogTitle>
                    </div>
                    <DialogDescription className="text-paper-muted">
                        Permanently delete old audit logs based on a retention policy.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Retention policy</Label>
                        <Select
                            value={retentionPeriod}
                            onValueChange={(v) => setRetentionPeriod(v as RetentionPeriod)}
                        >
                            <SelectTrigger className="rounded-xs border-ink-500 bg-ink-200 text-paper">
                                <SelectValue placeholder="Select retention period" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                                <SelectItem value="7d">Keep last 7 days (Delete older)</SelectItem>
                                <SelectItem value="30d">Keep last 30 days (Delete older)</SelectItem>
                                <SelectItem value="90d">Keep last 90 days (Delete older)</SelectItem>
                                <SelectItem value="custom">Custom date (Delete older than…)</SelectItem>
                                <SelectItem value="all" className="text-red-300 focus:text-red-200">
                                    Delete all logs
                                </SelectItem>
                                <SelectItem value="current_filter">Delete matching current filters</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {retentionPeriod === 'custom' && (
                        <div className="space-y-2">
                            <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Delete logs older than</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(
                                            "h-9 w-full justify-start rounded-xs border-ink-500 bg-ink-200 px-3 text-left font-normal text-paper hover:border-ink-700 hover:bg-ink-100",
                                            !customDate && "text-paper-faint"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                                        {customDate ? format(customDate, "PPP") : "Pick a date"}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto rounded-xs border-ink-500 bg-ink-100 p-0">
                                    <Calendar
                                        mode="single"
                                        selected={customDate}
                                        onSelect={setCustomDate}
                                        initialFocus
                                        className="pointer-events-auto p-3"
                                        classNames={{
                                            day_selected: "bg-red-600 text-paper hover:bg-red-700 focus:bg-red-600 rounded-xs",
                                            day_today: "bg-ink-200 text-paper rounded-xs",
                                        }}
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                    )}

                    {cutoffDate && (
                        <div className="rounded-xs border border-red-900/60 bg-red-950/40 p-4 text-[12px] text-red-200">
                            <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Warning
                            </p>
                            <p className="mt-2">
                                This will permanently delete all logs created before{' '}
                                <span className="font-mono font-semibold text-paper">
                                    {format(cutoffDate, "PP pp")}
                                </span>
                                {actionFilter !== 'all' ? (
                                    <span> matching action <span className="font-mono font-semibold text-paper">{actionFilter}</span></span>
                                ) : ''}
                                {usernameFilter && <span>, user <span className="font-mono font-semibold text-paper">{usernameFilter}</span></span>}
                                {emailFilter && <span>, email <span className="font-mono font-semibold text-paper">{emailFilter}</span></span>}
                                {statusFilter !== 'all' && statusFilter && <span>, status <span className="font-mono font-semibold text-paper">{statusFilter}</span></span>}
                                .
                            </p>
                            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-red-300/80">
                                This action cannot be undone.
                            </p>
                        </div>
                    )}

                    {retentionPeriod === 'current_filter' && (
                        <div className="rounded-xs border border-red-900/60 bg-red-950/40 p-4 text-[12px] text-red-200">
                            <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                Warning
                            </p>
                            <p className="mt-2">
                                This will permanently delete logs matching:
                            </p>
                            <ul className="mt-2 list-inside list-disc space-y-1">
                                <li>Action: <span className="font-mono font-semibold text-paper">{actionFilter === 'all' || !actionFilter ? 'All Actions' : actionFilter}</span></li>
                                {usernameFilter && <li>Username: <span className="font-mono font-semibold text-paper">{usernameFilter}</span></li>}
                                {emailFilter && <li>Email: <span className="font-mono font-semibold text-paper">{emailFilter}</span></li>}
                                {statusFilter !== 'all' && statusFilter && <li>Status: <span className="font-mono font-semibold uppercase text-paper">{statusFilter}</span></li>}
                                <li>Date: <span className="font-mono font-semibold text-paper">
                                    {dateRange?.start ? (
                                        dateRange.end ?
                                            `${format(dateRange.start, 'MMM d, yyyy')} - ${format(dateRange.end, 'MMM d, yyyy')}` :
                                            `Since ${format(dateRange.start, 'MMM d, yyyy')}`
                                    ) : 'All Time'}
                                </span></li>
                            </ul>
                            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-red-300/80">
                                This action cannot be undone.
                            </p>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button
                        variant="ghost"
                        onClick={() => setIsOpen(false)}
                        disabled={isPruning}
                        className="h-9 rounded-xs font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handlePrune}
                        disabled={isPruning || (!cutoffDate && retentionPeriod !== 'custom' && retentionPeriod !== 'current_filter')}
                        className="h-9 gap-2 rounded-xs border-none bg-red-600 px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-paper hover:bg-red-700"
                    >
                        {isPruning ? 'Deleting…' : 'Confirm deletion'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
