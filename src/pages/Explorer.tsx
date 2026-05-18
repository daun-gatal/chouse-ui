import React, { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ChevronRight, Database, Layers, PanelLeftClose, PanelLeftOpen, Table2 } from "lucide-react";
import DatabaseExplorer from "@/features/explorer/components/DataExplorer";
import WorkspaceTabs from "@/features/workspace/components/WorkspaceTabs";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { PanelGroupStorage, ImperativePanelHandle } from "react-resizable-panels";
import CreateTable from "@/features/explorer/components/CreateTable";
import CreateDatabase from "@/features/explorer/components/CreateDatabase";
import UploadFromFile from "@/features/explorer/components/UploadFile";
import AlterTable from "@/features/explorer/components/AlterTable";
import { useDatabases } from "@/hooks";
import { cn } from "@/lib/utils";
import { useExplorerStore } from "@/stores/explorer";
import { useRbacStore } from "@/stores/rbac";
import { rbacUserPreferencesApi } from "@/api/rbac";
import { log } from "@/lib/log";

const ExplorerPage = () => {
  const { data: databases = [] } = useDatabases();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { fetchFavorites, fetchRecentItems, fetchPreferences } = useExplorerStore();
  const { isAuthenticated } = useRbacStore();

  const [leftPanelSize, setLeftPanelSize] = useState(35);
  const [rightPanelSize, setRightPanelSize] = useState(65);
  const [hasFetchedPanelSizes, setHasFetchedPanelSizes] = useState(false);
  const panelGroupRef = useRef<{ getPanelGroup: () => PanelGroupStorage | null } | null>(null);
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const toggleSidebar = () => {
    const panel = sidebarPanelRef.current;
    if (panel) {
      if (isSidebarCollapsed) {
        panel.expand();
      } else {
        panel.collapse();
      }
    }
  };

  const currentDatabase = searchParams.get("database") || "";
  const currentTable = searchParams.get("table") || "";

  const databaseCount = databases.length;
  const tableCount = databases.reduce((acc, db) => acc + (db.children?.length || 0), 0);

  useEffect(() => {
    const title = currentTable
      ? `CHouse UI | ${currentDatabase}.${currentTable}`
      : currentDatabase
        ? `CHouse UI | ${currentDatabase}`
        : "CHouse UI | Explorer";
    document.title = title;
  }, [currentDatabase, currentTable]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchFavorites().catch((e) => log.error("Fetch favorites failed", e));
      fetchRecentItems().catch((e) => log.error("Fetch recent items failed", e));
      fetchPreferences().catch((e) => log.error("Fetch preferences failed", e));
    }
  }, [isAuthenticated, fetchFavorites, fetchRecentItems, fetchPreferences]);

  useEffect(() => {
    if (!isAuthenticated || hasFetchedPanelSizes) {
      return;
    }

    const fetchPanelSizes = async (): Promise<void> => {
      try {
        const preferences = await rbacUserPreferencesApi.getPreferences();
        const panelSizes = preferences.workspacePreferences?.panelSizes as
          | { explorer?: { left?: number; right?: number } }
          | undefined;

        if (panelSizes?.explorer) {
          if (typeof panelSizes.explorer.left === "number" && panelSizes.explorer.left >= 20 && panelSizes.explorer.left <= 50) {
            setLeftPanelSize(panelSizes.explorer.left);
          }
          if (typeof panelSizes.explorer.right === "number" && panelSizes.explorer.right >= 50) {
            setRightPanelSize(panelSizes.explorer.right);
          }
        }
        setHasFetchedPanelSizes(true);
      } catch (error) {
        log.error("[ExplorerPage] Failed to fetch panel sizes:", error);
        setHasFetchedPanelSizes(true);
      }
    };

    fetchPanelSizes().catch((error) => {
      log.error("[ExplorerPage] Error fetching panel sizes:", error);
      setHasFetchedPanelSizes(true);
    });
  }, [isAuthenticated, hasFetchedPanelSizes]);

  const panelSizeSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handlePanelLayout = useCallback(
    (sizes: number[]): void => {
      if (sizes.length >= 2) {
        const [left, right] = sizes;
        const clampedLeft = Math.max(20, Math.min(50, left));
        const clampedRight = Math.max(50, right);
        setLeftPanelSize(clampedLeft);
        setRightPanelSize(clampedRight);

        if (left < 10) {
          setIsSidebarCollapsed(true);
        } else {
          setIsSidebarCollapsed(false);
        }

        if (panelSizeSyncTimeoutRef.current) {
          clearTimeout(panelSizeSyncTimeoutRef.current);
        }

        if (isAuthenticated && hasFetchedPanelSizes) {
          panelSizeSyncTimeoutRef.current = setTimeout(async () => {
            try {
              const currentPreferences = await rbacUserPreferencesApi.getPreferences();
              await rbacUserPreferencesApi.updatePreferences({
                workspacePreferences: {
                  ...currentPreferences.workspacePreferences,
                  panelSizes: {
                    ...((currentPreferences.workspacePreferences?.panelSizes as Record<string, unknown>) || {}),
                    explorer: {
                      left: clampedLeft,
                      right: clampedRight,
                    },
                  },
                },
              });
            } catch (error) {
              log.error("[ExplorerPage] Failed to sync panel sizes:", error);
            }
            panelSizeSyncTimeoutRef.current = null;
          }, 1000);
        }
      }
    },
    [isAuthenticated, hasFetchedPanelSizes]
  );

  useEffect(() => {
    return () => {
      if (panelSizeSyncTimeoutRef.current) {
        clearTimeout(panelSizeSyncTimeoutRef.current);
      }
    };
  }, []);

  const breadcrumbs = React.useMemo(() => {
    const items: Array<{ label: string; path: string; icon: React.ReactNode }> = [];

    if (currentDatabase) {
      items.push({
        label: currentDatabase,
        path: `/explorer?database=${currentDatabase}`,
        icon: <Database className="h-3 w-3 text-paper-dim" aria-hidden />,
      });
    }

    if (currentTable) {
      items.push({
        label: currentTable,
        path: `/explorer?database=${currentDatabase}&table=${currentTable}`,
        icon: <Table2 className="h-3 w-3 text-paper-dim" aria-hidden />,
      });
    }

    return items;
  }, [currentDatabase, currentTable]);

  return (
    <div className="flex h-full w-full flex-col">
      {/* ─── Header bar ─── */}
      <div className="flex h-11 flex-none items-center justify-between border-b border-ink-500 bg-ink-50 px-3">
        {/* Left: sidebar toggle + breadcrumbs */}
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={toggleSidebar}
            className="grid h-7 w-7 place-items-center rounded-xs text-paper-dim transition-colors hover:bg-ink-200 hover:text-paper"
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isSidebarCollapsed ? (
              <PanelLeftOpen className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftClose className="h-3.5 w-3.5" />
            )}
          </button>

          <span className="mx-2 h-4 w-px bg-ink-500" aria-hidden />

          <button
            type="button"
            onClick={() => navigate("/explorer")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xs px-2 py-1 transition-colors",
              breadcrumbs.length === 0
                ? "text-paper"
                : "text-paper-muted hover:bg-ink-200 hover:text-paper"
            )}
          >
            <Layers className="h-3.5 w-3.5" aria-hidden />
            <span className="font-mono text-[11px] uppercase tracking-[0.14em]">Explorer</span>
          </button>

          {breadcrumbs.map((crumb, index) => (
            <React.Fragment key={crumb.path}>
              <ChevronRight className="h-3 w-3 shrink-0 text-paper-faint" aria-hidden />
              <button
                type="button"
                onClick={() => navigate(crumb.path)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xs px-2 py-1 text-[12px] transition-colors max-w-[180px] truncate",
                  index === breadcrumbs.length - 1
                    ? "bg-ink-200 text-paper"
                    : "text-paper-muted hover:bg-ink-200 hover:text-paper"
                )}
              >
                {crumb.icon}
                <span className="truncate font-mono">{crumb.label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Right: stats + keyboard hint */}
        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-3 sm:flex">
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint">
              <Database className="h-3 w-3" aria-hidden />
              <span className="text-paper">{databaseCount}</span>
              <span>db</span>
            </span>
            <span className="h-3 w-px bg-ink-500" aria-hidden />
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint">
              <Table2 className="h-3 w-3" aria-hidden />
              <span className="text-paper">{tableCount}</span>
              <span>tbl</span>
            </span>
          </div>

          <div className="hidden items-center gap-1 md:flex">
            <kbd className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted">
              ⌘
            </kbd>
            <kbd className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted">
              K
            </kbd>
            <span className="ml-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
              search
            </span>
          </div>
        </div>
      </div>

      {/* Modals */}
      <CreateTable />
      <CreateDatabase />
      <UploadFromFile />
      <AlterTable />

      {/* Main content */}
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup
          direction="horizontal"
          onLayout={handlePanelLayout}
          className="h-full"
        >
          <ResizablePanel
            ref={sidebarPanelRef}
            className="overflow-hidden"
            defaultSize={leftPanelSize}
            minSize={15}
            maxSize={50}
            collapsible={true}
            collapsedSize={0}
            onCollapse={() => setIsSidebarCollapsed(true)}
            onExpand={() => setIsSidebarCollapsed(false)}
          >
            <DatabaseExplorer />
          </ResizablePanel>

          <ResizableHandle
            withHandle
            className={cn(
              "w-px bg-ink-500 transition-colors duration-200",
              "hover:bg-ink-700 data-[resize-handle-active]:bg-brand"
            )}
          />

          <ResizablePanel
            className="overflow-hidden"
            defaultSize={rightPanelSize}
            minSize={50}
          >
            <WorkspaceTabs />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
};

export default ExplorerPage;
