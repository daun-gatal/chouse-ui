/**
 * RBAC Audit Logs Component
 * 
 * Displays audit logs with filtering and export capabilities.
 */

import React, { useState } from 'react';
import {
  FileText,
  RefreshCw,
  CheckCircle,
  XCircle,
  Calendar,
  Filter,
  User,
  X,
  Mail,
  User as UserIcon,
  Activity,
  Info,
  Globe,
  Monitor,
  Smartphone,
  Tablet,
  Bot,
  MapPin,
  Clock,
  Layers,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { format, subDays, startOfToday, endOfToday, startOfYesterday, endOfYesterday } from 'date-fns';

import { Button, buttonVariants } from '@/components/ui/button';
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { rbacAuditApi, type RbacAuditLog } from '@/api/rbac';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores/rbac';
import { cn } from '@/lib/utils';
import { RbacAuditPruneDialog } from './RbacAuditPruneDialog';
import { RbacAuditExportDialog } from './RbacAuditExportDialog';

// ============================================
// Action Categories
// ============================================
// Editorial: all category badges use uniform hairline + mono uppercase.
// The category itself encodes meaning; no per-category color needed.

const ACTION_BADGE = 'inline-flex items-center rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted';

const DeviceIcon: React.FC<{ type?: string | null; className?: string }> = ({ type, className = 'h-3 w-3' }) => {
  switch (type) {
    case 'Mobile': return <Smartphone className={className} />;
    case 'Tablet': return <Tablet className={className} />;
    case 'Bot': return <Bot className={className} />;
    case 'Desktop': return <Monitor className={className} />;
    default: return <Monitor className={className} />;
  }
};

// ============================================
// Component
// ============================================

export const RbacAuditLogs: React.FC = () => {
  const { hasPermission } = useRbacStore();

  // State
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [usernameFilter, setUsernameFilter] = useState('');
  const [emailFilter, setEmailFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed' | 'failure'>('all');
  const [dateRange, setDateRange] = useState<{ start?: Date; end?: Date }>({});

  // Queries
  const { data: logsData, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['rbac-audit-logs', page, actionFilter, usernameFilter, emailFilter, statusFilter, dateRange],
    queryFn: () => rbacAuditApi.list({
      page,
      limit: 50,
      action: actionFilter !== 'all' ? actionFilter : undefined,
      username: usernameFilter || undefined,
      email: emailFilter || undefined,
      status: statusFilter !== 'all' ? statusFilter : undefined,
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

  const { data: metadataData } = useQuery({
    queryKey: ['rbac-audit-metadata'],
    queryFn: () => rbacAuditApi.getMetadata(),
  });

  const logs = logsData?.logs || [];
  const total = logsData?.total || 0;
  const totalPages = Math.ceil(total / 50);
  const actions = actionsData?.groupedActions || {};
  const stats = statsData?.stats;
  const metadata = metadataData || { usernames: [], emails: [], statuses: [] };

  const canExport = hasPermission(RBAC_PERMISSIONS.AUDIT_EXPORT);



  const canDelete = hasPermission(RBAC_PERMISSIONS.AUDIT_DELETE);


  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            <FileText className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[18px] font-semibold tracking-tight text-paper">Audit logs</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
              {total} total events
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
          {canExport && (
            <RbacAuditExportDialog
              actionFilter={actionFilter}
              usernameFilter={usernameFilter}
              emailFilter={emailFilter}
              statusFilter={statusFilter}
              dateRange={dateRange}
            />
          )}

          {canDelete && (
            <RbacAuditPruneDialog
              onPruneSuccess={() => refetch()}
              actionFilter={actionFilter}
              usernameFilter={usernameFilter}
              emailFilter={emailFilter}
              statusFilter={statusFilter}
              dateRange={dateRange}
            />
          )}
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-4 overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
          <div className="border-r border-ink-500 p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Last 24 hours</p>
            <p className="mt-2 font-mono text-[22px] font-semibold tabular-nums text-paper">{stats.last24Hours}</p>
          </div>
          <div className="border-r border-ink-500 p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Successful</p>
            <p className="mt-2 font-mono text-[22px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{stats.byStatus.success || 0}</p>
          </div>
          <div className="border-r border-ink-500 p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Failed</p>
            <p className="mt-2 font-mono text-[22px] font-semibold tabular-nums text-red-700 dark:text-red-300">
              {(stats.byStatus.failed || 0) + (stats.byStatus.failure || 0)}
            </p>
          </div>
          <div className="p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Logins</p>
            <p className="mt-2 font-mono text-[22px] font-semibold tabular-nums text-paper">
              {(stats.byAction['auth.login'] || 0) + (stats.byAction['auth.login_failed'] || 0)}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={usernameFilter} onValueChange={(v) => { setUsernameFilter(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="relative h-9 w-[160px] rounded-xs border-ink-500 bg-ink-100 text-paper hover:border-ink-700 hover:bg-ink-200">
            <UserIcon className="mr-2 h-3.5 w-3.5 text-paper-dim" />
            <SelectValue placeholder="Username" />
            {usernameFilter && (
              <span className="absolute right-8 top-1/2 -translate-y-1/2" onClick={(e) => {
                e.stopPropagation();
                setUsernameFilter('');
                setPage(1);
              }}>
                <X className="h-3 w-3 text-paper-dim hover:text-paper" />
              </span>
            )}
          </SelectTrigger>
          <SelectContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
            <SelectItem value="all">All usernames</SelectItem>
            {metadata.usernames.map((username) => (
              <SelectItem key={username} value={username}>{username}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={emailFilter} onValueChange={(v) => { setEmailFilter(v === 'all' ? '' : v); setPage(1); }}>
          <SelectTrigger className="relative h-9 w-[180px] rounded-xs border-ink-500 bg-ink-100 text-paper hover:border-ink-700 hover:bg-ink-200">
            <Mail className="mr-2 h-3.5 w-3.5 text-paper-dim" />
            <SelectValue placeholder="Email" />
            {emailFilter && (
              <span className="absolute right-8 top-1/2 -translate-y-1/2" onClick={(e) => {
                e.stopPropagation();
                setEmailFilter('');
                setPage(1);
              }}>
                <X className="h-3 w-3 text-paper-dim hover:text-paper" />
              </span>
            )}
          </SelectTrigger>
          <SelectContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
            <SelectItem value="all">All emails</SelectItem>
            {metadata.emails.map((email) => (
              <SelectItem key={email} value={email}>{email}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v: any) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="h-9 w-[130px] rounded-xs border-ink-500 bg-ink-100 text-paper hover:border-ink-700 hover:bg-ink-200">
            <Activity className="mr-2 h-3.5 w-3.5 text-paper-dim" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
            <SelectItem value="all">All status</SelectItem>
            {metadata.statuses.map((status) => (
              <SelectItem key={status} value={status}>
                {status === 'success' ? 'Success' : (status === 'failed' || status === 'failure') ? 'Failed' : status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1); }}>
          <SelectTrigger className="h-9 w-[180px] rounded-xs border-ink-500 bg-ink-100 text-paper hover:border-ink-700 hover:bg-ink-200">
            <Filter className="mr-2 h-3.5 w-3.5 text-paper-dim" />
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
            <SelectItem value="all">All actions</SelectItem>
            {Object.entries(actions).map(([category, categoryActions]) => (
              <React.Fragment key={category}>
                <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">{category}</div>
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
            <Button variant="outline" className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 text-paper hover:border-ink-700 hover:bg-ink-200">
              <Calendar className="h-3.5 w-3.5 text-paper-dim" />
              {dateRange.start ? (
                dateRange.end && format(dateRange.start, 'MMM d, yyyy') !== format(dateRange.end, 'MMM d, yyyy')
                  ? `${format(dateRange.start, 'MMM d')} - ${format(dateRange.end, 'MMM d, yyyy')}`
                  : format(dateRange.start, 'MMM d, yyyy')
              ) : 'Date range'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto rounded-xs border border-ink-500 bg-ink-100 p-0" align="start">
            <div className="flex h-auto">
              {/* Presets Sidebar */}
              <div className="flex w-40 flex-col gap-1 border-r border-ink-500 bg-ink-200 p-3">
                <p className="mb-2 px-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">Presets</p>
                {[
                  { label: 'Today', getValue: () => ({ start: startOfToday(), end: endOfToday() }) },
                  { label: 'Yesterday', getValue: () => ({ start: startOfYesterday(), end: endOfYesterday() }) },
                  { label: 'Last 7 days', getValue: () => ({ start: subDays(new Date(), 7), end: new Date() }) },
                  { label: 'Last 30 days', getValue: () => ({ start: subDays(new Date(), 30), end: new Date() }) },
                  { label: 'All time', getValue: () => ({ start: undefined, end: undefined }) },
                ].map((preset) => (
                  <Button
                    key={preset.label}
                    variant="ghost"
                    size="sm"
                    className="h-8 w-full justify-start rounded-xs font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-100 hover:text-paper"
                    onClick={() => {
                      const range = preset.getValue();
                      setDateRange(range);
                      setPage(1);
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}

                <div className="mt-auto border-t border-ink-500 pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-full justify-start rounded-xs font-mono text-[11px] uppercase tracking-[0.14em] text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                    onClick={() => {
                      setDateRange({});
                      setPage(1);
                    }}
                  >
                    Clear filter
                  </Button>
                </div>
              </div>

              {/* Calendar Section */}
              <div className="min-w-[340px] flex-1 bg-ink-100 p-6">
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
                    caption_label: "font-mono text-[11px] font-semibold text-paper uppercase tracking-[0.18em]",
                    nav: "space-x-1 flex items-center",
                    button_previous: cn(
                      buttonVariants({ variant: "outline" }),
                      "h-8 w-8 rounded-xs border-ink-500 bg-ink-100 p-0 text-paper-dim hover:border-ink-700 hover:bg-ink-200 hover:text-paper"
                    ),
                    button_next: cn(
                      buttonVariants({ variant: "outline" }),
                      "h-8 w-8 rounded-xs border-ink-500 bg-ink-100 p-0 text-paper-dim hover:border-ink-700 hover:bg-ink-200 hover:text-paper"
                    ),
                    month_grid: "w-full border-collapse select-none",
                    weekdays: "grid grid-cols-7 w-full mb-4 px-1",
                    weekday: "text-paper-faint font-mono uppercase text-[10px] tracking-[0.18em] text-center flex items-center justify-center h-8",
                    week: "grid grid-cols-7 w-full mt-1 px-1",
                    day: "h-11 w-full text-center text-sm p-0 relative flex items-center justify-center",
                    day_button: cn(
                      buttonVariants({ variant: "ghost" }),
                      "h-10 w-10 p-0 font-medium text-paper-muted hover:bg-ink-200 hover:text-paper rounded-xs transition-all flex items-center justify-center text-[13px] tabular-nums"
                    ),
                    selected: "!bg-brand !text-ink-50 hover:!bg-brand-soft focus:!bg-brand rounded-xs opacity-100 border-none",
                    today: "border border-brand/50 text-brand font-semibold rounded-xs bg-brand/5",
                    outside: "text-paper-faint opacity-30",
                    range_middle: "aria-selected:bg-brand/10 aria-selected:text-brand !rounded-none",
                  }}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {(dateRange.start || actionFilter !== 'all' || usernameFilter || emailFilter || statusFilter !== 'all') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActionFilter('all');
              setUsernameFilter('');
              setEmailFilter('');
              setStatusFilter('all');
              setDateRange({});
              setPage(1);
            }}
            className="h-9 gap-2 rounded-xs px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper"
          >
            <X className="h-3.5 w-3.5" />
            Reset
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xs border border-ink-500 bg-ink-100">
        <Table className="min-w-[1200px]">
          <TableHeader>
            <TableRow className="border-ink-500 hover:bg-transparent">
              <TableHead className="w-[180px] whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Timestamp</TableHead>
              <TableHead className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Action</TableHead>
              <TableHead className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Display name</TableHead>
              <TableHead className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Username</TableHead>
              <TableHead className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Email</TableHead>
              <TableHead className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Resource</TableHead>
              <TableHead className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Status</TableHead>
              <TableHead className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Client info</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i} className="border-ink-500">
                  <TableCell><Skeleton className="h-4 w-32 bg-ink-200" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-24 bg-ink-200" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24 bg-ink-200" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20 bg-ink-200" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32 bg-ink-200" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28 bg-ink-200" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-16 bg-ink-200" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24 bg-ink-200" /></TableCell>
                </TableRow>
              ))
            ) : logs.length === 0 ? (
              <TableRow className="border-ink-500">
                <TableCell colSpan={8} className="py-8 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">
                  No audit logs found
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => {
                return (
                  <TableRow key={log.id} className="border-ink-500 hover:bg-ink-200">
                    <TableCell className="font-mono text-[12px] text-paper-dim">
                      {format(new Date(log.createdAt), 'MMM d, HH:mm:ss')}
                    </TableCell>
                    <TableCell>
                      <span className={ACTION_BADGE}>
                        {log.action}
                      </span>
                    </TableCell>
                    <TableCell className="text-paper">
                      {log.displayNameSnapshot ? (
                        <div className="flex items-center gap-2">
                          <User className="h-3 w-3 text-paper-dim" />
                          <span className="text-[13px] font-medium">{log.displayNameSnapshot}</span>
                        </div>
                      ) : (
                        <span className="text-paper-faint">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-[12px] text-paper-muted">
                      {log.usernameSnapshot || (log.userId ? log.userId.slice(0, 8) + '…' : '—')}
                    </TableCell>
                    <TableCell className="text-[12px] text-paper-muted">
                      {log.emailSnapshot || '—'}
                    </TableCell>
                    <TableCell className="font-mono text-[12px] text-paper-muted">
                      {log.resourceType ? (
                        <span>
                          {log.resourceType}
                          {log.resourceId && (
                            <span className="text-paper-faint">/{log.resourceId.slice(0, 8)}…</span>
                          )}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {log.status === 'success' ? (
                        <span className="inline-flex items-center gap-1 rounded-xs border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <CheckCircle className="h-3 w-3" />
                          Success
                        </span>
                      ) : (log.status === 'failed' || log.status === 'failure') ? (
                        <span className="inline-flex items-center gap-1 rounded-xs border border-red-300 bg-red-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                          <XCircle className="h-3 w-3" />
                          Failed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                          <Info className="h-3 w-3" />
                          Unknown
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="min-w-[180px] cursor-help space-y-1">
                              {(log.browser || log.os) ? (
                                <>
                                  {/* Row 1: device icon + browser + OS */}
                                  <div className="flex items-center gap-1.5 text-[13px] text-paper">
                                    <DeviceIcon type={log.deviceType} className="h-3.5 w-3.5 shrink-0 text-paper-dim" />
                                    <span className="truncate">
                                      {[log.browser, log.browserVersion].filter(Boolean).join(' ')}
                                      {log.os && (
                                        <span className="text-paper-muted">
                                          {' · '}{[log.os, log.osVersion].filter(Boolean).join(' ')}
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                  {/* Row 2: device model (mobile/tablet only) */}
                                  {log.deviceModel && (
                                    <div className="flex items-center gap-1 text-[11px] text-paper-muted">
                                      <Layers className="h-3 w-3 shrink-0" />
                                      <span className="truncate">{log.deviceModel}</span>
                                      {log.architecture && (
                                        <span className="ml-1 rounded-xs border border-ink-500 bg-ink-200 px-1 font-mono text-[10px] text-paper-faint">
                                          {log.architecture}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {/* Row 3: geo + locale + IP */}
                                  <div className="flex items-center gap-2 text-[11px] text-paper-faint">
                                    {(log.country || log.city) && (
                                      <span className="flex items-center gap-0.5">
                                        <Globe className="h-3 w-3 shrink-0" />
                                        {[log.city, log.country].filter(Boolean).join(', ')}
                                      </span>
                                    )}
                                    {log.language && <span>{log.language}</span>}
                                    {log.ipAddress && (
                                      <span className="max-w-[110px] truncate font-mono">{log.ipAddress}</span>
                                    )}
                                  </div>
                                </>
                              ) : (
                                <span className="font-mono text-[12px] text-paper-faint">{log.ipAddress || '—'}</span>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-[360px] rounded-xs border border-ink-500 bg-ink-100 p-3">
                            <div className="space-y-3 text-[12px]">
                              {/* Browser & OS */}
                              {(log.browser || log.os || log.deviceType) && (
                                <div className="space-y-1.5">
                                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-dim">Client</p>
                                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                                    {log.deviceType && (
                                      <>
                                        <span className="text-paper-faint">Device</span>
                                        <span className="flex items-center gap-1 text-paper">
                                          <DeviceIcon type={log.deviceType} className="h-3 w-3 text-paper-dim" />
                                          {log.deviceType}
                                        </span>
                                      </>
                                    )}
                                    {log.deviceModel && (
                                      <>
                                        <span className="text-paper-faint">Model</span>
                                        <span className="text-paper">{log.deviceModel}</span>
                                      </>
                                    )}
                                    {log.architecture && (
                                      <>
                                        <span className="text-paper-faint">Arch</span>
                                        <span className="font-mono text-paper">{log.architecture}</span>
                                      </>
                                    )}
                                    {log.browser && (
                                      <>
                                        <span className="text-paper-faint">Browser</span>
                                        <span className="text-paper">
                                          {log.browser}{log.browserVersion && <span className="text-paper-muted"> {log.browserVersion}</span>}
                                        </span>
                                      </>
                                    )}
                                    {log.os && (
                                      <>
                                        <span className="text-paper-faint">OS</span>
                                        <span className="text-paper">
                                          {log.os}{log.osVersion && <span className="text-paper-muted"> {log.osVersion}</span>}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}
                              {/* Geo */}
                              {(log.country || log.city || log.countryRegion || log.timezone || log.language) && (
                                <div className="space-y-1.5">
                                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-dim">Location</p>
                                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                                    {log.city && (
                                      <>
                                        <span className="flex items-center gap-1 text-paper-faint"><MapPin className="h-3 w-3" />City</span>
                                        <span className="text-paper">{log.city}</span>
                                      </>
                                    )}
                                    {(log.country || log.countryRegion) && (
                                      <>
                                        <span className="flex items-center gap-1 text-paper-faint"><Globe className="h-3 w-3" />Country</span>
                                        <span className="text-paper">
                                          {[log.country, log.countryRegion].filter(Boolean).join(' / ')}
                                        </span>
                                      </>
                                    )}
                                    {log.timezone && (
                                      <>
                                        <span className="flex items-center gap-1 text-paper-faint"><Clock className="h-3 w-3" />TZ</span>
                                        <span className="font-mono text-paper">{log.timezone}</span>
                                      </>
                                    )}
                                    {log.language && (
                                      <>
                                        <span className="text-paper-faint">Lang</span>
                                        <span className="text-paper">{log.language}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}
                              {/* Network */}
                              {log.ipAddress && (
                                <div className="space-y-1.5">
                                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-dim">Network</p>
                                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                                    <span className="text-paper-faint">IP</span>
                                    <span className="font-mono text-paper">{log.ipAddress}</span>
                                  </div>
                                </div>
                              )}
                              {/* Raw UA */}
                              {log.userAgent && (
                                <div className="space-y-1 border-t border-ink-500 pt-1">
                                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-dim">User-agent</p>
                                  <p className="break-all font-mono text-[10px] leading-relaxed text-paper-muted">{log.userAgent}</p>
                                </div>
                              )}
                              {!log.browser && !log.os && !log.country && !log.ipAddress && !log.userAgent && (
                                <p className="text-paper-faint">No client data available</p>
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
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
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
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
