import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Database, Table2, Terminal, Sparkles, ChevronRight, Home } from "lucide-react";
import DatabaseExplorer from "@/features/explorer/components/DataExplorer";
import WorkspaceTabs from "@/features/workspace/components/WorkspaceTabs";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type { PanelGroupStorage } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
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
  const [leftPanelSize, setLeftPanelSize] = useState(45);
  const [rightPanelSize, setRightPanelSize] = useState(78);
  const [hasFetchedPanelSizes, setHasFetchedPanelSizes] = useState(false);
  const panelGroupRef = useRef<{ getPanelGroup: () => PanelGroupStorage | null } | null>(null);

  // Get current database and table from URL
  const currentDatabase = searchParams.get("database") || "";
  const currentTable = searchParams.get("table") || "";

  // Calculate stats
  const databaseCount = databases.length;
  const tableCount = databases.reduce((acc, db) => acc + (db.children?.length || 0), 0);

  // Breadcrumbs
  const breadcrumbs = useMemo(() => {
    const items: Array<{ label: string; path: string; type: 'home' | 'database' | 'table' }> = [
      { label: 'Explorer', path: '/explorer', type: 'home' },
    ];

    if (currentDatabase) {
      items.push({
        label: currentDatabase,
        path: `/explorer?database=${currentDatabase}`,
        type: 'database',
      });
    }

    if (currentTable) {
      items.push({
        label: currentTable,
        path: `/explorer?database=${currentDatabase}&table=${currentTable}`,
        type: 'table',
      });
    }

    return items;
  }, [currentDatabase, currentTable]);

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
          // Validate and set left panel size (33-70% range)
          if (typeof panelSizes.explorer.left === 'number' && panelSizes.explorer.left >= 33 && panelSizes.explorer.left <= 70) {
            setLeftPanelSize(panelSizes.explorer.left);
          }
          // Validate and set right panel size (minimum 30%)
          if (typeof panelSizes.explorer.right === 'number' && panelSizes.explorer.right >= 30) {
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
      // Clamp values to valid ranges
      const clampedLeft = Math.max(33, Math.min(70, left));
      const clampedRight = Math.max(30, right);
      setLeftPanelSize(clampedLeft);
      setRightPanelSize(clampedRight);

      // Clear existing timeout
      if (panelSizeSyncTimeoutRef.current) {
        clearTimeout(panelSizeSyncTimeoutRef.current);
      }

      // Debounce database sync to avoid excessive API calls
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
        }, 1000); // Debounce by 1 second
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="h-full w-full flex flex-col"
    >
      {/* Header */}
      <div className="flex-none px-6 py-4 border-b border-white/10 bg-gradient-to-r from-purple-500/5 to-transparent">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-500 to-blue-600 shadow-lg shadow-purple-500/20">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white">Data Explorer</h1>
              <p className="text-gray-400 text-xs">Browse databases, tables and run SQL queries</p>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              <Database className="h-3.5 w-3.5 text-purple-400" />
              <span className="text-sm text-gray-300">{databaseCount}</span>
              <span className="text-xs text-gray-500">databases</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              <Table2 className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-sm text-gray-300">{tableCount}</span>
              <span className="text-xs text-gray-500">tables</span>
            </div>
          </div>
        </div>

        {/* Breadcrumbs */}
        {breadcrumbs.length > 1 && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            {breadcrumbs.map((crumb, index) => (
              <React.Fragment key={crumb.path}>
                {index > 0 && <ChevronRight className="w-3 h-3 text-gray-600" />}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(crumb.path)}
                  className={cn(
                    "h-6 px-2 text-xs hover:text-white transition-colors",
                    index === breadcrumbs.length - 1 && "text-white font-medium"
                  )}
                >
                  {index === 0 ? (
                    <Home className="w-3 h-3 mr-1" />
                  ) : crumb.type === 'database' ? (
                    <Database className="w-3 h-3 mr-1 text-blue-400" />
                  ) : (
                    <Table2 className="w-3 h-3 mr-1 text-green-400" />
                  )}
                  {crumb.label}
                </Button>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateTable />
      <CreateDatabase />
      <UploadFromFile />
      <AlterTable />

      {/* Main Content */}
      <div className="flex-1 min-h-0 p-4">
        <div className="h-full rounded-xl border border-white/10 bg-black/40 backdrop-blur-xl overflow-hidden shadow-2xl">
          <ResizablePanelGroup 
            direction="horizontal"
            onLayout={handlePanelLayout}
          >
            {/* Left Panel - Database Explorer */}
            <ResizablePanel 
              className="overflow-hidden flex flex-col" 
              defaultSize={leftPanelSize}
              minSize={33}
              maxSize={70}
            >
              <DatabaseExplorer />
            </ResizablePanel>

            {/* Resizable Handle */}
            <ResizableHandle 
              withHandle 
              className={cn(
                "bg-white/5 hover:bg-purple-500/30 transition-colors",
                "data-[resize-handle-active]:bg-purple-500/50"
              )} 
            />

            {/* Right Panel - Workspace Tabs */}
            <ResizablePanel
              className="overflow-hidden flex flex-col"
              defaultSize={rightPanelSize}
              minSize={30}
            >
              <div className="h-full w-full bg-black/20">
                <WorkspaceTabs />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>
    </motion.div>
  );
};

export default ExplorerPage;
