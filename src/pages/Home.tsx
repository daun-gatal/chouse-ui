import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  Code2,
  Database,
  ExternalLink,
  FileCode,
  HardDrive,
  History,
  Layers,
  Lightbulb,
  Play,
  Plus,
  RefreshCw,
  Star,
  Table2,
  Terminal,
  Upload,
  Users,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useRecentQueries, useSavedQueries, useSystemStats, useDatabases } from "@/hooks";
import { useAuthStore } from "@/stores/auth";
import { useExplorerStore, type RecentItem } from "@/stores/explorer";
import { useWorkspaceStore, genTabId } from "@/stores/workspace";
import { useRbacStore } from "@/stores/rbac";
import { cn, formatCompactNumber } from "@/lib/utils";
import UploadFromFile from "@/features/explorer/components/UploadFile";

// ============================================
// Helpers (unchanged from previous version)
// ============================================

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// ============================================
// Editorial primitives (inline)
// ============================================

const LABEL_MONO = "font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint";
const LABEL_MONO_BOLDER = "font-mono text-[11px] uppercase tracking-[0.16em] text-paper-muted";

const EditorialCard: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <div
    className={cn(
      "flex flex-col rounded-md border border-ink-500 bg-ink-100",
      className
    )}
  >
    {children}
  </div>
);

const SectionHeader: React.FC<{
  eyebrowIndex?: string | number;
  eyebrow: string;
  title?: string;
  action?: React.ReactNode;
  className?: string;
}> = ({ eyebrowIndex, eyebrow, title, action, className }) => (
  <div className={cn("flex items-end justify-between gap-4", className)}>
    <div className="flex flex-col gap-2">
      <span className="inline-flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
        {eyebrowIndex !== undefined && (
          <span className="text-paper-faint">
            {String(eyebrowIndex).padStart(2, "0")}
          </span>
        )}
        <span className="h-px w-6 bg-ink-700" aria-hidden />
        <span>{eyebrow}</span>
      </span>
      {title && (
        <h2 className="text-lg font-semibold tracking-tight text-paper">{title}</h2>
      )}
    </div>
    {action}
  </div>
);

const MetricCell: React.FC<{
  label: string;
  value: string | number;
  icon: LucideIcon;
}> = ({ label, value, icon: Icon }) => (
  <div className="flex flex-col gap-2 border-b border-r border-ink-500 px-5 py-4">
    <div className="flex items-center justify-between">
      <span className={LABEL_MONO}>{label}</span>
      <Icon className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
    </div>
    <span className="font-mono text-[20px] font-semibold leading-none text-paper">
      {value}
    </span>
  </div>
);

const ActionCell: React.FC<{
  icon: LucideIcon;
  label: string;
  description: string;
  onClick: () => void;
}> = ({ icon: Icon, label, description, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="group flex flex-col gap-3 border-b border-r border-ink-500 px-5 py-5 text-left transition-colors hover:bg-ink-200"
  >
    <div className="flex items-center justify-between">
      <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted transition-colors group-hover:border-brand group-hover:text-brand">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <ArrowUpRight className="h-3.5 w-3.5 text-paper-faint transition-colors group-hover:text-paper" aria-hidden />
    </div>
    <div className="flex flex-col gap-1">
      <p className="text-[14px] font-semibold leading-tight text-paper">{label}</p>
      <p className="text-[12px] text-paper-muted">{description}</p>
    </div>
  </button>
);

const ListItem: React.FC<{
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: React.ReactNode;
  onClick?: () => void;
  actionIcon?: LucideIcon;
  interactive?: boolean;
  status?: "success" | "error";
}> = ({
  icon: Icon,
  title,
  subtitle,
  meta,
  badge,
  onClick,
  actionIcon: ActionIcon = ChevronRight,
  interactive = true,
  status,
}) => (
  <button
    type="button"
    onClick={interactive ? onClick : undefined}
    disabled={!interactive}
    className={cn(
      "flex w-full items-start gap-3 border-t border-ink-500 px-4 py-3 text-left transition-colors first:border-t-0",
      interactive && "hover:bg-ink-200 cursor-pointer",
      !interactive && "cursor-default"
    )}
  >
    <Icon
      className={cn(
        "mt-0.5 h-4 w-4 shrink-0",
        status === "success" && "text-emerald-400",
        status === "error" && "text-red-400",
        !status && "text-paper-dim"
      )}
      aria-hidden
    />
    <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
      <div className="flex items-center gap-2">
        <p className="truncate text-[13.5px] font-medium text-paper">{title}</p>
        {badge}
      </div>
      {(subtitle || meta) && (
        <div className="flex items-center gap-2 text-[11px] text-paper-muted">
          {subtitle && <span className="truncate font-mono">{subtitle}</span>}
          {subtitle && meta && <span className="text-paper-faint">·</span>}
          {meta && <span className="font-mono text-paper-faint">{meta}</span>}
        </div>
      )}
    </div>
    {interactive && (
      <ActionIcon className="mt-0.5 h-3.5 w-3.5 text-paper-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
    )}
  </button>
);

const EmptyState: React.FC<{
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ message, actionLabel, onAction }) => (
  <div className="flex h-full flex-col items-center justify-center gap-4 px-6 py-12 text-center">
    <p className="max-w-xs text-sm text-paper-muted">{message}</p>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted transition-colors hover:text-brand"
      >
        {actionLabel}
        <ArrowRight className="h-3 w-3" />
      </button>
    )}
  </div>
);

const TabToggle: React.FC<{
  options: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}> = ({ options, active, onChange }) => (
  <div className="inline-flex overflow-hidden rounded-xs border border-ink-500">
    {options.map((opt) => {
      const isActive = active === opt.id;
      return (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            "px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
            isActive ? "bg-ink-300 text-paper" : "bg-transparent text-paper-dim hover:text-paper"
          )}
          aria-pressed={isActive}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

const InlineLink: React.FC<{
  onClick?: () => void;
  href?: string;
  children: React.ReactNode;
  external?: boolean;
}> = ({ onClick, href, children, external }) => {
  const className =
    "inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted transition-colors hover:text-brand";
  if (href) {
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        className={className}
      >
        {children}
        <ArrowRight className="h-3 w-3" />
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
      <ArrowRight className="h-3 w-3" />
    </button>
  );
};

// ============================================
// Main page
// ============================================

export default function HomePage() {
  const navigate = useNavigate();
  const { isAdmin, username, activeConnectionId, activeConnectionName, version } = useAuthStore();
  const { favorites, recentItems, fetchFavorites, fetchRecentItems, expandNode, openUploadFileModal } = useExplorerStore();
  const { tabs, setActiveTab, addTab } = useWorkspaceStore();
  const { user: rbacUser } = useRbacStore();

  const { data: stats } = useSystemStats();
  const { data: databaseList = [] } = useDatabases();
  const usernameFilter = isAdmin ? undefined : username || undefined;
  const { data: recentQueries = [] } = useRecentQueries(10, usernameFilter);
  const { data: savedQueries = [] } = useSavedQueries(activeConnectionId || undefined);

  const filteredSavedQueries = useMemo(
    () => savedQueries.filter((sq) => sq.connectionId === activeConnectionId),
    [savedQueries, activeConnectionId]
  );

  const [tablesTab, setTablesTab] = useState<string>("favorites");
  const [refreshCooldown, setRefreshCooldown] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    fetchFavorites();
    fetchRecentItems(8);
  }, [fetchFavorites, fetchRecentItems]);

  const sqlTabs = useMemo(
    () => tabs.filter((tab) => tab.type === "sql" && typeof tab.content === "string" && tab.content.trim()),
    [tabs]
  );
  const unsavedTabs = useMemo(() => sqlTabs.filter((tab) => tab.isDirty), [sqlTabs]);

  const handleRefresh = () => {
    if (refreshCooldown) return;
    setRefreshCooldown(true);
    queryClient.invalidateQueries();
    fetchFavorites();
    fetchRecentItems(8);
    setTimeout(() => setRefreshCooldown(false), 3000);
  };

  const handleNewQuery = () => {
    const newTab = {
      id: genTabId(),
      title: "New Query",
      type: "sql" as const,
      content: "",
      isDirty: false,
    };
    addTab(newTab);
    navigate("/explorer");
  };

  const handleImport = () => {
    if (databaseList.length > 0) {
      openUploadFileModal(databaseList[0].name);
    }
  };

  const handleTableClick = (
    database: string,
    table?: string,
    targetConnectionId?: string | null,
    targetConnectionName?: string | null
  ) => {
    if (targetConnectionId && targetConnectionId !== activeConnectionId) {
      useAuthStore.getState().setActiveConnection(targetConnectionId, targetConnectionName);
      toast.success(`Switched to connection: ${targetConnectionName || "target connection"}`);
    }

    expandNode(database);

    const tabId = `info-${database}${table ? `-${table}` : ""}`;
    const existingTab = tabs.find(
      (t) =>
        t.type === "information" &&
        typeof t.content === "object" &&
        t.content.database === database &&
        t.content.table === table
    );

    if (existingTab) {
      setActiveTab(existingTab.id);
    } else {
      addTab({
        id: tabId,
        title: `Info: ${table || database}`,
        type: "information",
        content: { database, table },
      });
    }

    navigate("/explorer");
  };

  const handleSavedQueryClick = (query: string, name: string) => {
    const newTab = {
      id: genTabId(),
      title: name,
      type: "sql" as const,
      content: query,
      isDirty: false,
    };
    addTab(newTab);
    navigate("/explorer");
  };

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
    navigate("/explorer");
  };

  const userDisplayName = rbacUser?.displayName || rbacUser?.username || "User";
  const userInitials = userDisplayName
    .split(/\s+/)
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const tablesToShow = useMemo(() => {
    const items = tablesTab === "favorites" ? favorites : recentItems;
    return items.filter((item) => item.connectionId === activeConnectionId);
  }, [tablesTab, favorites, recentItems, activeConnectionId]);
  const greeting = getGreeting();

  return (
    <div className="h-full overflow-y-auto bg-ink-50">
      <UploadFromFile />

      <div className="mx-auto max-w-[1280px] px-6 py-10 md:px-10">
        {/* ─── Header ─── */}
        <header className="flex flex-col gap-6 border-b border-ink-500 pb-8 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-100 font-mono text-[13px] font-semibold tracking-tight text-paper">
              {userInitials || "·"}
            </div>
            <div className="flex flex-col gap-1">
              <span className={LABEL_MONO}>Workspace</span>
              <h1 className="text-2xl font-semibold tracking-tight text-paper">
                {greeting}, <span className="text-paper-dim">{userDisplayName}</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeConnectionName && (
              <div className="inline-flex items-center gap-3 rounded-xs border border-ink-500 bg-ink-100 px-3 py-2">
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                  <span className="font-mono text-[12px] text-paper">{activeConnectionName}</span>
                </span>
                {version && (
                  <>
                    <span className="h-3 w-px bg-ink-500" aria-hidden />
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
                      v{version}
                    </span>
                  </>
                )}
                {stats?.uptime !== undefined && stats.uptime > 0 && (
                  <>
                    <span className="h-3 w-px bg-ink-500" aria-hidden />
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
                      <Clock className="h-3 w-3" aria-hidden />
                      {formatUptime(stats.uptime)}
                    </span>
                  </>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshCooldown}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-xs border border-ink-500 text-paper-muted transition-colors",
                refreshCooldown
                  ? "cursor-not-allowed text-paper-faint"
                  : "hover:border-ink-700 hover:text-paper"
              )}
              title="Refresh all data"
              aria-label="Refresh"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshCooldown && "animate-spin")} />
            </button>
          </div>
        </header>

        {/* ─── Stats ─── */}
        {stats && (
          <section className="mt-10 flex flex-col gap-5" aria-label="Cluster metrics">
            <SectionHeader eyebrowIndex={1} eyebrow="Cluster" />
            <div className="grid grid-cols-2 border-l border-t border-ink-500 sm:grid-cols-3 lg:grid-cols-6">
              <MetricCell icon={Database} label="Databases" value={stats.databaseCount} />
              <MetricCell icon={Table2} label="Tables" value={stats.tableCount} />
              <MetricCell
                icon={Layers}
                label="Total rows"
                value={stats.totalRows !== undefined ? formatCompactNumber(stats.totalRows) : "0"}
              />
              <MetricCell icon={HardDrive} label="Storage" value={stats.totalSize} />
              <MetricCell icon={Users} label="Connections" value={stats.activeConnections} />
              <MetricCell icon={Zap} label="Active queries" value={stats.activeQueries} />
            </div>
          </section>
        )}

        {/* ─── Quick actions ─── */}
        <section className="mt-12 flex flex-col gap-5" aria-label="Quick actions">
          <SectionHeader eyebrowIndex={2} eyebrow="Start" />
          <div className="grid grid-cols-2 border-l border-t border-ink-500 md:grid-cols-4">
            <ActionCell
              icon={Plus}
              label="New query"
              description="Open SQL editor"
              onClick={handleNewQuery}
            />
            <ActionCell
              icon={Upload}
              label="Import"
              description="Upload CSV / TSV / JSON"
              onClick={handleImport}
            />
            <ActionCell
              icon={Activity}
              label="Monitor"
              description="Live metrics & queries"
              onClick={() => navigate("/monitoring/metrics")}
            />
            <ActionCell
              icon={History}
              label="Query history"
              description="Past executions"
              onClick={() => navigate("/monitoring/logs")}
            />
          </div>
        </section>

        {/* ─── Continue working ─── */}
        {unsavedTabs.length > 0 && (
          <section className="mt-12" aria-label="Unsaved work">
            <EditorialCard className="border-brand/30 bg-brand/[0.04]">
              <div className="flex items-center justify-between gap-4 border-b border-ink-500 px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-2 rounded-xs border border-brand/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-brand">
                    <Terminal className="h-3 w-3" />
                    Unsaved
                  </span>
                  <span className="text-[13.5px] font-medium text-paper">
                    Continue working
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
                    {unsavedTabs.length} {unsavedTabs.length === 1 ? "tab" : "tabs"}
                  </span>
                </div>
                <InlineLink onClick={() => navigate("/explorer")}>Open all</InlineLink>
              </div>
              <div className="flex flex-col">
                {unsavedTabs.slice(0, 3).map((tab) => (
                  <ListItem
                    key={tab.id}
                    icon={Terminal}
                    title={tab.title}
                    subtitle={typeof tab.content === "string" ? tab.content.slice(0, 60).trim() : ""}
                    onClick={() => handleTabClick(tab.id)}
                    actionIcon={ArrowRight}
                  />
                ))}
              </div>
            </EditorialCard>
          </section>
        )}

        {/* ─── Quick Access + Saved Queries ─── */}
        <section className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-2" aria-label="Personal workspace">
          {/* Quick Access */}
          <EditorialCard className="h-[440px]">
            <div className="flex items-center justify-between gap-4 border-b border-ink-500 px-5 py-3">
              <div className="flex items-center gap-3">
                {tablesTab === "favorites" ? (
                  <Star className="h-4 w-4 text-paper-muted" aria-hidden />
                ) : (
                  <History className="h-4 w-4 text-paper-muted" aria-hidden />
                )}
                <span className="text-[13.5px] font-medium text-paper">Quick access</span>
              </div>
              <TabToggle
                options={[
                  { id: "favorites", label: "Favorites" },
                  { id: "recent", label: "Recent" },
                ]}
                active={tablesTab}
                onChange={setTablesTab}
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {tablesToShow.length === 0 ? (
                <EmptyState
                  message={
                    tablesTab === "favorites"
                      ? "Star tables in Explorer for quick access."
                      : "Recently visited tables will appear here."
                  }
                  actionLabel="Browse explorer"
                  onAction={() => navigate("/explorer")}
                />
              ) : (
                <div className="flex flex-col">
                  {tablesToShow.map((item) => (
                    <ListItem
                      key={item.id}
                      icon={item.table ? Table2 : Database}
                      title={item.table || item.database}
                      subtitle={item.table ? item.database : undefined}
                      meta={
                        tablesTab === "recent"
                          ? formatRelativeTime((item as RecentItem).accessedAt)
                          : undefined
                      }
                      badge={
                        tablesTab === "favorites" ? (
                          <Star className="h-3 w-3 fill-brand text-brand" aria-hidden />
                        ) : undefined
                      }
                      onClick={() =>
                        handleTableClick(
                          item.database,
                          item.table,
                          item.connectionId,
                          item.connectionName
                        )
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </EditorialCard>

          {/* Saved Queries */}
          <EditorialCard className="h-[440px]">
            <div className="flex items-center justify-between gap-4 border-b border-ink-500 px-5 py-3">
              <div className="flex items-center gap-3">
                <FileCode className="h-4 w-4 text-paper-muted" aria-hidden />
                <span className="text-[13.5px] font-medium text-paper">Saved queries</span>
                {filteredSavedQueries.length > 0 && (
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
                    {filteredSavedQueries.length}
                  </span>
                )}
              </div>
              {filteredSavedQueries.length > 6 && (
                <InlineLink onClick={() => navigate("/explorer")}>View all</InlineLink>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredSavedQueries.length === 0 ? (
                <EmptyState
                  message="Save your frequently used queries for quick access."
                  actionLabel="Create query"
                  onAction={() => navigate("/explorer")}
                />
              ) : (
                <div className="flex flex-col">
                  {filteredSavedQueries.map((sq) => (
                    <ListItem
                      key={sq.id}
                      icon={FileCode}
                      title={sq.name}
                      subtitle={sq.query.slice(0, 60)}
                      badge={
                        sq.isPublic ? (
                          <span className="inline-flex items-center rounded-xs border border-emerald-700/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-emerald-300">
                            Public
                          </span>
                        ) : undefined
                      }
                      onClick={() => handleSavedQueryClick(sq.query, sq.name)}
                      actionIcon={Play}
                    />
                  ))}
                </div>
              )}
            </div>
          </EditorialCard>
        </section>

        {/* ─── Recent activity ─── */}
        <section className="mt-12 flex flex-col gap-5" aria-label="Recent activity">
          <SectionHeader
            eyebrowIndex={3}
            eyebrow="Recent activity"
            action={
              recentQueries.length > 0 ? (
                <InlineLink onClick={() => navigate("/monitoring/logs")}>View all</InlineLink>
              ) : undefined
            }
          />
          {recentQueries.length === 0 ? (
            <EditorialCard>
              <EmptyState
                message="Your query history will appear here."
                actionLabel="Run a query"
                onAction={() => navigate("/explorer")}
              />
            </EditorialCard>
          ) : (
            <div className="grid grid-cols-1 border-l border-t border-ink-500 md:grid-cols-2 lg:grid-cols-3">
              {recentQueries.slice(0, 6).map((q, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-2 border-b border-r border-ink-500 px-4 py-4"
                >
                  <div className="flex items-center justify-between">
                    {q.status === "Success" ? (
                      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" aria-hidden />
                        Success
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-red-400">
                        <XCircle className="h-3 w-3" aria-hidden />
                        Error
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-paper-faint">
                      {formatRelativeTime(new Date(q.time).getTime())}
                    </span>
                  </div>
                  <p
                    className="line-clamp-2 font-mono text-[12.5px] leading-relaxed text-paper-muted"
                    title={q.query}
                  >
                    {q.query.slice(0, 120)}
                  </p>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                    {(() => {
                      const d = Number(q.duration);
                      if (!Number.isFinite(d)) return "—";
                      return d < 1 ? "<1" : d.toFixed(0);
                    })()} ms
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ─── ClickHouse resources ─── */}
        <section className="mt-12 flex flex-col gap-5" aria-label="ClickHouse resources">
          <SectionHeader eyebrowIndex={4} eyebrow="Resources" />
          <div className="grid grid-cols-1 border-l border-t border-ink-500 md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: BookOpen,
                label: "Documentation",
                desc: "Official ClickHouse docs",
                href: "https://clickhouse.com/docs",
              },
              {
                icon: Code2,
                label: "SQL reference",
                desc: "Syntax & functions",
                href: "https://clickhouse.com/docs/en/sql-reference",
              },
              {
                icon: Lightbulb,
                label: "Best practices",
                desc: "Performance tips",
                href: "https://clickhouse.com/docs/en/operations/tips",
              },
              {
                icon: ExternalLink,
                label: "GitHub",
                desc: "Source & issues",
                href: "https://github.com/ClickHouse/ClickHouse",
              },
            ].map(({ icon: Icon, label, desc, href }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-4 border-b border-r border-ink-500 px-5 py-5 transition-colors hover:bg-ink-200"
              >
                <Icon
                  className="mt-0.5 h-4 w-4 shrink-0 text-paper-muted transition-colors group-hover:text-brand"
                  aria-hidden
                />
                <div className="flex flex-1 flex-col gap-1">
                  <p className="text-[14px] font-semibold leading-tight text-paper">{label}</p>
                  <p className="text-[12px] text-paper-muted">{desc}</p>
                </div>
                <ArrowUpRight
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-paper-faint transition-colors group-hover:text-paper"
                  aria-hidden
                />
              </a>
            ))}
          </div>
        </section>

        <div className="h-10" />
      </div>
    </div>
  );
}
