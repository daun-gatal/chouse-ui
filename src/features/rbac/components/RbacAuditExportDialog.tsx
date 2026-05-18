import React, { useState, useCallback } from 'react';
import { subDays, format } from 'date-fns';
import { Download, Calendar as CalendarIcon, FileDown } from 'lucide-react';
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

interface RbacAuditExportDialogProps {
    actionFilter?: string;
    usernameFilter?: string;
    emailFilter?: string;
    statusFilter?: 'all' | 'success' | 'failed' | 'failure';
    dateRange?: { start?: Date; end?: Date };
}

type ExportRange = '7d' | '30d' | '90d' | 'all' | 'custom' | 'current_filter';

export const RbacAuditExportDialog: React.FC<RbacAuditExportDialogProps> = ({
    actionFilter,
    usernameFilter,
    emailFilter,
    statusFilter,
    dateRange,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [exportRange, setExportRange] = useState<ExportRange>('30d');
    const [customDateRange, setCustomDateRange] = useState<{ start?: Date; end?: Date }>({});
    const [isExporting, setIsExporting] = useState(false);

    const getDateRangeForExport = useCallback((): { start?: Date; end?: Date } => {
        const now = new Date();
        switch (exportRange) {
            case '7d':
                return { start: subDays(now, 7), end: now };
            case '30d':
                return { start: subDays(now, 30), end: now };
            case '90d':
                return { start: subDays(now, 90), end: now };
            case 'all':
                return { start: undefined, end: undefined };
            case 'custom':
                return customDateRange;
            case 'current_filter':
                return dateRange || {};
            default:
                return {};
        }
    }, [exportRange, customDateRange, dateRange]);

    const handleExport = async () => {
        const range = getDateRangeForExport();

        if (exportRange === 'custom' && (!range.start || !range.end)) {
            toast.error('Please select a valid date range');
            return;
        }

        try {
            setIsExporting(true);
            const uniqueId = `rbac_export_${Date.now()}`;
            toast.loading('Exporting audit logs...', { id: uniqueId });

            const exportOptions: any = {};

            if (actionFilter !== 'all') exportOptions.action = actionFilter;
            if (usernameFilter) exportOptions.username = usernameFilter;
            if (emailFilter) exportOptions.email = emailFilter;
            if (statusFilter !== 'all') exportOptions.status = statusFilter;

            if (range.start) exportOptions.startDate = range.start.toISOString();
            if (range.end) exportOptions.endDate = new Date(new Date(range.end).setHours(23, 59, 59, 999)).toISOString();

            const blob = await rbacAuditApi.exportLogs(exportOptions);

            // Create download link
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `audit-logs-${format(new Date(), 'yyyy-MM-dd-HH-mm')}.csv`;
            document.body.appendChild(a);
            a.click();

            // Cleanup
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            toast.success('Export completed successfully', { id: uniqueId });
            setIsOpen(false);
        } catch (error) {
            log.error('Export failed:', error);
            toast.error('Failed to export audit logs', { id: `rbac_export_error` });
        } finally {
            setIsExporting(false);
        }
    };

    const range = getDateRangeForExport();

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
                >
                    <Download className="h-3.5 w-3.5" />
                    Export CSV
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md rounded-xs border-ink-500 bg-ink-100 text-paper">
                <DialogHeader>
                    <div className="mb-2 flex items-center gap-3">
                        <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                            <FileDown className="h-4 w-4" aria-hidden />
                        </span>
                        <DialogTitle className="text-[16px] font-semibold tracking-tight text-paper">Export audit logs</DialogTitle>
                    </div>
                    <DialogDescription className="text-paper-muted">
                        Download audit logs as a CSV file. Choose a date range below.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Export range</Label>
                        <Select
                            value={exportRange}
                            onValueChange={(v) => setExportRange(v as ExportRange)}
                        >
                            <SelectTrigger className="rounded-xs border-ink-500 bg-ink-200 text-paper">
                                <SelectValue placeholder="Select export range" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                                <SelectItem value="7d">Last 7 days</SelectItem>
                                <SelectItem value="30d">Last 30 days</SelectItem>
                                <SelectItem value="90d">Last 90 days</SelectItem>
                                <SelectItem value="custom">Custom date range</SelectItem>
                                <SelectItem value="all">All time</SelectItem>
                                <SelectItem value="current_filter">Matching current filters</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {exportRange === 'custom' && (
                        <div className="space-y-2">
                            <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Select date range</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(
                                            "h-9 w-full justify-start rounded-xs border-ink-500 bg-ink-200 px-3 text-left font-normal text-paper hover:border-ink-700 hover:bg-ink-100",
                                            !customDateRange.start && "text-paper-faint"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                                        {customDateRange.start ? (
                                            customDateRange.end ? (
                                                `${format(customDateRange.start, "MMM d, yyyy")} - ${format(customDateRange.end, "MMM d, yyyy")}`
                                            ) : (
                                                format(customDateRange.start, "MMM d, yyyy")
                                            )
                                        ) : (
                                            "Pick a date range"
                                        )}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto rounded-xs border-ink-500 bg-ink-100 p-0" align="start">
                                    <Calendar
                                        mode="range"
                                        selected={{ from: customDateRange.start, to: customDateRange.end }}
                                        onSelect={(range) => setCustomDateRange({ start: range?.from, end: range?.to })}
                                        initialFocus
                                        numberOfMonths={2}
                                        className="pointer-events-auto p-3"
                                        classNames={{
                                            day_selected: "bg-brand text-ink-50 hover:bg-brand-soft focus:bg-brand rounded-xs",
                                            day_today: "bg-ink-200 text-paper rounded-xs",
                                            range_middle: "bg-brand/10 text-brand !rounded-none",
                                        }}
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                    )}

                    <div className="rounded-xs border border-ink-500 bg-ink-200 p-4 text-[12px] text-paper-muted">
                        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Export summary</p>
                        <ul className="list-inside list-disc space-y-1">
                            <li>
                                Date range: <span className="font-mono font-semibold text-paper">
                                    {range.start ? (
                                        range.end ?
                                            `${format(range.start, 'MMM d, yyyy')} - ${format(range.end, 'MMM d, yyyy')}` :
                                            `Since ${format(range.start, 'MMM d, yyyy')}`
                                    ) : 'All Time'}
                                </span>
                            </li>
                            <li>Action filter: <span className="font-mono font-semibold text-paper">{actionFilter === 'all' || !actionFilter ? 'All actions' : actionFilter}</span></li>
                            {usernameFilter && <li>Username: <span className="font-mono font-semibold text-paper">{usernameFilter}</span></li>}
                            {emailFilter && <li>Email: <span className="font-mono font-semibold text-paper">{emailFilter}</span></li>}
                            {statusFilter !== 'all' && statusFilter && <li>Status: <span className="font-mono font-semibold uppercase text-paper">{statusFilter}</span></li>}
                        </ul>
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="ghost"
                        onClick={() => setIsOpen(false)}
                        disabled={isExporting}
                        className="h-9 rounded-xs font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleExport}
                        disabled={isExporting || (exportRange === 'custom' && (!customDateRange.start || !customDateRange.end))}
                        className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
                    >
                        {isExporting ? (
                            <>
                                <span className="animate-spin">⏳</span> Exporting…
                            </>
                        ) : (
                            <>
                                <Download className="h-3.5 w-3.5" /> Download CSV
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
