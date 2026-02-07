import React, { useState, useCallback } from 'react';
import { subDays, format } from 'date-fns';
import { Trash2, AlertTriangle, Calendar as CalendarIcon } from 'lucide-react';
import { toast } from 'sonner';

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
    dateRange?: { start?: Date; end?: Date };
}

type RetentionPeriod = '7d' | '30d' | '90d' | 'all' | 'custom' | 'current_filter';

export const RbacAuditPruneDialog: React.FC<RbacAuditPruneDialogProps> = ({
    onPruneSuccess,
    actionFilter,
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
            }

            const result = await rbacAuditApi.delete(deleteOptions);

            toast.success(`Successfully pruned ${result.deletedCount} audit logs`, { id: uniqueId });
            onPruneSuccess();
            setIsOpen(false);
        } catch (error) {
            console.error('Prune failed:', error);
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
                    className="gap-2 bg-red-500/10 border-red-500/20 hover:bg-red-500/20 text-red-400"
                >
                    <Trash2 className="h-4 w-4" />
                    Delete Logs
                </Button>
            </DialogTrigger>
            <DialogContent className="bg-gray-900/95 border-white/10 text-white backdrop-blur-xl shadow-2xl max-w-md">
                <DialogHeader>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-full bg-red-500/20">
                            <AlertTriangle className="h-6 w-6 text-red-400" />
                        </div>
                        <DialogTitle className="text-xl">Delete Audit Logs</DialogTitle>
                    </div>
                    <DialogDescription className="text-gray-400 text-base">
                        Permanently delete old audit logs based on a retention policy.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label className="text-gray-300">Retention Policy</Label>
                        <Select
                            value={retentionPeriod}
                            onValueChange={(v) => setRetentionPeriod(v as RetentionPeriod)}
                        >
                            <SelectTrigger className="bg-white/5 border-white/10 text-white">
                                <SelectValue placeholder="Select retention period" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="7d">Keep last 7 days (Delete older)</SelectItem>
                                <SelectItem value="30d">Keep last 30 days (Delete older)</SelectItem>
                                <SelectItem value="90d">Keep last 90 days (Delete older)</SelectItem>
                                <SelectItem value="custom">Custom Date (Delete older than...)</SelectItem>
                                <SelectItem value="all" className="text-red-400 focus:text-red-400">
                                    Delete All Logs
                                </SelectItem>
                                <SelectItem value="current_filter">Delete Matching Current Filters</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {retentionPeriod === 'custom' && (
                        <div className="space-y-2">
                            <Label className="text-gray-300">Delete logs older than</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(
                                            "w-full justify-start text-left font-normal bg-white/5 border-white/10 text-white hover:bg-white/10",
                                            !customDate && "text-gray-400"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {customDate ? format(customDate, "PPP") : "Pick a date"}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 bg-gray-900 border-white/10">
                                    <Calendar
                                        mode="single"
                                        selected={customDate}
                                        onSelect={setCustomDate}
                                        initialFocus
                                        className="p-3 pointer-events-auto"
                                        classNames={{
                                            day_selected: "bg-red-500 text-white hover:bg-red-600 focus:bg-red-500",
                                            day_today: "bg-white/10 text-white",
                                        }}
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                    )}

                    {cutoffDate && (
                        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-200">
                            <p className="font-semibold flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4" />
                                Warning
                            </p>
                            <p className="mt-1 opacity-90">
                                This will permanently delete all logs created before{' '}
                                <span className="font-bold text-white">
                                    {format(cutoffDate, "PP pp")}
                                </span>
                                {actionFilter !== 'all' ? (
                                    <span> matching action <span className="font-bold text-white">{actionFilter}</span></span>
                                ) : ''}
                                .
                            </p>
                            <p className="mt-2 text-xs opacity-75">
                                This action cannot be undone.
                            </p>
                        </div>
                    )}

                    {retentionPeriod === 'current_filter' && (
                        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-200">
                            <p className="font-semibold flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4" />
                                Warning
                            </p>
                            <p className="mt-1 opacity-90">
                                This will permanently delete logs matching:
                            </p>
                            <ul className="list-disc list-inside mt-2 opacity-75 space-y-1">
                                <li>Action: <span className="font-bold text-white">{actionFilter === 'all' || !actionFilter ? 'All Actions' : actionFilter}</span></li>
                                <li>Date: <span className="font-bold text-white">
                                    {dateRange?.start ? (
                                        dateRange.end ?
                                            `${format(dateRange.start, 'MMM d, yyyy')} - ${format(dateRange.end, 'MMM d, yyyy')}` :
                                            `Since ${format(dateRange.start, 'MMM d, yyyy')}`
                                    ) : 'All Time'}
                                </span></li>
                            </ul>
                            <p className="mt-2 text-xs opacity-75">
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
                        className="hover:bg-white/10 text-white"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handlePrune}
                        disabled={isPruning || (!cutoffDate && retentionPeriod !== 'custom' && retentionPeriod !== 'current_filter')}
                        className="bg-red-500 hover:bg-red-600 text-white border-none"
                    >
                        {isPruning ? 'Deleting...' : 'Confirm Deletion'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
