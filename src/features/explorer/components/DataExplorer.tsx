import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCcw,
  Search,
  Plus,
  Database,
  FileCode,
  Star,
  History,
  X,
  Table2,
  FolderPlus,
  FileUp,
  Pin,
  Bookmark,
  Filter,
  Layers,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useExplorerStore, useWorkspaceStore, genTabId, useAuthStore, RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { useDatabases, useSavedQueries, useSavedQueriesConnectionNames, useDebounce } from "@/hooks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import TreeNode, { TreeNodeData } from "@/features/explorer/components/TreeNode";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import PermissionGuard from "@/components/common/PermissionGuard";
import type { SavedQuery } from "@/api";
import { cn } from "@/lib/utils";

// ============================================
// Quick Access Item Component
// ============================================
interface QuickAccessItemProps {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  onClick: () => void;
  onRemove?: () => void;
  variant?: 'favorite' | 'recent';
}

const QuickAccessItem: React.FC<QuickAccessItemProps> = ({
  icon,
  label,
  sublabel,
  onClick,
  onRemove,
  variant = 'recent',
}) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-left group",
        "hover:bg-white/5 transition-colors rounded-md mx-1"
      )}
    >
      <span className="flex-shrink-0 opacity-70">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-300 truncate group-hover:text-white transition-colors">
          {label}
        </p>
        {sublabel && (
          <p className="text-[10px] text-gray-500 truncate">{sublabel}</p>
        )}
      </div>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-white/10 rounded transition-all"
        >
          <X className="w-3 h-3 text-gray-500 hover:text-gray-300" />
        </button>
      )}
    </button>
  );
};

// ============================================
// Saved Query Item Component
// ============================================
interface SavedQueryItemProps {
  query: SavedQuery;
  onOpen: () => void;
}

const SavedQueryItem: React.FC<SavedQueryItemProps> = ({ query, onOpen }) => {
  return (
    <button
      onClick={onOpen}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2 text-left",
        "hover:bg-white/5 transition-colors group rounded-md mx-1"
      )}
    >
      <FileCode className="w-3.5 h-3.5 text-amber-400/70 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-300 truncate group-hover:text-white transition-colors">
          {query.name}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {query.connectionName ? (
            <span className="text-[10px] text-gray-500 truncate max-w-[100px]">
              {query.connectionName}
            </span>
          ) : (
            <span className="text-[10px] text-purple-400/80">All connections</span>
          )}
          <span className="text-gray-600">·</span>
          <span className="text-[10px] text-gray-500">
            {new Date(query.updatedAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </button>
  );
};

// ============================================
// Tab Button Component
// ============================================
interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}

const TabButton: React.FC<TabButtonProps> = ({ active, onClick, icon, label, count }) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-all",
      active
        ? "bg-white/10 text-white"
        : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
    )}
  >
    {icon}
    <span className="hidden sm:inline">{label}</span>
    {count !== undefined && count > 0 && (
      <span className={cn(
        "text-[10px] tabular-nums px-1 rounded",
        active ? "bg-white/20" : "bg-white/5"
      )}>
        {count}
      </span>
    )}
  </button>
);

// ============================================
// Empty State Component
// ============================================
interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, description }) => (
  <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center mb-3">
      {icon}
    </div>
    <p className="text-sm text-gray-400">{title}</p>
    {description && (
      <p className="text-xs text-gray-500 mt-1 max-w-[200px]">{description}</p>
    )}
  </div>
);

// ============================================
// Main DatabaseExplorer Component
// ============================================
const DatabaseExplorer: React.FC = () => {
  const { hasPermission } = useRbacStore();
  const canViewSavedQueries = hasPermission(RBAC_PERMISSIONS.SAVED_QUERIES_VIEW);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchQueryValue, setSearchQueryValue] = useState("");
  const [connectionFilter, setConnectionFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<"databases" | "pinned" | "recent" | "saved">("databases");
  const navigate = useNavigate();
  
  // Debounce search terms
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  const debouncedSearchQueryValue = useDebounce(searchQueryValue, 300);

  const {
    expandedNodes,
    toggleNode,
    openCreateTableModal,
    openCreateDatabaseModal,
    openUploadFileModal,
    favorites,
    sortBy,
    addRecentItem,
    clearRecentItems,
    removeFavorite,
  } = useExplorerStore();
  
  const allRecentItems = useExplorerStore((state) => state.recentItems);
  const recentItems = useMemo(() => allRecentItems.slice(0, 8), [allRecentItems]);
  
  const { addTab } = useWorkspaceStore();
  const { activeConnectionId, activeConnectionName } = useAuthStore();

  const { 
    data: databases = [], 
    isLoading: isLoadingDatabase, 
    isFetching: isFetchingDatabases, 
    refetch: refreshDatabases, 
    error: tabError 
  } = useDatabases();

  // Fetch all saved queries (not filtered by connection) - only if user has permission
  const { 
    data: savedQueriesList = [], 
    refetch: refreshSavedQueries, 
    isFetching: isRefreshingSavedQueries 
  } = useSavedQueries(undefined, { enabled: canViewSavedQueries });
  
  // Fetch unique connection names for filter dropdown - only if user has permission
  const { data: connectionNames = [] } = useSavedQueriesConnectionNames(
    { enabled: canViewSavedQueries }
  );

  // Filter function for connection-based filtering
  const filterByConnection = useCallback(<T extends { connectionId?: string | null; connectionName?: string | null }>(items: T[]): T[] => {
    if (connectionFilter === "all") {
      return items;
    }
    if (connectionFilter === "current" && activeConnectionId) {
      return items.filter((item) => 
        item.connectionId === activeConnectionId || !item.connectionId
      );
    }
    if (connectionFilter !== "current") {
      return items.filter((item) => item.connectionName === connectionFilter);
    }
    return items;
  }, [connectionFilter, activeConnectionId]);

  // Filtered favorites (by connection)
  const filteredFavorites = useMemo(() => {
    return filterByConnection(favorites);
  }, [favorites, filterByConnection]);

  // Filtered recent items (by connection)
  const filteredRecentItems = useMemo(() => {
    return filterByConnection(recentItems);
  }, [recentItems, filterByConnection]);

  // Filtered saved queries (by connection and search)
  const filteredQueries = useMemo(() => {
    let result = filterByConnection(savedQueriesList);
    
    if (debouncedSearchQueryValue) {
      const lowerSearch = debouncedSearchQueryValue.toLowerCase();
      result = result.filter((query) =>
        query.name.toLowerCase().includes(lowerSearch)
      );
    }
    
    return result;
  }, [savedQueriesList, debouncedSearchQueryValue, filterByConnection]);

  // Filtered and sorted databases
  const filteredData = useMemo(() => {
    let result = databases;

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

    if (sortBy === 'name') {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name));
      result = result.map(db => ({
        ...db,
        children: [...db.children].sort((a, b) => a.name.localeCompare(b.name)),
      }));
    }

    return result;
  }, [databases, debouncedSearchTerm, sortBy]);

  // Handlers
  const handleSavedQueryOpen = useCallback((query: SavedQuery) => {
    addTab({
      id: query.id,
      title: query.name,
      type: 'sql',
      content: query.query,
      isSaved: true,
    });
  }, [addTab]);

  const handleQuickAccessClick = useCallback(async (item: { type: string; database: string; table?: string }) => {
    await addRecentItem(item.database, item.table);
    if (item.type === 'database' || !item.table) {
      navigate(`/explorer?database=${item.database}`);
    } else {
      navigate(`/explorer?database=${item.database}&table=${item.table}`);
    }
  }, [navigate, addRecentItem]);

  // Keyboard shortcut for search
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Has any filter content
  const hasConnectionFilter = connectionFilter !== "all";

  // Reset active tab if user doesn't have permission for saved queries
  React.useEffect(() => {
    if (activeTab === "saved" && !canViewSavedQueries) {
      setActiveTab("databases");
    }
  }, [activeTab, canViewSavedQueries]);

  return (
    <div className="flex flex-col h-full bg-slate-900/50">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-white/10">
        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-2 py-2">
          <TabButton
            active={activeTab === "databases"}
            onClick={() => setActiveTab("databases")}
            icon={<Database className="w-3.5 h-3.5" />}
            label="Databases"
            count={databases.length}
          />
          <TabButton
            active={activeTab === "pinned"}
            onClick={() => setActiveTab("pinned")}
            icon={<Star className="w-3.5 h-3.5 text-amber-400" />}
            label="Pinned"
            count={filteredFavorites.length}
          />
          <TabButton
            active={activeTab === "recent"}
            onClick={() => setActiveTab("recent")}
            icon={<History className="w-3.5 h-3.5 text-blue-400" />}
            label="Recent"
            count={filteredRecentItems.length}
          />
          {canViewSavedQueries && (
            <TabButton
              active={activeTab === "saved"}
              onClick={() => setActiveTab("saved")}
              icon={<FileCode className="w-3.5 h-3.5 text-amber-400" />}
              label="Queries"
              count={filteredQueries.length}
            />
          )}
        </div>
      </div>

      {/* Content Area */}
      <ScrollArea className="flex-1">
        <AnimatePresence mode="wait">
          {/* Databases Tab */}
          {activeTab === "databases" && (
            <motion.div
              key="databases"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.15 }}
              className="p-2"
            >
              {/* Search & Actions Bar */}
              <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                  <Input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search databases..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8 h-8 text-xs bg-white/5 border-white/10 placeholder:text-gray-500"
                  />
                  <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 bg-white/5 px-1.5 py-0.5 rounded hidden sm:inline">
                    ⌘K
                  </kbd>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => refreshDatabases()}
                        disabled={isFetchingDatabases}
                        className="h-8 w-8 hover:bg-white/10"
                      >
                        <RefreshCcw className={cn("w-3.5 h-3.5", isFetchingDatabases && "animate-spin")} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Refresh</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-white/10">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    {hasPermission(RBAC_PERMISSIONS.DB_CREATE) && (
                      <DropdownMenuItem onClick={() => openCreateDatabaseModal()}>
                        <FolderPlus className="w-4 h-4 mr-2" />
                        New Database
                      </DropdownMenuItem>
                    )}
                    {hasPermission(RBAC_PERMISSIONS.TABLE_CREATE) && (
                      <DropdownMenuItem onClick={() => {
                        const firstDb = databases[0]?.name;
                        if (firstDb) openCreateTableModal(firstDb);
                      }}>
                        <Table2 className="w-4 h-4 mr-2" />
                        New Table
                      </DropdownMenuItem>
                    )}
                    {hasPermission(RBAC_PERMISSIONS.TABLE_INSERT) && (
                      <>
                        {(hasPermission(RBAC_PERMISSIONS.DB_CREATE) || hasPermission(RBAC_PERMISSIONS.TABLE_CREATE)) && (
                          <DropdownMenuSeparator />
                        )}
                        <DropdownMenuItem onClick={() => {
                          const firstDb = databases[0]?.name;
                          if (firstDb) openUploadFileModal(firstDb);
                        }}>
                          <FileUp className="w-4 h-4 mr-2" />
                          Upload File
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Database Tree */}
              {isLoadingDatabase ? (
                <div className="space-y-2 p-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-7 bg-white/5" />
                  ))}
                </div>
              ) : filteredData.length > 0 ? (
                <div className="space-y-0.5">
                  {filteredData.map((db) => (
                    <TreeNode
                      key={db.name}
                      node={{
                        name: db.name,
                        type: 'database',
                        children: db.children.map((table) => ({
                          name: table.name,
                          type: table.type || 'table',
                          children: [],
                        })),
                      }}
                      level={0}
                      parentDatabaseName={db.name}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<Database className="w-5 h-5 text-gray-500" />}
                  title={debouncedSearchTerm ? "No matches found" : "No databases"}
                  description={debouncedSearchTerm ? "Try a different search term" : "Connect to view databases"}
                />
              )}
            </motion.div>
          )}

          {/* Pinned Tab */}
          {activeTab === "pinned" && (
            <motion.div
              key="pinned"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.15 }}
              className="p-2"
            >
              {/* Connection Filter for Pinned */}
              {(favorites.length > 0 || connectionNames.length > 0) && (
                <div className="flex items-center gap-2 mb-3 px-1">
                  <Filter className="w-3 h-3 text-gray-500" />
                  <Select value={connectionFilter} onValueChange={setConnectionFilter}>
                    <SelectTrigger className="h-7 text-xs bg-white/5 border-white/10 flex-1">
                      <SelectValue placeholder="All Connections" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        <span className="flex items-center gap-2">
                          <Layers className="w-3.5 h-3.5 text-purple-400" />
                          All Connections
                        </span>
                      </SelectItem>
                      {activeConnectionId && (
                        <SelectItem value="current">
                          <span className="flex items-center gap-2">
                            <Pin className="w-3.5 h-3.5 text-emerald-400" />
                            {activeConnectionName || "Current"}
                          </span>
                        </SelectItem>
                      )}
                      {connectionNames.map((name) => (
                        <SelectItem key={name} value={name}>
                          <span className="flex items-center gap-2">
                            <Database className="w-3.5 h-3.5 text-blue-400" />
                            {name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {hasConnectionFilter && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConnectionFilter("all")}
                      className="h-7 w-7 p-0 text-gray-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              )}

              {filteredFavorites.length > 0 ? (
                <div className="space-y-0.5">
                  {filteredFavorites.map((fav) => (
                    <QuickAccessItem
                      key={`${fav.id}-${fav.connectionId || 'shared'}`}
                      icon={
                        fav.type === 'database' 
                          ? <Database className="w-3.5 h-3.5 text-blue-400" />
                          : <Table2 className="w-3.5 h-3.5 text-emerald-400" />
                      }
                      label={fav.name}
                      sublabel={[fav.type === 'table' ? fav.database : null, fav.connectionName].filter(Boolean).join(' · ')}
                      onClick={() => handleQuickAccessClick(fav)}
                      onRemove={() => removeFavorite(fav.id)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<Star className="w-5 h-5 text-amber-400/50" />}
                  title={hasConnectionFilter ? "No pinned items for this connection" : "No pinned items"}
                  description="Star your favorite tables and databases"
                />
              )}
            </motion.div>
          )}

          {/* Recent Tab */}
          {activeTab === "recent" && (
            <motion.div
              key="recent"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.15 }}
              className="p-2"
            >
              {/* Connection Filter for Recent */}
              {(recentItems.length > 0 || connectionNames.length > 0) && (
                <div className="flex items-center gap-2 mb-3 px-1">
                  <Filter className="w-3 h-3 text-gray-500" />
                  <Select value={connectionFilter} onValueChange={setConnectionFilter}>
                    <SelectTrigger className="h-7 text-xs bg-white/5 border-white/10 flex-1">
                      <SelectValue placeholder="All Connections" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        <span className="flex items-center gap-2">
                          <Layers className="w-3.5 h-3.5 text-purple-400" />
                          All Connections
                        </span>
                      </SelectItem>
                      {activeConnectionId && (
                        <SelectItem value="current">
                          <span className="flex items-center gap-2">
                            <Pin className="w-3.5 h-3.5 text-emerald-400" />
                            {activeConnectionName || "Current"}
                          </span>
                        </SelectItem>
                      )}
                      {connectionNames.map((name) => (
                        <SelectItem key={name} value={name}>
                          <span className="flex items-center gap-2">
                            <Database className="w-3.5 h-3.5 text-blue-400" />
                            {name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {hasConnectionFilter && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConnectionFilter("all")}
                      className="h-7 w-7 p-0 text-gray-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              )}

              {filteredRecentItems.length > 0 ? (
                <>
                  <div className="flex items-center justify-between px-2 mb-2">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">Recently viewed</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => clearRecentItems()}
                      className="h-5 px-1.5 text-[10px] text-gray-500 hover:text-white"
                    >
                      Clear all
                    </Button>
                  </div>
                  <div className="space-y-0.5">
                    {filteredRecentItems.map((item) => (
                      <QuickAccessItem
                        key={`${item.id}-${item.connectionId || 'shared'}`}
                        icon={
                          item.type === 'database'
                            ? <Database className="w-3.5 h-3.5 text-blue-400" />
                            : <Table2 className="w-3.5 h-3.5 text-emerald-400" />
                        }
                        label={item.name}
                        sublabel={[item.type === 'table' ? item.database : null, item.connectionName].filter(Boolean).join(' · ')}
                        onClick={() => handleQuickAccessClick(item)}
                        variant="recent"
                      />
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState
                  icon={<History className="w-5 h-5 text-blue-400/50" />}
                  title={hasConnectionFilter ? "No recent items for this connection" : "No recent items"}
                  description="Your recently viewed items will appear here"
                />
              )}
            </motion.div>
          )}

          {/* Saved Queries Tab - Only show if user has permission */}
          {activeTab === "saved" && canViewSavedQueries && (
            <motion.div
              key="saved"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.15 }}
              className="p-2"
            >
              {/* Connection Filter for Saved Queries */}
              <div className="flex items-center gap-2 mb-3 px-1">
                <Filter className="w-3 h-3 text-gray-500" />
                <Select value={connectionFilter} onValueChange={setConnectionFilter}>
                  <SelectTrigger className="h-7 text-xs bg-white/5 border-white/10 flex-1">
                    <SelectValue placeholder="All Connections" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <span className="flex items-center gap-2">
                        <Layers className="w-3.5 h-3.5 text-purple-400" />
                        All Connections
                      </span>
                    </SelectItem>
                    {activeConnectionId && (
                      <SelectItem value="current">
                        <span className="flex items-center gap-2">
                          <Pin className="w-3.5 h-3.5 text-emerald-400" />
                          {activeConnectionName || "Current"}
                        </span>
                      </SelectItem>
                    )}
                    {connectionNames.map((name) => (
                      <SelectItem key={name} value={name}>
                        <span className="flex items-center gap-2">
                          <Database className="w-3.5 h-3.5 text-blue-400" />
                          {name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {hasConnectionFilter && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConnectionFilter("all")}
                    className="h-7 w-7 p-0 text-gray-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>

              {/* Search & Refresh */}
              <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                  <Input
                    type="text"
                    placeholder="Search saved queries..."
                    value={searchQueryValue}
                    onChange={(e) => setSearchQueryValue(e.target.value)}
                    className="pl-8 h-8 text-xs bg-white/5 border-white/10 placeholder:text-gray-500"
                  />
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => refreshSavedQueries()}
                        disabled={isRefreshingSavedQueries}
                        className="h-8 w-8 hover:bg-white/10"
                      >
                        <RefreshCcw className={cn("w-3.5 h-3.5", isRefreshingSavedQueries && "animate-spin")} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Refresh</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              {/* Queries List */}
              {filteredQueries.length > 0 ? (
                <div className="space-y-0.5">
                  {filteredQueries.map((query) => (
                    <SavedQueryItem
                      key={query.id}
                      query={query}
                      onOpen={() => handleSavedQueryOpen(query)}
                    />
                  ))}
                </div>
              ) : savedQueriesList.length > 0 ? (
                <EmptyState
                  icon={<Search className="w-5 h-5 text-gray-500" />}
                  title="No matching queries"
                  description="Try a different search term or filter"
                />
              ) : (
                <EmptyState
                  icon={<Bookmark className="w-5 h-5 text-amber-400/50" />}
                  title="No saved queries"
                  description="Save queries from the SQL editor using ⌘S"
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </ScrollArea>
    </div>
  );
};

export default DatabaseExplorer;
