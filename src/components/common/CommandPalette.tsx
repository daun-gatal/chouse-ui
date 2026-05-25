import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Database,
  FileCode2,
  Gauge,
  Globe2,
  Home,
  Keyboard,
  LayoutGrid,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  UserCog,
  Users,
  Zap,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  useAuthStore,
  useExplorerStore,
  useRbacStore,
  useWorkspaceStore,
  RBAC_PERMISSIONS,
  genTabId,
} from "@/stores";
import { useRecentQueries } from "@/hooks";
import { rbacAuthApi, rbacConnectionsApi } from "@/api/rbac";
import { getSessionId } from "@/api/client";
import { cn } from "@/lib/utils";
import { log } from "@/lib/log";

// Maximum items per section — keeps the palette skim-able even on dense DBs.
const MAX_DATABASES = 8;
const MAX_TABLES = 12;
const MAX_RECENT = 5;
const MAX_SAVED = 8;

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Global Cmd/Ctrl+K palette. Searchable jump-to: pages, databases & tables,
 * saved queries, recent queries, actions. Permission-aware (items the user
 * can't access are hidden).
 */
export default function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { hasPermission } = useRbacStore();
  const databases = useExplorerStore((s) => s.databases);
  const savedQueries = useWorkspaceStore((s) => s.tabs);
  const addTab = useWorkspaceStore((s) => s.addTab);
  const activeConnectionId = useAuthStore((s) => s.activeConnectionId);

  const { data: recentQueries = [] } = useRecentQueries(10);

  // Close the palette and run the action — every item uses this so we don't
  // forget to dismiss anywhere.
  const runAction = (fn: () => void) => {
    onOpenChange(false);
    // Defer so the dialog close animation can start before navigation/state
    // change rips the dialog DOM out from under it.
    setTimeout(fn, 0);
  };

  const canViewFleet = hasPermission(RBAC_PERMISSIONS.CONNECTIONS_VIEW);
  const canViewExplorer = hasPermission(RBAC_PERMISSIONS.DB_VIEW) || hasPermission(RBAC_PERMISSIONS.TABLE_VIEW);
  const canViewMonitoring =
    hasPermission(RBAC_PERMISSIONS.LIVE_QUERIES_VIEW) ||
    hasPermission(RBAC_PERMISSIONS.METRICS_VIEW) ||
    hasPermission(RBAC_PERMISSIONS.QUERY_HISTORY_VIEW);
  const canViewAdmin =
    hasPermission(RBAC_PERMISSIONS.USERS_VIEW) ||
    hasPermission(RBAC_PERMISSIONS.ROLES_VIEW) ||
    hasPermission(RBAC_PERMISSIONS.AUDIT_VIEW);

  // Trim databases/tables to keep the palette skim-able.
  const databasesPreview = useMemo(() => databases.slice(0, MAX_DATABASES), [databases]);
  const tablesPreview = useMemo(() => {
    const out: { dbName: string; tableName: string }[] = [];
    for (const db of databases) {
      for (const t of db.children || []) {
        out.push({ dbName: db.name, tableName: t.name });
        if (out.length >= MAX_TABLES) return out;
      }
    }
    return out;
  }, [databases]);

  // Saved queries surfaced from the open workspace tabs. (Persisted ones live
  // in the Explorer Saved tab.)
  const savedPreview = useMemo(
    () => savedQueries.filter((t) => t.isSaved).slice(0, MAX_SAVED),
    [savedQueries],
  );

  const recentPreview = recentQueries.slice(0, MAX_RECENT);

  const handleLogout = async () => {
    try {
      const sessionId = getSessionId();
      if (sessionId) {
        try {
          await rbacConnectionsApi.disconnect(sessionId);
        } catch (e) {
          log.error("Failed to disconnect ClickHouse session on logout", e);
        }
      }
      await rbacAuthApi.logout();
    } catch (e) {
      log.error("Logout failed", e);
    } finally {
      useAuthStore.getState().clearConnectionInfo();
      navigate("/login");
    }
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages, databases, queries, actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Recent queries — only show when there's history */}
        {recentPreview.length > 0 && (
          <>
            <CommandGroup heading="Recent">
              {recentPreview.map((q, i) => (
                <CommandItem
                  key={`recent-${i}`}
                  value={`recent ${q.query}`}
                  onSelect={() =>
                    runAction(() => {
                      addTab({ id: genTabId(), title: "Recent query", type: "sql", content: q.query });
                      navigate("/explorer");
                    })
                  }
                >
                  <FileCode2 className="mr-2 h-3.5 w-3.5 text-paper-dim" />
                  <span className="truncate font-mono text-[12px] text-paper-muted">
                    {q.query.slice(0, 80)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {/* Pages */}
        <CommandGroup heading="Pages">
          {canViewFleet && (
            <CommandItem
              value="fleet clusters multi-cluster"
              onSelect={() => runAction(() => navigate("/fleet"))}
            >
              <Globe2 className="mr-2 h-3.5 w-3.5 text-paper-dim" />
              Fleet
              <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                All clusters
              </span>
            </CommandItem>
          )}

          <CommandItem value="overview home" onSelect={() => runAction(() => navigate("/overview"))}>
            <Home className="mr-2 h-3.5 w-3.5 text-paper-dim" />
            Overview
          </CommandItem>

          {canViewExplorer && (
            <CommandItem value="explorer databases" onSelect={() => runAction(() => navigate("/explorer"))}>
              <LayoutGrid className="mr-2 h-3.5 w-3.5 text-paper-dim" />
              Explorer
            </CommandItem>
          )}

          {canViewMonitoring && (
            <>
              <CommandItem
                value="monitoring live queries"
                onSelect={() => runAction(() => navigate("/monitoring/live-queries"))}
              >
                <Zap className="mr-2 h-3.5 w-3.5 text-paper-dim" />
                Monitoring · Live queries
              </CommandItem>
              <CommandItem
                value="monitoring logs query history"
                onSelect={() => runAction(() => navigate("/monitoring/logs"))}
              >
                <FileCode2 className="mr-2 h-3.5 w-3.5 text-paper-dim" />
                Monitoring · Query logs
              </CommandItem>
              <CommandItem
                value="monitoring metrics performance"
                onSelect={() => runAction(() => navigate("/monitoring/metrics"))}
              >
                <Gauge className="mr-2 h-3.5 w-3.5 text-paper-dim" />
                Monitoring · Metrics
              </CommandItem>
            </>
          )}

          {canViewAdmin && (
            <>
              <CommandItem value="admin users" onSelect={() => runAction(() => navigate("/admin/users"))}>
                <Users className="mr-2 h-3.5 w-3.5 text-paper-dim" />
                Admin · Users
              </CommandItem>
              <CommandItem value="admin roles" onSelect={() => runAction(() => navigate("/admin/roles"))}>
                <ShieldCheck className="mr-2 h-3.5 w-3.5 text-paper-dim" />
                Admin · Roles
              </CommandItem>
              <CommandItem
                value="admin connections clickhouse"
                onSelect={() => runAction(() => navigate("/admin/connections"))}
              >
                <Database className="mr-2 h-3.5 w-3.5 text-paper-dim" />
                Admin · Connections
              </CommandItem>
              <CommandItem
                value="admin clickhouse users"
                onSelect={() => runAction(() => navigate("/admin/clickhouse-users"))}
              >
                <Users className="mr-2 h-3.5 w-3.5 text-paper-dim" />
                Admin · ClickHouse users
              </CommandItem>
              <CommandItem
                value="admin ai models"
                onSelect={() => runAction(() => navigate("/admin/ai-models"))}
              >
                <Sparkles className="mr-2 h-3.5 w-3.5 text-paper-dim" />
                Admin · AI models
              </CommandItem>
              <CommandItem
                value="admin audit logs"
                onSelect={() => runAction(() => navigate("/admin/audit"))}
              >
                <FileCode2 className="mr-2 h-3.5 w-3.5 text-paper-dim" />
                Admin · Audit logs
              </CommandItem>
            </>
          )}

          <CommandItem value="preferences settings" onSelect={() => runAction(() => navigate("/preferences"))}>
            <UserCog className="mr-2 h-3.5 w-3.5 text-paper-dim" />
            Preferences
          </CommandItem>
        </CommandGroup>

        {/* Databases */}
        {canViewExplorer && databasesPreview.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Databases">
              {databasesPreview.map((db) => (
                <CommandItem
                  key={`db-${db.name}`}
                  value={`database ${db.name}`}
                  onSelect={() => runAction(() => navigate(`/explorer?db=${encodeURIComponent(db.name)}`))}
                >
                  <Database className="mr-2 h-3.5 w-3.5 text-paper-dim" />
                  <span className="font-mono text-[12px]">{db.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Tables — sampled from across databases */}
        {canViewExplorer && tablesPreview.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Tables">
              {tablesPreview.map(({ dbName, tableName }) => (
                <CommandItem
                  key={`table-${dbName}.${tableName}`}
                  value={`table ${dbName} ${tableName}`}
                  onSelect={() =>
                    runAction(() =>
                      navigate(
                        `/explorer?db=${encodeURIComponent(dbName)}&table=${encodeURIComponent(tableName)}`,
                      ),
                    )
                  }
                >
                  <Table2 className="mr-2 h-3.5 w-3.5 text-paper-dim" />
                  <span className="font-mono text-[12px]">
                    <span className="text-paper-faint">{dbName}.</span>
                    <span className="text-paper">{tableName}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Saved queries — from currently-open tabs that have been saved */}
        {savedPreview.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Saved queries (open tabs)">
              {savedPreview.map((tab) => (
                <CommandItem
                  key={`saved-${tab.id}`}
                  value={`saved ${tab.title}`}
                  onSelect={() =>
                    runAction(() => {
                      useWorkspaceStore.getState().setActiveTab(tab.id);
                      navigate("/explorer");
                    })
                  }
                >
                  <FileCode2 className="mr-2 h-3.5 w-3.5 text-paper-dim" />
                  <span className="truncate">{tab.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {/* Actions */}
        <CommandSeparator />
        <CommandGroup heading="Actions">
          {canViewExplorer && (
            <CommandItem
              value="new query"
              onSelect={() =>
                runAction(() => {
                  addTab({ id: genTabId(), title: "New Query", type: "sql", content: "" });
                  navigate("/explorer");
                })
              }
            >
              <Plus className="mr-2 h-3.5 w-3.5 text-paper-dim" />
              New query
            </CommandItem>
          )}

          <CommandItem
            value="refresh reload page"
            onSelect={() => runAction(() => window.location.reload())}
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5 text-paper-dim" />
            Refresh page
          </CommandItem>

          <CommandItem
            value="toggle dock mode floating sidebar"
            onSelect={() =>
              runAction(() => {
                window.dispatchEvent(new CustomEvent("dock:toggle-mode"));
              })
            }
          >
            <LayoutGrid className="mr-2 h-3.5 w-3.5 text-paper-dim" />
            Toggle dock mode (floating ↔ sidebar)
          </CommandItem>

          <CommandItem value="logout sign out" onSelect={() => runAction(handleLogout)}>
            <LogOut className="mr-2 h-3.5 w-3.5 text-paper-dim" />
            Log out
          </CommandItem>
        </CommandGroup>

        {/* Help */}
        <CommandSeparator />
        <CommandGroup heading="Help">
          <CommandItem
            value="keyboard shortcuts"
            onSelect={() =>
              runAction(() => {
                window.dispatchEvent(new CustomEvent("shortcuts:open"));
              })
            }
          >
            <Keyboard className="mr-2 h-3.5 w-3.5 text-paper-dim" />
            Keyboard shortcuts
          </CommandItem>
        </CommandGroup>
      </CommandList>

      {/* Footer with active connection + brand hint */}
      <div className="flex items-center justify-between border-t border-ink-500 bg-ink-200 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
        <span className="inline-flex items-center gap-1.5">
          <Search className="h-3 w-3" aria-hidden />
          Search
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                activeConnectionId
                  ? "bg-emerald-500 dark:bg-emerald-400"
                  : "bg-paper-faint",
              )}
            />
            {activeConnectionId ? "Connected" : "No connection"}
          </span>
          <span className="text-paper-faint">·</span>
          <kbd className="text-paper">↑↓</kbd> nav
          <span className="text-paper-faint">·</span>
          <kbd className="text-paper">↵</kbd> run
          <span className="text-paper-faint">·</span>
          <kbd className="text-paper">esc</kbd> close
        </span>
      </div>
    </CommandDialog>
  );
}
