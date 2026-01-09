import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCcw,
  Search,
  SearchX,
  MoreVertical,
  FolderPlus,
  FilePlus,
  TerminalIcon,
  FileUp,
  Database,
  FileCode,
  ChevronRight,
  Clock,
} from "lucide-react";
import { useExplorerStore, useWorkspaceStore, genTabId } from "@/stores";
import { useDatabases, useSavedQueries, useSavedQueriesStatus } from "@/hooks";
import TreeNode, { TreeNodeData } from "@/features/explorer/components/TreeNode";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import PermissionGuard from "@/components/common/PermissionGuard";
import type { SavedQuery } from "@/api";
import { cn } from "@/lib/utils";

const DatabaseExplorer: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchQueryValue, setSearchQueryValue] = useState("");

  const { openCreateDatabaseModal, openCreateTableModal, openUploadFileModal } = useExplorerStore();
  const { addTab } = useWorkspaceStore();

  const { data: databases = [], isLoading: isLoadingDatabase, isFetching: isFetchingDatabases, refetch: refreshDatabases, error: tabError } = useDatabases();
  const { data: isQueriesEnabled = false } = useSavedQueriesStatus();
  const { data: savedQueriesList = [], refetch: refreshSavedQueries, isFetching: isRefreshingSavedQueries } = useSavedQueries();

  const filteredData = useMemo(() => {
    if (!searchTerm) return databases;
    return databases.filter(
      (node) =>
        node.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        node.children.some((child) =>
          child.name.toLowerCase().includes(searchTerm.toLowerCase())
        )
    );
  }, [databases, searchTerm]);

  const filteredQueries = useMemo(() => {
    if (!searchQueryValue) return savedQueriesList;
    return savedQueriesList.filter((query) =>
      query.name.toLowerCase().includes(searchQueryValue.toLowerCase())
    );
  }, [savedQueriesList, searchQueryValue]);

  const handleSavedQueryOpen = (query: SavedQuery) => {
    addTab({
      id: query.id,
      type: "sql",
      title: query.name,
      content: query.query,
      isSaved: true,
    });
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-white/[0.02] to-transparent">
      {/* Header */}
      <div className="flex-none p-3 border-b border-white/10">
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-white">Explorer</h2>
            <Badge variant="secondary" className="text-[10px] bg-white/10 text-gray-400 px-1.5 py-0">
              {databases.length}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7 hover:bg-white/10">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <PermissionGuard requiredPermission="CREATE DATABASE" showTooltip>
                  <DropdownMenuItem onClick={() => openCreateDatabaseModal()} className="gap-2">
                    <FolderPlus className="w-4 h-4 text-purple-400" />
                    Create Database
                  </DropdownMenuItem>
                </PermissionGuard>

                <PermissionGuard requiredPermission="CREATE TABLE" showTooltip>
                  <DropdownMenuItem onClick={() => openCreateTableModal("")} className="gap-2">
                    <FilePlus className="w-4 h-4 text-blue-400" />
                    Create Table
                  </DropdownMenuItem>
                </PermissionGuard>

                <DropdownMenuSeparator />

                <PermissionGuard requiredPermission="INSERT" showTooltip>
                  <DropdownMenuItem onClick={() => openUploadFileModal("")} className="gap-2">
                    <FileUp className="w-4 h-4 text-emerald-400" />
                    Upload File
                  </DropdownMenuItem>
                </PermissionGuard>

                <DropdownMenuItem
                  onClick={() =>
                    addTab({
                      id: genTabId(),
                      type: "sql",
                      title: "Query",
                      content: "",
                    })
                  }
                  className="gap-2"
                >
                  <TerminalIcon className="w-4 h-4 text-amber-400" />
                  New Query
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => refreshDatabases()}
              className="h-7 w-7 hover:bg-white/10"
              disabled={isFetchingDatabases}
            >
              <RefreshCcw className={cn("w-3.5 h-3.5", isFetchingDatabases && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-500" />
          <Input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 pr-8 h-8 text-sm bg-white/5 border-white/10 focus:border-purple-500/50"
          />
          {searchTerm && (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setSearchTerm("")}
              className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6"
            >
              <SearchX className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Database Tree */}
      <div className="flex-1 min-h-0 flex flex-col">
        <ScrollArea className="flex-1">
          <div className="p-2">
            <AnimatePresence mode="wait">
              {isLoadingDatabase ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-12 text-gray-500"
                >
                  <RefreshCcw className="w-6 h-6 animate-spin mb-3" />
                  <p className="text-xs">Loading databases...</p>
                </motion.div>
              ) : tabError ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-12"
                >
                  <p className="text-xs text-red-400 mb-3">{tabError.message}</p>
                  <Button
                    onClick={() => refreshDatabases()}
                    variant="outline"
                    size="sm"
                    className="text-xs border-red-500/50 hover:bg-red-500/10"
                  >
                    Retry
                  </Button>
                </motion.div>
              ) : filteredData.length > 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  {filteredData.map((node, index) => (
                    <motion.div
                      key={node.name}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.03 }}
                    >
                      <TreeNode
                        node={node as TreeNodeData}
                        level={0}
                        searchTerm={searchTerm}
                        parentDatabaseName={node.name}
                        refreshData={() => refreshDatabases()}
                      />
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-12 text-gray-500"
                >
                  <SearchX className="w-8 h-8 opacity-30 mb-3" />
                  <p className="text-xs mb-2">No results found</p>
                  {searchTerm && (
                    <Button
                      onClick={() => setSearchTerm("")}
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                    >
                      Clear Search
                    </Button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ScrollArea>

        {/* Saved Queries Section */}
        {isQueriesEnabled && savedQueriesList && (
          <div className="flex-none border-t border-white/10 max-h-[35%]">
            <Accordion type="single" collapsible defaultValue="saved-queries">
              <AccordionItem value="saved-queries" className="border-none">
                <div className="flex items-center justify-between px-3 py-1">
                  <AccordionTrigger className="py-2 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <FileCode className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-xs font-medium text-white">Saved Queries</span>
                      <Badge variant="secondary" className="text-[10px] bg-white/10 text-gray-400 px-1.5 py-0">
                        {savedQueriesList.length}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      refreshSavedQueries();
                    }}
                    disabled={isRefreshingSavedQueries}
                    className="h-6 w-6 hover:bg-white/10"
                  >
                    <RefreshCcw className={cn("w-3 h-3", isRefreshingSavedQueries && "animate-spin")} />
                  </Button>
                </div>

                <AccordionContent className="pb-2">
                  {/* Search saved queries */}
                  <div className="px-3 pb-2">
                    <div className="relative">
                      <Search className="w-3 h-3 absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-500" />
                      <Input
                        type="text"
                        placeholder="Search queries..."
                        value={searchQueryValue}
                        onChange={(e) => setSearchQueryValue(e.target.value)}
                        className="pl-7 h-7 text-xs bg-white/5 border-white/10"
                      />
                    </div>
                  </div>

                  <ScrollArea className="h-48">
                    <div className="px-2 space-y-0.5">
                      {filteredQueries.length > 0 ? (
                        filteredQueries.map((query, index) => (
                          <motion.button
                            key={query.id}
                            initial={{ opacity: 0, x: -5 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.02 }}
                            onClick={() => handleSavedQueryOpen(query)}
                            className={cn(
                              "w-full flex items-center gap-2 p-2 rounded-lg text-left",
                              "hover:bg-white/5 transition-colors group"
                            )}
                          >
                            <FileCode className="h-3.5 w-3.5 text-amber-400/70 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-gray-300 truncate group-hover:text-white transition-colors">
                                {query.name}
                              </p>
                              <div className="flex items-center gap-1 text-[10px] text-gray-500">
                                <Clock className="h-2.5 w-2.5" />
                                {new Date(query.updated_at).toLocaleDateString()}
                              </div>
                            </div>
                            <ChevronRight className="h-3 w-3 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </motion.button>
                        ))
                      ) : (
                        <div className="flex flex-col items-center justify-center py-6 text-gray-500">
                          <FileCode className="h-6 w-6 opacity-30 mb-2" />
                          <p className="text-xs">No saved queries</p>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}
      </div>
    </div>
  );
};

export default DatabaseExplorer;
