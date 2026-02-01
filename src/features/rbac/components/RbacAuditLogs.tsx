/**
 * RBAC Audit Logs Component
 * 
 * Displays audit logs with filtering and export capabilities.
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  FileText,
  Search,
  Download,
  RefreshCw,
  CheckCircle,
  XCircle,
  Calendar,
  Filter,
  User,
  Trash2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { format, subDays, startOfToday, endOfToday, startOfYesterday, endOfYesterday } from 'date-fns';
import { toast } from 'sonner';

import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';

import { rbacAuditApi, type RbacAuditLog } from '@/api/rbac';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores/rbac';
import { cn } from '@/lib/utils';

// ============================================
// Action Colors
// ============================================

const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
  'auth': { bg: 'bg-blue-500/20', text: 'text-blue-300' },
  'user': { bg: 'bg-green-500/20', text: 'text-green-300' },
  'role': { bg: 'bg-purple-500/20', text: 'text-purple-300' },
  'clickhouse': { bg: 'bg-orange-500/20', text: 'text-orange-300' },
  'settings': { bg: 'bg-cyan-500/20', text: 'text-cyan-300' },
};

const getActionColor = (action: string) => {
  const category = action.split('.')[0];
  return ACTION_COLORS[category] || { bg: 'bg-gray-500/20', text: 'text-gray-300' };
};

// ============================================
// Component
// ============================================

export const RbacAuditLogs: React.FC = () => {
  const { hasPermission } = useRbacStore();

  // State
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState<{ start?: Date; end?: Date }>({});

  // Queries
  const { data: logsData, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['rbac-audit-logs', page, actionFilter, dateRange],
    queryFn: () => rbacAuditApi.list({
      page,
      limit: 50,
      action: actionFilter !== 'all' ? actionFilter : undefined,
      startDate: dateRange.start?.toISOString(),
      endDate: dateRange.end ? new Date(new Date(dateRange.end).setHours(23, 59, 59, 999)).toISOString() : undefined,
    }),
  });

  const { data: actionsData } = useQuery({
    queryKey: ['rbac-audit-actions'],
    queryFn: () => rbacAuditApi.getActions(),
  });

  const { data: statsData } = useQuery({
    queryKey: ['rbac-audit-stats'],
    queryFn: () => rbacAuditApi.getStats(),
    refetchInterval: 60000, // Refresh every minute
  });

  const logs = logsData?.logs || [];
  const total = logsData?.total || 0;
  const totalPages = Math.ceil(total / 50);
  const actions = actionsData?.groupedActions || {};
  const stats = statsData?.stats;

  const canExport = hasPermission(RBAC_PERMISSIONS.AUDIT_EXPORT);

  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const uniqueId = `rbac_export_${Date.now()}`;
      toast.loading('Exporting audit logs...', { id: uniqueId });

      const blob = await rbacAuditApi.exportLogs({
        action: actionFilter !== 'all' ? actionFilter : undefined,
        startDate: dateRange.start?.toISOString(),
        endDate: dateRange.end ? new Date(new Date(dateRange.end).setHours(23, 59, 59, 999)).toISOString() : undefined,
      });

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
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export audit logs', { id: `rbac_export_error` });
    } finally {
      setIsExporting(false);
    }
  };

  const canDelete = hasPermission(RBAC_PERMISSIONS.AUDIT_DELETE);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      const uniqueId = `rbac_delete_${Date.now()}`;
      toast.loading('Deleting audit logs...', { id: uniqueId });

      const result = await rbacAuditApi.delete({
        action: actionFilter !== 'all' ? actionFilter : undefined,
        startDate: dateRange.start?.toISOString(),
        endDate: dateRange.end ? new Date(new Date(dateRange.end).setHours(23, 59, 59, 999)).toISOString() : undefined,
      });

      toast.success(`Successfully deleted ${result.deletedCount} audit logs`, { id: uniqueId });
      refetch();
    } catch (error) {
      console.error('Delete failed:', error);
      toast.error('Failed to delete audit logs', { id: `rbac_delete_error` });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/20">
            <FileText className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Audit Logs</h2>
            <p className="text-sm text-gray-400">{total} total events</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2 bg-white/5 border-white/10 hover:bg-white/10"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            Refresh
          </Button>
          {canExport && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={isExporting}
              className="gap-2 bg-white/5 border-white/10 hover:bg-white/10"
            >
              <Download className={cn("h-4 w-4", isExporting && "animate-spin")} />
              {isExporting ? 'Exporting...' : 'Export CSV'}
            </Button>
          )}
          {canDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isDeleting}
                  className="gap-2 bg-red-500/10 border-red-500/20 hover:bg-red-500/20 text-red-400"
                >
                  <Trash2 className={cn("h-4 w-4", isDeleting && "animate-spin")} />
                  {isDeleting ? 'Deleting...' : 'Delete Logs'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="bg-gray-900/95 border-white/10 text-white backdrop-blur-xl shadow-2xl max-w-md">
                <AlertDialogHeader>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-full bg-red-500/20">
                      <AlertTriangle className="h-6 w-6 text-red-400" />
                    </div>
                    <AlertDialogTitle className="text-xl">Permanent Deletion</AlertDialogTitle>
                  </div>
                  <AlertDialogDescription className="text-gray-400 text-base">
                    You are about to permanently delete audit logs matching these filters:
                    <div className="mt-4 p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-500 uppercase tracking-wider text-[10px] font-bold">Action Type</span>
                        <Badge variant="outline" className="bg-white/10 text-white border-white/20">
                          {actionFilter === 'all' ? 'All Actions' : actionFilter}
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-500 uppercase tracking-wider text-[10px] font-bold">Date Range</span>
                        <span className="text-white font-medium">
                          {dateRange.start ? (
                            dateRange.end && format(dateRange.start, 'MMM d, yyyy') !== format(dateRange.end, 'MMM d, yyyy')
                              ? `${format(dateRange.start, 'MMM d')} - ${format(dateRange.end, 'MMM d, yyyy')}`
                              : format(dateRange.start, 'MMM d, yyyy')
                          ) : 'All time'}
                        </span>
                      </div>
                    </div>
                    <p className="mt-6 text-red-400/90 text-sm flex items-center gap-2 font-medium">
                      <AlertTriangle className="h-4 w-4" />
                      This action is irreversible and will be audited.
                    </p>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="mt-6">
                  <AlertDialogCancel className="bg-white/5 border-white/10 hover:bg-white/10 text-white rounded-xl">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-red-500 hover:bg-red-600 text-white border-none rounded-xl px-6"
                  >
                    Confirm Deletion
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-white/5 border border-white/10">
            <p className="text-sm text-gray-400">Last 24 Hours</p>
            <p className="text-2xl font-bold text-white">{stats.last24Hours}</p>
          </div>
          <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
            <p className="text-sm text-gray-400">Successful</p>
            <p className="text-2xl font-bold text-green-400">{stats.byStatus.success || 0}</p>
          </div>
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-sm text-gray-400">Failed</p>
            <p className="text-2xl font-bold text-red-400">{stats.byStatus.failure || 0}</p>
          </div>
          <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <p className="text-sm text-gray-400">Logins</p>
            <p className="text-2xl font-bold text-blue-400">
              {(stats.byAction['auth.login'] || 0) + (stats.byAction['auth.login_failed'] || 0)}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-4">
        <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[200px] bg-white/5 border-white/10 rounded-xl hover:bg-white/10 transition-colors">
            <Filter className="h-4 w-4 mr-2 text-cyan-400" />
            <SelectValue placeholder="Filter by action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            {Object.entries(actions).map(([category, categoryActions]) => (
              <React.Fragment key={category}>
                <div className="px-2 py-1 text-xs text-gray-400 uppercase">{category}</div>
                {categoryActions.map((action) => (
                  <SelectItem key={action} value={action}>
                    {action}
                  </SelectItem>
                ))}
              </React.Fragment>
            ))}
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2 bg-white/5 border-white/10 rounded-xl hover:bg-white/10 transition-colors">
              <Calendar className="h-4 w-4 text-cyan-400" />
              {dateRange.start ? (
                dateRange.end && format(dateRange.start, 'MMM d, yyyy') !== format(dateRange.end, 'MMM d, yyyy')
                  ? `${format(dateRange.start, 'MMM d')} - ${format(dateRange.end, 'MMM d, yyyy')}`
                  : format(dateRange.start, 'MMM d, yyyy')
              ) : 'Date Range'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 bg-[#0B0D11] border-white/10 shadow-2xl rounded-2xl border backdrop-blur-3xl" align="start">
            <div className="flex h-auto">
              {/* Presets Sidebar */}
              <div className="w-40 bg-white/[0.03] p-4 flex flex-col gap-1.5 border-r border-white/5">
                <p className="px-2 mb-3 text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em]">Presets</p>
                {[
                  { label: 'Today', getValue: () => ({ start: startOfToday(), end: endOfToday() }) },
                  { label: 'Yesterday', getValue: () => ({ start: startOfYesterday(), end: endOfYesterday() }) },
                  { label: 'Last 7 Days', getValue: () => ({ start: subDays(new Date(), 7), end: new Date() }) },
                  { label: 'Last 30 Days', getValue: () => ({ start: subDays(new Date(), 30), end: new Date() }) },
                  { label: 'All Time', getValue: () => ({ start: undefined, end: undefined }) },
                ].map((preset) => (
                  <Button
                    key={preset.label}
                    variant="ghost"
                    size="sm"
                    className="justify-start font-medium text-gray-400 hover:text-white hover:bg-white/5 rounded-lg h-9 w-full"
                    onClick={() => {
                      const range = preset.getValue();
                      setDateRange(range);
                      setPage(1);
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}

                <div className="mt-auto pt-4 border-t border-white/5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start font-medium text-red-400/60 hover:text-red-400 hover:bg-red-400/5 rounded-lg h-9 w-full"
                    onClick={() => {
                      setDateRange({});
                      setPage(1);
                    }}
                  >
                    Clear Filter
                  </Button>
                </div>
              </div>

              {/* Calendar Section */}
              <div className="flex-1 p-6 bg-transparent min-w-[340px]">
                <CalendarComponent
                  mode="range"
                  selected={{ from: dateRange.start, to: dateRange.end }}
                  onSelect={(range) => {
                    setDateRange({ start: range?.from, end: range?.to });
                    setPage(1);
                  }}
                  initialFocus
                  fixedWeeks
                  className="p-0"
                  classNames={{
                    months: "w-full",
                    month: "space-y-4 w-full",
                    month_caption: "flex justify-center pt-1 relative items-center mb-6",
                    caption_label: "text-sm font-bold text-white uppercase tracking-widest",
                    nav: "space-x-1 flex items-center",
                    button_previous: cn(
                      buttonVariants({ variant: "outline" }),
                      "h-8 w-8 bg-white/5 border-white/10 p-0 text-gray-400 hover:bg-white/10 hover:text-white rounded-xl transition-all"
                    ),
                    button_next: cn(
                      buttonVariants({ variant: "outline" }),
                      "h-8 w-8 bg-white/5 border-white/10 p-0 text-gray-400 hover:bg-white/10 hover:text-white rounded-xl transition-all"
                    ),
                    month_grid: "w-full border-collapse select-none",
                    weekdays: "grid grid-cols-7 w-full mb-4 px-1",
                    weekday: "text-gray-500 font-bold uppercase text-[9px] tracking-[0.2em] text-center flex items-center justify-center h-8",
                    week: "grid grid-cols-7 w-full mt-1 px-1",
                    day: "h-11 w-full text-center text-sm p-0 relative flex items-center justify-center",
                    day_button: cn(
                      buttonVariants({ variant: "ghost" }),
                      "h-10 w-10 p-0 font-semibold text-gray-300 hover:bg-white/10 hover:text-white rounded-xl transition-all duration-200 flex items-center justify-center text-[13px] tracking-tight"
                    ),
                    selected: "!bg-cyan-500 !text-white hover:!bg-cyan-600 focus:!bg-cyan-500 rounded-xl shadow-[0_8px_16px_rgba(6,182,212,0.3)] opacity-100 border-none",
                    today: "border border-cyan-500/50 text-cyan-400 font-black rounded-xl bg-cyan-500/5",
                    outside: "text-gray-800 opacity-10",
                    range_middle: "aria-selected:bg-cyan-500/10 aria-selected:text-cyan-200 !rounded-none",
                  }}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {(dateRange.start || actionFilter !== 'all') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActionFilter('all');
              setDateRange({});
              setPage(1);
            }}
            className="text-gray-400 hover:text-white hover:bg-white/5 rounded-xl px-4"
          >
            <X className="h-4 w-4 mr-2" />
            Reset Filters
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-white/5">
              <TableHead className="text-gray-400 w-[180px]">Timestamp</TableHead>
              <TableHead className="text-gray-400">Action</TableHead>
              <TableHead className="text-gray-400">User</TableHead>
              <TableHead className="text-gray-400">Resource</TableHead>
              <TableHead className="text-gray-400">Status</TableHead>
              <TableHead className="text-gray-400">IP Address</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i} className="border-white/10">
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                </TableRow>
              ))
            ) : logs.length === 0 ? (
              <TableRow className="border-white/10">
                <TableCell colSpan={6} className="text-center py-8 text-gray-400">
                  No audit logs found
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => {
                const actionColor = getActionColor(log.action);
                return (
                  <TableRow key={log.id} className="border-white/10 hover:bg-white/5">
                    <TableCell className="text-gray-400 text-sm font-mono">
                      {format(new Date(log.createdAt), 'MMM d, HH:mm:ss')}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(actionColor.bg, actionColor.text, 'text-xs')}
                      >
                        {log.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-white">
                      {log.userId ? (
                        <div className="flex items-center gap-2">
                          <User className="h-3 w-3 text-gray-400" />
                          <span className="text-sm">{log.userId.slice(0, 8)}...</span>
                        </div>
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-gray-400 text-sm">
                      {log.resourceType ? (
                        <span>
                          {log.resourceType}
                          {log.resourceId && (
                            <span className="text-gray-500">/{log.resourceId.slice(0, 8)}...</span>
                          )}
                        </span>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {log.status === 'success' ? (
                        <Badge variant="outline" className="bg-green-500/20 text-green-300 border-green-500/30">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Success
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-500/20 text-red-300 border-red-500/30">
                          <XCircle className="h-3 w-3 mr-1" />
                          Failed
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-gray-400 text-sm font-mono">
                      {log.ipAddress || '-'}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-400">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RbacAuditLogs;
