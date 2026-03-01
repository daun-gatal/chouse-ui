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
                    className="gap-2 bg-white/5 border-white/10 hover:bg-white/10"
                >
                    <Download className="h-4 w-4" />
                    Export CSV
                </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#0B0D11] border-white/10 text-white backdrop-blur-xl shadow-2xl max-w-md">
                <DialogHeader>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 rounded-lg bg-cyan-500/20">
                            <FileDown className="h-6 w-6 text-cyan-400" />
                        </div>
                        <DialogTitle className="text-xl">Export Audit Logs</DialogTitle>
                    </div>
                    <DialogDescription className="text-gray-400 text-base">
                        Download audit logs as a CSV file. Choose a date range below.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label className="text-gray-300">Export Range</Label>
                        <Select
                            value={exportRange}
                            onValueChange={(v) => setExportRange(v as ExportRange)}
                        >
                            <SelectTrigger className="bg-white/5 border-white/10 text-white">
                                <SelectValue placeholder="Select export range" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="7d">Last 7 Days</SelectItem>
                                <SelectItem value="30d">Last 30 Days</SelectItem>
                                <SelectItem value="90d">Last 90 Days</SelectItem>
                                <SelectItem value="custom">Custom Date Range</SelectItem>
                                <SelectItem value="all">All Time</SelectItem>
                                <SelectItem value="current_filter">Matching Current Filters</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {exportRange === 'custom' && (
                        <div className="space-y-2">
                            <Label className="text-gray-300">Select Date Range</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(
                                            "w-full justify-start text-left font-normal bg-white/5 border-white/10 text-white hover:bg-white/10",
                                            !customDateRange.start && "text-gray-400"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
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
                                <PopoverContent className="w-auto p-0 bg-gray-900 border-white/10" align="start">
                                    <Calendar
                                        mode="range"
                                        selected={{ from: customDateRange.start, to: customDateRange.end }}
                                        onSelect={(range) => setCustomDateRange({ start: range?.from, end: range?.to })}
                                        initialFocus
                                        numberOfMonths={2}
                                        className="p-3 pointer-events-auto"
                                        classNames={{
                                            day_selected: "bg-cyan-500 text-white hover:bg-cyan-600 focus:bg-cyan-500",
                                            day_today: "bg-white/10 text-white",
                                            range_middle: "bg-cyan-500/20 text-cyan-200",
                                        }}
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                    )}

                    <div className="p-4 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-sm text-cyan-200">
                        <p className="font-semibold mb-1">Export Summary</p>
                        <ul className="list-disc list-inside opacity-90 space-y-1 text-xs">
                            <li>
                                Date Range: <span className="font-bold text-white">
                                    {range.start ? (
                                        range.end ?
                                            `${format(range.start, 'MMM d, yyyy')} - ${format(range.end, 'MMM d, yyyy')}` :
                                            `Since ${format(range.start, 'MMM d, yyyy')}`
                                    ) : 'All Time'}
                                </span>
                            </li>
                            <li>Action Filter: <span className="font-bold text-white">{actionFilter === 'all' || !actionFilter ? 'All Actions' : actionFilter}</span></li>
                            {usernameFilter && <li>Username: <span className="font-bold text-white">{usernameFilter}</span></li>}
                            {emailFilter && <li>Email: <span className="font-bold text-white">{emailFilter}</span></li>}
                            {statusFilter !== 'all' && statusFilter && <li>Status: <span className="font-bold text-white uppercase">{statusFilter}</span></li>}
                        </ul>
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="ghost"
                        onClick={() => setIsOpen(false)}
                        disabled={isExporting}
                        className="hover:bg-white/10 text-white"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleExport}
                        disabled={isExporting || (exportRange === 'custom' && (!customDateRange.start || !customDateRange.end))}
                        className="bg-cyan-500 hover:bg-cyan-600 text-white border-none gap-2"
                    >
                        {isExporting ? (
                            <>
                                <span className="animate-spin">⏳</span> Exporting...
                            </>
                        ) : (
                            <>
                                <Download className="h-4 w-4" /> Download CSV
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
