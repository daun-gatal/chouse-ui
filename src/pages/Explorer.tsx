import React, { useEffect, useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Database, Table2, ChevronRight, Home, Command, Layers } from "lucide-react";
import DatabaseExplorer from "@/features/explorer/components/DataExplorer";
import WorkspaceTabs from "@/features/workspace/components/WorkspaceTabs";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { PanelGroupStorage } from "react-resizable-panels";
import CreateTable from "@/features/explorer/components/CreateTable";
import CreateDatabase from "@/features/explorer/components/CreateDatabase";
import UploadFromFile from "@/features/explorer/components/UploadFile";
import AlterTable from "@/features/explorer/components/AlterTable";
import { useDatabases } from "@/hooks";
import { cn } from "@/lib/utils";
import { useExplorerStore } from "@/stores/explorer";
import { useRbacStore } from "@/stores/rbac";
import { rbacUserPreferencesApi } from "@/api/rbac";

const ExplorerPage = () => {
  const { data: databases = [] } = useDatabases();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { fetchFavorites, fetchRecentItems, fetchPreferences } = useExplorerStore();
  const { isAuthenticated } = useRbacStore();
  
  // Panel sizes state (defaults)
  const [leftPanelSize, setLeftPanelSize] = useState(35);
  const [rightPanelSize, setRightPanelSize] = useState(65);
  const [hasFetchedPanelSizes, setHasFetchedPanelSizes] = useState(false);
  const panelGroupRef = useRef<{ getPanelGroup: () => PanelGroupStorage | null } | null>(null);

  // Get current database and table from URL
  const currentDatabase = searchParams.get("database") || "";
  const currentTable = searchParams.get("table") || "";

  // Calculate stats
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

  // Fetch favorites, recent items, and preferences when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchFavorites().catch(console.error);
      fetchRecentItems().catch(console.error);
      fetchPreferences().catch(console.error);
    }
  }, [isAuthenticated, fetchFavorites, fetchRecentItems, fetchPreferences]);

  // Fetch panel sizes from database when authenticated
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
          if (typeof panelSizes.explorer.left === 'number' && panelSizes.explorer.left >= 20 && panelSizes.explorer.left <= 50) {
            setLeftPanelSize(panelSizes.explorer.left);
          }
          if (typeof panelSizes.explorer.right === 'number' && panelSizes.explorer.right >= 50) {
            setRightPanelSize(panelSizes.explorer.right);
          }
        }
        setHasFetchedPanelSizes(true);
      } catch (error) {
        console.error('[ExplorerPage] Failed to fetch panel sizes:', error);
        setHasFetchedPanelSizes(true);
      }
    };

    fetchPanelSizes().catch((error) => {
      console.error('[ExplorerPage] Error fetching panel sizes:', error);
      setHasFetchedPanelSizes(true);
    });
  }, [isAuthenticated, hasFetchedPanelSizes]);

  // Debounce timer ref for panel size sync
  const panelSizeSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handle panel layout changes (debounced)
  const handlePanelLayout = useCallback((sizes: number[]): void => {
    if (sizes.length >= 2) {
      const [left, right] = sizes;
      const clampedLeft = Math.max(20, Math.min(50, left));
      const clampedRight = Math.max(50, right);
      setLeftPanelSize(clampedLeft);
      setRightPanelSize(clampedRight);

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
            console.error('[ExplorerPage] Failed to sync panel sizes:', error);
          }
          panelSizeSyncTimeoutRef.current = null;
        }, 1000);
      }
    }
  }, [isAuthenticated, hasFetchedPanelSizes]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (panelSizeSyncTimeoutRef.current) {
        clearTimeout(panelSizeSyncTimeoutRef.current);
      }
    };
  }, []);

  // Breadcrumb items
  const breadcrumbs = React.useMemo(() => {
    const items: Array<{ label: string; path: string; icon: React.ReactNode }> = [];
    
    if (currentDatabase) {
      items.push({
        label: currentDatabase,
        path: `/explorer?database=${currentDatabase}`,
        icon: <Database className="w-3 h-3 text-blue-400" />,
      });
    }

    if (currentTable) {
      items.push({
        label: currentTable,
        path: `/explorer?database=${currentDatabase}&table=${currentTable}`,
        icon: <Table2 className="w-3 h-3 text-emerald-400" />,
      });
    }

    return items;
  }, [currentDatabase, currentTable]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="h-full w-full flex flex-col"
    >
      {/* Minimal Header Bar */}
      <div className="flex-none h-11 px-4 flex items-center justify-between border-b border-white/10">
        {/* Left: Breadcrumbs */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => navigate('/explorer')}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors",
              breadcrumbs.length === 0 
                ? "text-white bg-white/10" 
                : "text-gray-400 hover:text-white hover:bg-white/5"
            )}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Explorer</span>
          </button>

          {breadcrumbs.map((crumb, index) => (
            <React.Fragment key={crumb.path}>
              <ChevronRight className="w-3 h-3 text-gray-600 flex-shrink-0" />
              <button
                onClick={() => navigate(crumb.path)}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors truncate max-w-[150px]",
                  index === breadcrumbs.length - 1
                    ? "text-white font-medium bg-white/10"
                    : "text-gray-400 hover:text-white hover:bg-white/5"
                )}
              >
                {crumb.icon}
                <span className="truncate">{crumb.label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Right: Stats & Keyboard Hint */}
        <div className="flex items-center gap-3">
          {/* Stats Pills */}
          <div className="hidden sm:flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20">
              <Database className="w-3 h-3 text-blue-400" />
              <span className="text-[10px] font-medium text-blue-300">{databaseCount}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <Table2 className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] font-medium text-emerald-300">{tableCount}</span>
            </div>
          </div>

          {/* Keyboard Shortcut Hint */}
          <div className="hidden md:flex items-center gap-1 text-[10px] text-gray-500">
            <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 font-mono">
              <Command className="w-2.5 h-2.5 inline" />
            </kbd>
            <span>+</span>
            <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 font-mono">K</kbd>
            <span className="ml-1">to search</span>
          </div>
        </div>
      </div>

      {/* Modals */}
      <CreateTable />
      <CreateDatabase />
      <UploadFromFile />
      <AlterTable />

      {/* Main Content */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup 
          direction="horizontal"
          onLayout={handlePanelLayout}
          className="h-full"
        >
          {/* Left Panel - Sidebar */}
          <ResizablePanel 
            className="overflow-hidden" 
            defaultSize={leftPanelSize}
            minSize={20}
            maxSize={50}
          >
            <DatabaseExplorer />
          </ResizablePanel>

          {/* Resizable Handle */}
          <ResizableHandle 
            withHandle 
            className={cn(
              "w-px bg-white/10 hover:bg-white/20 transition-colors duration-200",
              "data-[resize-handle-active]:bg-white/30"
            )} 
          />

          {/* Right Panel - Workspace */}
          <ResizablePanel
            className="overflow-hidden"
            defaultSize={rightPanelSize}
            minSize={50}
          >
            <WorkspaceTabs />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </motion.div>
  );
};

export default ExplorerPage;
