import { useEffect } from "react";
import { motion } from "framer-motion";
import { Database, Table2, Terminal, Sparkles } from "lucide-react";
import DatabaseExplorer from "@/features/explorer/components/DataExplorer";
import WorkspaceTabs from "@/features/workspace/components/WorkspaceTabs";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import CreateTable from "@/features/explorer/components/CreateTable";
import CreateDatabase from "@/features/explorer/components/CreateDatabase";
import UploadFromFile from "@/features/explorer/components/UploadFile";
import AlterTable from "@/features/explorer/components/AlterTable";
import { useDatabases } from "@/hooks";
import { cn } from "@/lib/utils";

const ExplorerPage = () => {
  const { data: databases = [] } = useDatabases();

  // Calculate stats
  const databaseCount = databases.length;
  const tableCount = databases.reduce((acc, db) => acc + (db.children?.length || 0), 0);

  useEffect(() => {
    document.title = "ClickHouse Studio | Explorer";
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
        <div className="flex items-center justify-between">
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
