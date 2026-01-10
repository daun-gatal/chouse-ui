import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  Star,
  History,
  Filter,
  ArrowUpDown,
  Grid3x3,
  List,
  X,
  Table2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useExplorerStore, useWorkspaceStore, genTabId } from "@/stores";
import { useDatabases, useSavedQueries, useSavedQueriesStatus, useDebounce } from "@/hooks";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PermissionGuard from "@/components/common/PermissionGuard";
import type { SavedQuery } from "@/api";
import { cn } from "@/lib/utils";

const DatabaseExplorer: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchQueryValue, setSearchQueryValue] = useState("");
  const navigate = useNavigate();
  
  // Debounce search terms to avoid excessive filtering
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const debouncedSearchQueryValue = useDebounce(searchQueryValue, 300);

  const { 
    openCreateDatabaseModal, 
    openCreateTableModal, 
    openUploadFileModal,
    favorites,
    getRecentItems,
    sortBy,
    setSortBy,
    showFavoritesOnly,
    setShowFavoritesOnly,
    addRecentItem,
  } = useExplorerStore();
  const { addTab } = useWorkspaceStore();

  const { data: databases = [], isLoading: isLoadingDatabase, isFetching: isFetchingDatabases, refetch: refreshDatabases, error: tabError } = useDatabases();
  const { data: isQueriesEnabled = false } = useSavedQueriesStatus();
  const { data: savedQueriesList = [], refetch: refreshSavedQueries, isFetching: isRefreshingSavedQueries } = useSavedQueries();

  // Get recent items
  const recentItems = useMemo(() => getRecentItems(5), [getRecentItems]);

  // Memoized filtered and sorted data
  const filteredData = useMemo(() => {
    let result = databases;

    // Apply favorites filter
    if (showFavoritesOnly) {
      result = databases.map(db => {
        const isDbFavorite = favorites.some(f => f.id === db.name && f.type === 'database');
        const favoriteTables = db.children.filter(table => 
          favorites.some(f => f.id === `${db.name}.${table.name}` && f.type === 'table')
        );
        
        if (isDbFavorite || favoriteTables.length > 0) {
          return {
            ...db,
            children: isDbFavorite ? db.children : favoriteTables,
          };
        }
        return null;
      }).filter(Boolean) as typeof databases;
    }

    // Apply search filter
    if (debouncedSearchTerm) {
      const lowerSearch = debouncedSearchTerm.toLowerCase();
      result = result.filter(
        (node) =>
          node.name.toLowerCase().includes(lowerSearch) ||
          node.children.some((child) =>
            child.name.toLowerCase().includes(lowerSearch)
          )
      );
    }

    // Apply sorting
    if (sortBy === 'name') {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name));
      result = result.map(db => ({
        ...db,
        children: [...db.children].sort((a, b) => a.name.localeCompare(b.name)),
      }));
    } else if (sortBy === 'recent') {
      // Sort by recent items (most recent first)
      const recentIds = new Set(recentItems.map(item => item.id));
      result = [...result].sort((a, b) => {
        const aRecent = recentIds.has(a.name) ? 1 : 0;
        const bRecent = recentIds.has(b.name) ? 1 : 0;
        return bRecent - aRecent;
      });
    }

    return result;
  }, [databases, debouncedSearchTerm, showFavoritesOnly, favorites, sortBy, recentItems]);

  // For tree structures, virtualization is complex due to expand/collapse
  // We'll use virtualization only for very large flat lists (saved queries)
  // For databases/tables, we render normally but optimize with memoization

  const filteredQueries = useMemo(() => {
    if (!debouncedSearchQueryValue) return savedQueriesList;
    const lowerSearch = debouncedSearchQueryValue.toLowerCase();
    return savedQueriesList.filter((query) =>
      query.name.toLowerCase().includes(lowerSearch)
    );
  }, [savedQueriesList, debouncedSearchQueryValue]);

  const handleSavedQueryOpen = useCallback((query: SavedQuery) => {
    addTab({
      id: query.id,
      type: "sql",
      title: query.name,
      content: query.query,
      isSaved: true,
    });
  }, [addTab]);

  // Virtualization for saved queries (flat list - better candidate for virtualization)
  const queriesParentRef = useRef<HTMLDivElement>(null);
  const queriesVirtualizer = useVirtualizer({
    count: filteredQueries.length,
    getScrollElement: () => queriesParentRef.current,
    estimateSize: () => 48, // Estimated query item height
    overscan: 3,
    enabled: filteredQueries.length > 20, // Only virtualize if many queries
  });

  // Keyboard navigation
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Focus search on Ctrl/Cmd + K
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // Clear search on Escape when focused
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        setSearchTerm("");
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
            {favorites.length > 0 && (
              <Badge variant="secondary" className="text-[10px] bg-yellow-500/20 text-yellow-300 px-1.5 py-0 border-yellow-500/30">
                <Star className="w-2.5 h-2.5 mr-0.5 fill-yellow-400" />
                {favorites.length}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Sort & Filter Controls */}
            <Select value={sortBy} onValueChange={(value) => setSortBy(value as any)}>
              <SelectTrigger className="h-7 w-[100px] text-xs border-white/10 bg-white/5">
                <ArrowUpDown className="w-3 h-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="recent">Recent</SelectItem>
              </SelectContent>
            </Select>
            
            {/* Favorites Filter Toggle */}
            {favorites.length > 0 && (
              <Button
                size="sm"
                variant={showFavoritesOnly ? "default" : "ghost"}
                onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                className="h-7 px-2 text-xs"
                title="Show favorites only"
              >
                <Star className={cn("w-3 h-3 mr-1", showFavoritesOnly && "fill-yellow-400")} />
                Favorites
              </Button>
            )}
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
            ref={searchInputRef}
            type="text"
            placeholder="Search... (Ctrl+K)"
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

      {/* Favorites & Recent Quick Access */}
      {(favorites.length > 0 || recentItems.length > 0) && (
        <div className="flex-none border-b border-white/10 p-2 space-y-2 max-h-[120px] overflow-y-auto">
          {/* Favorites */}
          {favorites.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 px-2">
                <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                <span className="text-[10px] font-medium text-gray-400 uppercase">Favorites</span>
              </div>
              <div className="flex flex-wrap gap-1 px-2">
                {favorites.slice(0, 5).map((fav) => (
                  <Button
                    key={fav.id}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      addRecentItem(fav.database, fav.table);
                      if (fav.type === 'database') {
                        navigate(`/explorer?database=${fav.database}`);
                      } else {
                        navigate(`/explorer?database=${fav.database}&table=${fav.table}`);
                      }
                    }}
                    className="h-6 px-2 text-[10px] border-yellow-500/30 bg-yellow-500/10 hover:bg-yellow-500/20"
                  >
                    <Star className="w-2.5 h-2.5 mr-1 fill-yellow-400 text-yellow-400" />
                    {fav.name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Recent Items */}
          {recentItems.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 px-2">
                <History className="w-3 h-3 text-blue-400" />
                <span className="text-[10px] font-medium text-gray-400 uppercase">Recent</span>
              </div>
              <div className="flex flex-wrap gap-1 px-2">
                {recentItems.map((item) => (
                  <Button
                    key={item.id}
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      addRecentItem(item.database, item.table);
                      if (item.type === 'database') {
                        navigate(`/explorer?database=${item.database}`);
                      } else {
                        navigate(`/explorer?database=${item.database}&table=${item.table}`);
                      }
                    }}
                    className="h-6 px-2 text-[10px] hover:bg-white/10"
                  >
                    {item.type === 'table' ? (
                      <Table2 className="w-2.5 h-2.5 mr-1 text-green-400" />
                    ) : (
                      <Database className="w-2.5 h-2.5 mr-1 text-blue-400" />
                    )}
                    {item.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
                  className="p-2 space-y-2"
                >
                  {/* Loading Skeletons */}
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="flex items-center gap-2 py-1 px-2">
                      <Skeleton className="h-4 w-4 rounded" />
                      <Skeleton className="h-4 w-4 rounded" />
                      <Skeleton className="h-4 flex-1" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                  ))}
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
                  {filteredData.map((node) => (
                    <TreeNode
                      key={node.name}
                      node={node as TreeNodeData}
                      level={0}
                      searchTerm={debouncedSearchTerm}
                      parentDatabaseName={node.name}
                      refreshData={refreshDatabases}
                    />
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-12 text-gray-500"
                >
                  {searchTerm ? (
                    <>
                      <SearchX className="w-8 h-8 opacity-30 mb-3" />
                      <p className="text-xs mb-1 font-medium">No results found</p>
                      <p className="text-[10px] mb-4 text-gray-600">Try adjusting your search terms</p>
                      <Button
                        onClick={() => setSearchTerm("")}
                        variant="ghost"
                        size="sm"
                        className="text-xs"
                      >
                        Clear Search
                      </Button>
                    </>
                  ) : (
                    <>
                      <Database className="w-8 h-8 opacity-30 mb-3" />
                      <p className="text-xs mb-1 font-medium">No databases found</p>
                      <p className="text-[10px] mb-4 text-gray-600">Create a database to get started</p>
                      <PermissionGuard requiredPermission="CREATE DATABASE" showTooltip>
                        <Button
                          onClick={() => openCreateDatabaseModal()}
                          variant="outline"
                          size="sm"
                          className="text-xs"
                        >
                          <FolderPlus className="w-3 h-3 mr-1" />
                          Create Database
                        </Button>
                      </PermissionGuard>
                    </>
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

                  <ScrollArea className="h-48" ref={queriesParentRef}>
                    <div className="px-2">
                      {filteredQueries.length > 0 ? (
                        queriesVirtualizer.getVirtualItems().length > 0 ? (
                          // Virtualized rendering for large lists
                          <div
                            style={{
                              height: `${queriesVirtualizer.getTotalSize()}px`,
                              width: '100%',
                              position: 'relative',
                            }}
                          >
                            {queriesVirtualizer.getVirtualItems().map((virtualItem) => {
                              const query = filteredQueries[virtualItem.index];
                              return (
                                <div
                                  key={query.id}
                                  style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: `${virtualItem.size}px`,
                                    transform: `translateY(${virtualItem.start}px)`,
                                  }}
                                  className="px-2"
                                >
                                  <button
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
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          // Normal rendering for small lists
                          <div className="space-y-0.5">
                            {filteredQueries.map((query) => (
                              <button
                                key={query.id}
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
                              </button>
                            ))}
                          </div>
                        )
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
