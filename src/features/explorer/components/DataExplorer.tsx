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
  Trash2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useExplorerStore, useWorkspaceStore, genTabId, useAuthStore, RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { useDatabases, useSavedQueries, useSavedQueriesConnectionNames, useDebounce, useDeleteSavedQuery } from "@/hooks";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
}) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2.5 px-3 py-2 text-left",
        "transition-colors hover:bg-ink-200"
      )}
    >
      <span className="shrink-0 text-paper-dim">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] text-paper">{label}</p>
        {sublabel && (
          <p className="truncate font-mono text-[10px] text-paper-faint">{sublabel}</p>
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="grid h-5 w-5 place-items-center rounded-xs opacity-0 transition-all hover:bg-ink-300 group-hover:opacity-100"
          aria-label="Remove"
        >
          <X className="h-3 w-3 text-paper-faint hover:text-paper" />
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
  onDelete?: (query: SavedQuery) => void;
}

const SavedQueryItem: React.FC<SavedQueryItemProps> = ({ query, onOpen, onDelete }) => {
  return (
    <button
      onClick={onOpen}
      className={cn(
        "group flex w-full items-center gap-2.5 px-3 py-2 text-left",
        "transition-colors hover:bg-ink-200"
      )}
    >
      <FileCode className="h-3.5 w-3.5 shrink-0 text-paper-dim" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] text-paper">{query.name}</p>
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-paper-faint">
          {query.connectionName ? (
            <span className="max-w-[100px] truncate">{query.connectionName}</span>
          ) : (
            <span className="text-paper-dim">All connections</span>
          )}
          <span>·</span>
          <span>{new Date(query.updatedAt).toLocaleDateString()}</span>
        </div>
      </div>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(query);
          }}
          className="grid h-5 w-5 shrink-0 place-items-center rounded-xs opacity-0 transition-all hover:bg-ink-300 group-hover:opacity-100"
          aria-label="Delete query"
        >
          <Trash2 className="h-3 w-3 text-paper-faint hover:text-red-400" />
        </button>
      )}
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
    type="button"
    onClick={onClick}
    className={cn(
      "flex items-center gap-1.5 rounded-xs px-2.5 py-1.5 transition-colors",
      "font-mono text-[10px] uppercase tracking-[0.14em]",
      active
        ? "bg-ink-200 text-paper"
        : "text-paper-dim hover:bg-ink-200 hover:text-paper"
    )}
    aria-pressed={active}
  >
    <span className={active ? "text-paper-muted" : "text-paper-faint"}>{icon}</span>
    <span className="hidden sm:inline">{label}</span>
    {count !== undefined && count > 0 && (
      <span
        className={cn(
          "rounded-xs px-1 tabular-nums",
          active ? "text-paper" : "text-paper-faint"
        )}
      >
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
  <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
    <div className="mb-3 grid h-10 w-10 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-dim">
      {icon}
    </div>
    <p className="text-[13px] text-paper-muted">{title}</p>
    {description && (
      <p className="mt-1 max-w-[220px] text-[12px] text-paper-faint">{description}</p>
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

  // Delete saved query mutation
  const deleteSavedQueryMutation = useDeleteSavedQuery();
  const [queryToDelete, setQueryToDelete] = useState<SavedQuery | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteClick = (query: SavedQuery) => {
    setQueryToDelete(query);
  };

  const confirmDelete = async () => {
    if (!queryToDelete) return;

    setIsDeleting(true);
    try {
      await deleteSavedQueryMutation.mutateAsync(queryToDelete.id);
      toast.success("Query deleted successfully");
      setQueryToDelete(null);
    } catch (error) {
      toast.error(`Failed to delete query: ${(error as Error).message}`);
    } finally {
      setIsDeleting(false);
    }
  };

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
    <div className="flex h-full flex-col bg-ink-50">
      {/* Tab navigation */}
      <div className="flex-shrink-0 border-b border-ink-500">
        <div className="flex items-center gap-1 px-2 py-2">
          <TabButton
            active={activeTab === "databases"}
            onClick={() => setActiveTab("databases")}
            icon={<Database className="h-3.5 w-3.5" />}
            label="Databases"
            count={databases.length}
          />
          <TabButton
            active={activeTab === "pinned"}
            onClick={() => setActiveTab("pinned")}
            icon={<Star className="h-3.5 w-3.5" />}
            label="Pinned"
            count={filteredFavorites.length}
          />
          <TabButton
            active={activeTab === "recent"}
            onClick={() => setActiveTab("recent")}
            icon={<History className="h-3.5 w-3.5" />}
            label="Recent"
            count={filteredRecentItems.length}
          />
          {canViewSavedQueries && (
            <TabButton
              active={activeTab === "saved"}
              onClick={() => setActiveTab("saved")}
              icon={<FileCode className="h-3.5 w-3.5" />}
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
                    className="h-8 rounded-xs border-ink-500 bg-ink-200 pl-8 font-mono text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
                  />
                  <kbd className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-paper-faint sm:inline">
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
                        className="h-8 w-8 rounded-xs text-paper-dim hover:bg-ink-200 hover:text-paper"
                      >
                        <RefreshCcw className={cn("h-3.5 w-3.5", isFetchingDatabases && "animate-spin")} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Refresh</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-8 w-8 rounded-xs text-paper-dim hover:bg-ink-200 hover:text-paper">
                      <Plus className="h-3.5 w-3.5" />
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
                        openCreateTableModal("");
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
                          openUploadFileModal("");
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
                    <Skeleton key={i} className="h-7 rounded-xs bg-ink-200" />
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
                  icon={<Database className="h-5 w-5" />}
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
                  <Filter className="h-3 w-3 text-paper-faint" aria-hidden />
                  <Select value={connectionFilter} onValueChange={setConnectionFilter}>
                    <SelectTrigger className="h-7 flex-1 rounded-xs border-ink-500 bg-ink-200 font-mono text-[11px] text-paper">
                      <SelectValue placeholder="All connections" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        <span className="flex items-center gap-2">
                          <Layers className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
                          All connections
                        </span>
                      </SelectItem>
                      {activeConnectionId && (
                        <SelectItem value="current">
                          <span className="flex items-center gap-2">
                            <Pin className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
                            {activeConnectionName || "Current"}
                          </span>
                        </SelectItem>
                      )}
                      {connectionNames
                        .filter((name) => name !== activeConnectionName)
                        .map((name) => (
                          <SelectItem key={name} value={name}>
                            <span className="flex items-center gap-2">
                              <Database className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
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
                      className="h-7 w-7 rounded-xs p-0 text-paper-dim hover:bg-ink-200 hover:text-paper"
                      aria-label="Clear filter"
                    >
                      <X className="h-3.5 w-3.5" />
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
                          ? <Database className="h-3.5 w-3.5" aria-hidden />
                          : <Table2 className="h-3.5 w-3.5" aria-hidden />
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
                  icon={<Star className="h-5 w-5" />}
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
                  <Filter className="h-3 w-3 text-paper-faint" aria-hidden />
                  <Select value={connectionFilter} onValueChange={setConnectionFilter}>
                    <SelectTrigger className="h-7 flex-1 rounded-xs border-ink-500 bg-ink-200 font-mono text-[11px] text-paper">
                      <SelectValue placeholder="All connections" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        <span className="flex items-center gap-2">
                          <Layers className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
                          All connections
                        </span>
                      </SelectItem>
                      {activeConnectionId && (
                        <SelectItem value="current">
                          <span className="flex items-center gap-2">
                            <Pin className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
                            {activeConnectionName || "Current"}
                          </span>
                        </SelectItem>
                      )}
                      {connectionNames
                        .filter((name) => name !== activeConnectionName)
                        .map((name) => (
                          <SelectItem key={name} value={name}>
                            <span className="flex items-center gap-2">
                              <Database className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
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
                      className="h-7 w-7 rounded-xs p-0 text-paper-dim hover:bg-ink-200 hover:text-paper"
                      aria-label="Clear filter"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )}

              {filteredRecentItems.length > 0 ? (
                <>
                  <div className="mb-2 flex items-center justify-between px-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint">
                      Recently viewed
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => clearRecentItems()}
                      className="h-5 rounded-xs px-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint hover:bg-ink-200 hover:text-paper"
                    >
                      Clear
                    </Button>
                  </div>
                  <div className="space-y-0.5">
                    {filteredRecentItems.map((item) => (
                      <QuickAccessItem
                        key={`${item.id}-${item.connectionId || 'shared'}`}
                        icon={
                          item.type === 'database'
                            ? <Database className="h-3.5 w-3.5" aria-hidden />
                            : <Table2 className="h-3.5 w-3.5" aria-hidden />
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
                  icon={<History className="h-5 w-5" />}
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
              <div className="mb-3 flex items-center gap-2 px-1">
                <Filter className="h-3 w-3 text-paper-faint" aria-hidden />
                <Select value={connectionFilter} onValueChange={setConnectionFilter}>
                  <SelectTrigger className="h-7 flex-1 rounded-xs border-ink-500 bg-ink-200 font-mono text-[11px] text-paper">
                    <SelectValue placeholder="All connections" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xs border-ink-500 bg-ink-100 text-paper">
                    <SelectItem value="all">
                      <span className="flex items-center gap-2">
                        <Layers className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
                        All connections
                      </span>
                    </SelectItem>
                    {activeConnectionId && (
                      <SelectItem value="current">
                        <span className="flex items-center gap-2">
                          <Pin className="h-3.5 w-3.5 text-brand" aria-hidden />
                          {activeConnectionName || "Current"}
                        </span>
                      </SelectItem>
                    )}
                    {connectionNames
                      .filter((name) => name !== activeConnectionName)
                      .map((name) => (
                        <SelectItem key={name} value={name}>
                          <span className="flex items-center gap-2">
                            <Database className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
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
                    className="h-7 w-7 rounded-xs p-0 text-paper-dim hover:bg-ink-200 hover:text-paper"
                  >
                    <X className="h-3.5 w-3.5" />
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
                    className="h-8 rounded-xs border-ink-500 bg-ink-200 pl-8 font-mono text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
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
                      onDelete={
                        hasPermission(RBAC_PERMISSIONS.SAVED_QUERIES_DELETE)
                          ? handleDeleteClick
                          : undefined
                      }
                    />
                  ))}
                </div>
              ) : savedQueriesList.length > 0 ? (
                <EmptyState
                  icon={<Search className="h-5 w-5" />}
                  title="No matching queries"
                  description="Try a different search term or filter"
                />
              ) : (
                <EmptyState
                  icon={<Bookmark className="h-5 w-5" />}
                  title="No saved queries"
                  description="Save queries from the SQL editor using ⌘S"
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </ScrollArea>

      <AlertDialog open={!!queryToDelete} onOpenChange={(open) => !open && setQueryToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete Saved Query
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{queryToDelete?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              className="bg-red-600 hover:bg-red-700"
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DatabaseExplorer;
