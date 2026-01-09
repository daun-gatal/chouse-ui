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
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';

import { Button } from '@/components/ui/button';
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
  const { data: logsData, isLoading, refetch } = useQuery({
    queryKey: ['rbac-audit-logs', page, actionFilter, dateRange],
    queryFn: () => rbacAuditApi.list({
      page,
      limit: 50,
      action: actionFilter !== 'all' ? actionFilter : undefined,
      startDate: dateRange.start?.toISOString(),
      endDate: dateRange.end?.toISOString(),
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

  const handleExport = () => {
    const url = rbacAuditApi.getExportUrl({
      action: actionFilter !== 'all' ? actionFilter : undefined,
      startDate: dateRange.start?.toISOString(),
      endDate: dateRange.end?.toISOString(),
    });
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-6">
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
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          {canExport && (
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
              <Download className="h-4 w-4" />
              Export CSV
            </Button>
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
          <SelectTrigger className="w-[200px] bg-white/5 border-white/10">
            <Filter className="h-4 w-4 mr-2" />
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
            <Button variant="outline" className="gap-2 bg-white/5 border-white/10">
              <Calendar className="h-4 w-4" />
              {dateRange.start
                ? `${format(dateRange.start, 'MMM d')} - ${dateRange.end ? format(dateRange.end, 'MMM d') : '...'}`
                : 'Date Range'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarComponent
              mode="range"
              selected={{ from: dateRange.start, to: dateRange.end }}
              onSelect={(range) => {
                setDateRange({ start: range?.from, end: range?.to });
                setPage(1);
              }}
              initialFocus
            />
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
          >
            Clear Filters
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
