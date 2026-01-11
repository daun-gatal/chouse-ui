import React, { useEffect, useMemo } from "react";
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
import { Button } from "@/components/ui/button";
import CreateTable from "@/features/explorer/components/CreateTable";
import CreateDatabase from "@/features/explorer/components/CreateDatabase";
import UploadFromFile from "@/features/explorer/components/UploadFile";
import AlterTable from "@/features/explorer/components/AlterTable";
import { useDatabases } from "@/hooks";
import { cn } from "@/lib/utils";

const ExplorerPage = () => {
  const { data: databases = [] } = useDatabases();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

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
          <ResizablePanelGroup direction="horizontal">
            {/* Left Panel - Database Explorer */}
            <ResizablePanel 
              className="overflow-hidden flex flex-col" 
              defaultSize={22} 
              minSize={15}
              maxSize={40}
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
              defaultSize={78}
              minSize={50}
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
