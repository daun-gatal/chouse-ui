import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Database,
  Activity,
  ArrowRight,
  Terminal,
  Star,
  FileCode,
  Table2,
  Play,
  CheckCircle2,
  XCircle,
  Sparkles,
  History,
  ChevronRight,
  Plus,
  Upload,
  HardDrive,
  Layers,
  Users,
  Zap,
  ExternalLink,
  BookOpen,
  Code2,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { useRecentQueries, useSavedQueries, useSystemStats, useDatabases } from "@/hooks";
import { useAuthStore } from "@/stores/auth";
import { useExplorerStore, type RecentItem } from "@/stores/explorer";
import { useWorkspaceStore, genTabId } from "@/stores/workspace";
import { useRbacStore } from "@/stores/rbac";
import { cn } from "@/lib/utils";
import UploadFromFile from "@/features/explorer/components/UploadFile";

// --- Helper Functions ---

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

function formatNumber(num: number | string): string {
  const n = typeof num === "string" ? parseFloat(num) : num;
  if (isNaN(n)) return "0";
  if (n >= 1e12) return (n / 1e12).toFixed(1) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toLocaleString();
}

// --- Bento Card Base ---
const BentoCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  glowColor?: string;
  noHover?: boolean;
}> = ({ children, className, glowColor = "bg-blue-500/20", noHover = false }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    whileHover={noHover ? undefined : { scale: 1.005 }}
    transition={{ duration: 0.2 }}
    className={cn(
      "relative overflow-hidden rounded-2xl border border-white/10",
      "bg-gradient-to-br from-white/[0.07] to-white/[0.02] backdrop-blur-xl",
      "hover:border-white/20 transition-all duration-300",
      className
    )}
  >
    <div className={cn("absolute -top-20 -right-20 w-40 h-40 rounded-full blur-3xl opacity-30 pointer-events-none", glowColor)} />
    <div className="relative z-10 h-full">{children}</div>
  </motion.div>
);

// --- Stat Card (for server info) ---
const StatCard: React.FC<{
  icon: LucideIcon;
  label: string;
  value: string | number;
  color: string;
  bgColor: string;
}> = ({ icon: Icon, label, value, color, bgColor }) => (
  <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5">
    <div className={cn("p-2 rounded-lg", bgColor)}>
      <Icon className={cn("w-4 h-4", color)} />
    </div>
    <div className="min-w-0">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-bold text-white truncate">{value}</p>
    </div>
  </div>
);

// --- Quick Action Button ---
const QuickAction: React.FC<{
  icon: LucideIcon;
  label: string;
  description: string;
  onClick: () => void;
  color: string;
  bgColor: string;
}> = ({ icon: Icon, label, description, onClick, color, bgColor }) => (
  <motion.button
    whileHover={{ scale: 1.02, y: -2 }}
    whileTap={{ scale: 0.98 }}
    onClick={onClick}
    className="flex flex-col items-center gap-2 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/15 transition-all group"
  >
    <div className={cn("p-3 rounded-xl shadow-lg transition-transform group-hover:scale-110", bgColor)}>
      <Icon className={cn("w-5 h-5", color)} />
    </div>
    <div className="text-center">
      <p className="text-sm font-medium text-white">{label}</p>
      <p className="text-[10px] text-zinc-500">{description}</p>
    </div>
  </motion.button>
);

// --- List Item Base (Compact, Clickable) with smooth truncation ---
const ListItem: React.FC<{
  icon: LucideIcon;
  iconBgColor: string;
  iconColor: string;
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: React.ReactNode;
  onClick?: () => void;
  actionIcon?: LucideIcon;
  interactive?: boolean;
}> = ({ icon: Icon, iconBgColor, iconColor, title, subtitle, meta, badge, onClick, actionIcon: ActionIcon = ChevronRight, interactive = true }) => {
  return (
    <motion.button
      type="button"
      whileHover={interactive ? { x: 3 } : undefined}
      onClick={interactive ? onClick : undefined}
      disabled={!interactive}
      className={cn(
        "flex items-center gap-3 p-2.5 rounded-xl bg-white/5 border border-transparent transition-all text-left w-full group",
        interactive && "hover:bg-white/10 hover:border-white/10 cursor-pointer",
        !interactive && "cursor-default"
      )}
    >
      <div className={cn("p-2 rounded-lg transition-colors flex-shrink-0", iconBgColor, interactive && "group-hover:brightness-125")}>
        <Icon className={cn("w-4 h-4", iconColor)} />
      </div>
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <p className="text-sm font-medium text-zinc-200 truncate pr-4">{title}</p>
            <div className={cn("absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white/5 to-transparent pointer-events-none", interactive && "group-hover:from-white/10")} />
          </div>
          {badge && <div className="flex-shrink-0">{badge}</div>}
        </div>
        {(subtitle || meta) && (
          <div className="flex items-center gap-2 mt-0.5">
            {subtitle && (
              <div className="relative flex-1 min-w-0">
                <p className="text-xs text-zinc-500 font-mono truncate pr-4">{subtitle}</p>
                <div className={cn("absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white/5 to-transparent pointer-events-none", interactive && "group-hover:from-white/10")} />
              </div>
            )}
            {meta && <p className="text-[10px] text-zinc-600 flex-shrink-0 whitespace-nowrap">{meta}</p>}
          </div>
        )}
      </div>
      {interactive && <ActionIcon className="w-4 h-4 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />}
    </motion.button>
  );
};

// --- Section Header ---
const SectionHeader: React.FC<{
  icon: LucideIcon;
  title: string;
  iconColor: string;
  iconBgColor: string;
  count?: number;
  action?: React.ReactNode;
}> = ({ icon: Icon, title, iconColor, iconBgColor, count, action }) => (
  <div className="flex items-center justify-between mb-4">
    <div className="flex items-center gap-2.5">
      <div className={cn("p-1.5 rounded-lg", iconBgColor)}>
        <Icon className={cn("w-4 h-4", iconColor)} />
      </div>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {count !== undefined && count > 0 && (
        <Badge className={cn("text-[10px] px-1.5 py-0 h-4 border-0", iconBgColor, iconColor)}>
          {count}
        </Badge>
      )}
    </div>
    {action}
  </div>
);

// --- Empty State ---
const EmptyState: React.FC<{
  icon: LucideIcon;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ icon: Icon, message, actionLabel, onAction }) => (
  <div className="flex flex-col items-center justify-center py-8 text-center">
    <div className="p-3 rounded-full bg-white/5 mb-3">
      <Icon className="w-6 h-6 text-zinc-600" />
    </div>
    <p className="text-sm text-zinc-500 mb-3">{message}</p>
    {actionLabel && onAction && (
      <Button variant="ghost" size="sm" onClick={onAction} className="text-xs text-zinc-400 hover:text-white">
        {actionLabel} <ArrowRight className="w-3 h-3 ml-1" />
      </Button>
    )}
  </div>
);

// --- Tab Toggle ---
const TabToggle: React.FC<{
  options: { id: string; label: string; icon: LucideIcon; color: string }[];
  active: string;
  onChange: (id: string) => void;
}> = ({ options, active, onChange }) => (
  <div className="flex gap-1 p-1 rounded-lg bg-white/5">
    {options.map((opt) => (
      <button
        key={opt.id}
        onClick={() => onChange(opt.id)}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all",
          active === opt.id
            ? `bg-white/10 ${opt.color}`
            : "text-zinc-500 hover:text-zinc-300"
        )}
      >
        <opt.icon className="w-3 h-3" />
        {opt.label}
      </button>
    ))}
  </div>
);

// --- Main Page Component ---
export default function HomePage() {
  const navigate = useNavigate();
  const { isAdmin, username, activeConnectionId, activeConnectionName, version } = useAuthStore();
  const { favorites, recentItems, fetchFavorites, fetchRecentItems, expandNode, openUploadFileModal } = useExplorerStore();
  const { tabs, setActiveTab, addTab } = useWorkspaceStore();
  const { user: rbacUser } = useRbacStore();

  // Data hooks
  const { data: stats } = useSystemStats();
  const { data: databaseList = [] } = useDatabases();
  const usernameFilter = isAdmin ? undefined : username || undefined;
  const { data: recentQueries = [] } = useRecentQueries(10, usernameFilter);
  const { data: savedQueries = [] } = useSavedQueries(activeConnectionId || undefined);

  // UI State
  const [tablesTab, setTablesTab] = useState<string>("favorites");

  // Fetch data on mount
  useEffect(() => {
    fetchFavorites();
    fetchRecentItems(8);
  }, [fetchFavorites, fetchRecentItems]);

  // SQL tabs
  const sqlTabs = useMemo(
    () => tabs.filter((tab) => tab.type === "sql" && typeof tab.content === "string" && tab.content.trim()),
    [tabs]
  );
  const unsavedTabs = useMemo(() => sqlTabs.filter((tab) => tab.isDirty), [sqlTabs]);

  // Navigation handlers
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
    // Open import wizard directly without navigation
    if (databaseList.length > 0) {
      openUploadFileModal(databaseList[0].name);
    }
  };

  const handleTableClick = (database: string, table?: string) => {
    // Expand the database node in the tree
    expandNode(database);

    // Create info tab directly to avoid duplicate tabs from URL params
    const tabId = `info-${database}${table ? `-${table}` : ""}`;
    const existingTab = tabs.find(
      (t) => t.type === "information" &&
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
  const tablesToShow = tablesTab === "favorites" ? favorites : recentItems;
  const greeting = getGreeting();

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-[#0c0c14] via-[#0a0a10] to-[#08080c]">
      {/* Import Wizard Modal */}
      <UploadFromFile />

      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">{greeting}, {userDisplayName}</h1>
              <p className="text-sm text-zinc-500">What would you like to work on today?</p>
            </div>
          </div>

          {/* Connection Info */}
          {activeConnectionName && (
            <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-white/5 border border-white/10">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-sm font-medium text-white">{activeConnectionName}</span>
              </div>
              {version && (
                <>
                  <div className="w-px h-4 bg-white/20" />
                  <span className="text-xs text-zinc-500">v{version}</span>
                </>
              )}
              {stats?.uptime && (
                <>
                  <div className="w-px h-4 bg-white/20" />
                  <span className="text-xs text-zinc-500">up {formatUptime(stats.uptime)}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Server Stats Row */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <StatCard
              icon={Database}
              label="Databases"
              value={stats.databaseCount}
              color="text-indigo-400"
              bgColor="bg-indigo-500/20"
            />
            <StatCard
              icon={Table2}
              label="Tables"
              value={stats.tableCount}
              color="text-blue-400"
              bgColor="bg-blue-500/20"
            />
            <StatCard
              icon={Layers}
              label="Total Rows"
              value={formatNumber(stats.totalRows)}
              color="text-emerald-400"
              bgColor="bg-emerald-500/20"
            />
            <StatCard
              icon={HardDrive}
              label="Storage"
              value={stats.totalSize}
              color="text-amber-400"
              bgColor="bg-amber-500/20"
            />
            <StatCard
              icon={Users}
              label="Connections"
              value={stats.activeConnections}
              color="text-purple-400"
              bgColor="bg-purple-500/20"
            />
            <StatCard
              icon={Zap}
              label="Active Queries"
              value={stats.activeQueries}
              color="text-pink-400"
              bgColor="bg-pink-500/20"
            />
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <QuickAction
            icon={Plus}
            label="New Query"
            description="Open SQL editor"
            onClick={handleNewQuery}
            color="text-blue-400"
            bgColor="bg-gradient-to-br from-blue-500 to-blue-600"
          />
          <QuickAction
            icon={Upload}
            label="Import"
            description="Upload data"
            onClick={handleImport}
            color="text-amber-400"
            bgColor="bg-gradient-to-br from-amber-500 to-orange-600"
          />
          <QuickAction
            icon={Activity}
            label="Monitor"
            description="View performance"
            onClick={() => navigate("/monitoring?tab=metrics")}
            color="text-purple-400"
            bgColor="bg-gradient-to-br from-purple-500 to-pink-600"
          />
          <QuickAction
            icon={History}
            label="Query History"
            description="View past queries"
            onClick={() => navigate("/monitoring?tab=logs")}
            color="text-cyan-400"
            bgColor="bg-gradient-to-br from-cyan-500 to-teal-600"
          />
        </div>

        {/* Continue Working Banner */}
        {unsavedTabs.length > 0 && (
          <BentoCard glowColor="bg-amber-500/30" className="p-5">
            <SectionHeader
              icon={Terminal}
              title="Continue Working"
              iconColor="text-amber-400"
              iconBgColor="bg-amber-500/20"
              count={unsavedTabs.length}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/explorer")}
                  className="text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                >
                  Open All <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              }
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {unsavedTabs.slice(0, 3).map((tab) => (
                <ListItem
                  key={tab.id}
                  icon={Terminal}
                  iconBgColor="bg-amber-500/20"
                  iconColor="text-amber-400"
                  title={tab.title}
                  subtitle={typeof tab.content === "string" ? tab.content.slice(0, 40).trim() : ""}
                  badge={tab.isDirty ? <Badge className="text-[8px] px-1 py-0 h-3.5 bg-amber-500/20 text-amber-400 border-0 animate-pulse">Unsaved</Badge> : undefined}
                  onClick={() => handleTabClick(tab.id)}
                  actionIcon={ArrowRight}
                />
              ))}
            </div>
          </BentoCard>
        )}

        {/* Main Bento Grid - 2 columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Quick Access (Favorites/Recent) */}
          <BentoCard glowColor={tablesTab === "favorites" ? "bg-amber-500/30" : "bg-blue-500/30"} className="p-5">
            <SectionHeader
              icon={tablesTab === "favorites" ? Star : History}
              title="Quick Access"
              iconColor={tablesTab === "favorites" ? "text-amber-400" : "text-blue-400"}
              iconBgColor={tablesTab === "favorites" ? "bg-amber-500/20" : "bg-blue-500/20"}
              action={
                <TabToggle
                  options={[
                    { id: "favorites", label: "Favorites", icon: Star, color: "text-amber-400" },
                    { id: "recent", label: "Recent", icon: History, color: "text-blue-400" },
                  ]}
                  active={tablesTab}
                  onChange={setTablesTab}
                />
              }
            />
            {tablesToShow.length === 0 ? (
              <EmptyState
                icon={tablesTab === "favorites" ? Star : Table2}
                message={tablesTab === "favorites" ? "Star tables in Explorer for quick access" : "Recently visited tables will appear here"}
                actionLabel="Browse Explorer"
                onAction={() => navigate("/explorer")}
              />
            ) : (
              <div className="space-y-1.5">
                {tablesToShow.slice(0, 6).map((item) => (
                  <ListItem
                    key={item.id}
                    icon={item.table ? Table2 : Database}
                    iconBgColor={item.table ? "bg-blue-500/20" : "bg-indigo-500/20"}
                    iconColor={item.table ? "text-blue-400" : "text-indigo-400"}
                    title={item.table || item.database}
                    subtitle={item.table ? item.database : undefined}
                    meta={tablesTab === "recent" ? formatRelativeTime((item as RecentItem).accessedAt) : undefined}
                    badge={tablesTab === "favorites" ? <Star className="w-3 h-3 text-amber-400 fill-amber-400" /> : undefined}
                    onClick={() => handleTableClick(item.database, item.table)}
                  />
                ))}
              </div>
            )}
          </BentoCard>

          {/* Saved Queries */}
          <BentoCard glowColor="bg-purple-500/30" className="p-5">
            <SectionHeader
              icon={FileCode}
              title="Saved Queries"
              iconColor="text-purple-400"
              iconBgColor="bg-purple-500/20"
              count={savedQueries.length}
              action={
                savedQueries.length > 6 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("/explorer")}
                    className="text-xs text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
                  >
                    View All <ArrowRight className="w-3 h-3 ml-1" />
                  </Button>
                )
              }
            />
            {savedQueries.length === 0 ? (
              <EmptyState
                icon={FileCode}
                message="Save your frequently used queries for quick access"
                actionLabel="Create Query"
                onAction={() => navigate("/explorer")}
              />
            ) : (
              <div className="space-y-1.5">
                {savedQueries.slice(0, 6).map((sq) => (
                  <ListItem
                    key={sq.id}
                    icon={FileCode}
                    iconBgColor="bg-purple-500/20"
                    iconColor="text-purple-400"
                    title={sq.name}
                    subtitle={sq.query.slice(0, 50)}
                    badge={sq.isPublic ? <Badge className="text-[8px] px-1 py-0 h-3.5 bg-emerald-500/20 text-emerald-400 border-0">Public</Badge> : undefined}
                    onClick={() => handleSavedQueryClick(sq.query, sq.name)}
                    actionIcon={Play}
                  />
                ))}
              </div>
            )}
          </BentoCard>
        </div>

        {/* Recent Activity - Full Width at Bottom */}
        <BentoCard glowColor="bg-emerald-500/30" className="p-5" noHover>
          <SectionHeader
            icon={Activity}
            title="Recent Activity"
            iconColor="text-emerald-400"
            iconBgColor="bg-emerald-500/20"
            action={
              recentQueries.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/monitoring?tab=logs")}
                  className="text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                >
                  View All <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              )
            }
          />
          {recentQueries.length === 0 ? (
            <EmptyState
              icon={Terminal}
              message="Your query history will appear here"
              actionLabel="Run a Query"
              onAction={() => navigate("/explorer")}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {recentQueries.slice(0, 6).map((q, i) => (
                <ListItem
                  key={i}
                  icon={q.status === "Success" ? CheckCircle2 : XCircle}
                  iconBgColor={q.status === "Success" ? "bg-emerald-500/20" : "bg-red-500/20"}
                  iconColor={q.status === "Success" ? "text-emerald-400" : "text-red-400"}
                  title={q.query.slice(0, 60)}
                  subtitle={`${q.duration < 1 ? "<1" : q.duration.toFixed(0)}ms`}
                  meta={formatRelativeTime(new Date(q.time).getTime())}
                  interactive={false}
                />
              ))}
            </div>
          )}
        </BentoCard>

        {/* ClickHouse Resources */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <a
            href="https://clickhouse.com/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/15 transition-all group"
          >
            <div className="p-2 rounded-lg bg-blue-500/20 group-hover:bg-blue-500/30 transition-colors">
              <BookOpen className="w-4 h-4 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-200">Documentation</p>
              <p className="text-[10px] text-zinc-500">Official ClickHouse docs</p>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
          </a>

          <a
            href="https://clickhouse.com/docs/en/sql-reference"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/15 transition-all group"
          >
            <div className="p-2 rounded-lg bg-purple-500/20 group-hover:bg-purple-500/30 transition-colors">
              <Code2 className="w-4 h-4 text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-200">SQL Reference</p>
              <p className="text-[10px] text-zinc-500">Syntax & functions</p>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
          </a>

          <a
            href="https://clickhouse.com/docs/en/operations/tips"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/15 transition-all group"
          >
            <div className="p-2 rounded-lg bg-amber-500/20 group-hover:bg-amber-500/30 transition-colors">
              <Lightbulb className="w-4 h-4 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-200">Best Practices</p>
              <p className="text-[10px] text-zinc-500">Performance tips</p>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
          </a>

          <a
            href="https://github.com/ClickHouse/ClickHouse"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/15 transition-all group"
          >
            <div className="p-2 rounded-lg bg-emerald-500/20 group-hover:bg-emerald-500/30 transition-colors">
              <Zap className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-200">GitHub</p>
              <p className="text-[10px] text-zinc-500">Source & issues</p>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
          </a>
        </div>
      </div>
    </div>
  );
}

// --- Greeting helper ---
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
