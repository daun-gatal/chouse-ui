import React, { useCallback, useMemo } from "react";
import { ChevronRight, ChevronDown, MoreVertical, Database, Table2, FilePlus, Info, FileUp, Trash2, TerminalIcon, FileType, Settings2, Eye, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
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
import { useExplorerStore, useWorkspaceStore, genTabId, RBAC_PERMISSIONS } from "@/stores";
import PermissionGuard from "@/components/common/PermissionGuard";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { log } from "@/lib/log";
import { escapeQualifiedIdentifier } from "@/helpers/sqlUtils";

export interface TreeNodeData {
  name: string;
  type: "database" | "table" | "view";
  children: TreeNodeData[];
  rows?: string;
  size?: string;
  engine?: string;
}

interface TreeNodeProps {
  node: TreeNodeData;
  level?: number;
  searchTerm?: string;
  parentDatabaseName?: string;
  refreshData?: () => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({
  node,
  level = 0,
  searchTerm = "",
  parentDatabaseName = "",
  refreshData,
}) => {
  const navigate = useNavigate();
  const {
    expandedNodes,
    toggleNode,
    openCreateTableModal,
    openUploadFileModal,
    openAlterTableModal,
    toggleFavorite,
    addRecentItem,
  } = useExplorerStore();
  
  // Subscribe to favorites array directly for reactivity
  const favorites = useExplorerStore((state) => state.favorites);
  const { addTab } = useWorkspaceStore();

  // Memoize computed values
  const isExpanded = useMemo(() => expandedNodes.has(node.name), [expandedNodes, node.name]);
  const hasChildren = useMemo(() => node.children && node.children.length > 0, [node.children]);
  const isDatabase = useMemo(() => node.type === "database", [node.type]);
  const databaseName = useMemo(() => isDatabase ? node.name : parentDatabaseName, [isDatabase, node.name, parentDatabaseName]);

  // Memoize search matching
  const matchesSearch = useMemo(() => {
    if (!searchTerm) return true;
    return node.name.toLowerCase().includes(searchTerm.toLowerCase());
  }, [node.name, searchTerm]);

  // Memoize filtered children
  const filteredChildren = useMemo(() => {
    if (!hasChildren) return [];
    if (!searchTerm) return node.children || [];
    return node.children.filter(
      (child) => child.name.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [hasChildren, node.children, searchTerm]);

  // Early return for non-matching nodes
  const shouldRender = useMemo(() => {
    if (!searchTerm) return true;
    if (matchesSearch) return true;
    if (hasChildren && filteredChildren.length > 0) return true;
    return false;
  }, [searchTerm, matchesSearch, hasChildren, filteredChildren.length]);

  // Memoized callbacks
  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasChildren) {
      toggleNode(node.name);
    }
  }, [hasChildren, toggleNode, node.name]);

  const handleViewInfo = useCallback(async () => {
    if (isDatabase) {
      await addRecentItem(node.name);
      navigate(`/explorer?database=${node.name}`);
    } else {
      await addRecentItem(databaseName, node.name);
      navigate(`/explorer?database=${databaseName}&table=${node.name}`);
    }
  }, [isDatabase, navigate, node.name, databaseName, addRecentItem]);

  const handleToggleFavorite = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(databaseName, isDatabase ? undefined : node.name);
  }, [toggleFavorite, databaseName, isDatabase, node.name]);

  const isFavorited = useMemo(() => {
    const id = isDatabase ? databaseName : `${databaseName}.${node.name}`;
    return favorites.some(f => f.id === id);
  }, [favorites, databaseName, isDatabase, node.name]);

  const handleNewQuery = useCallback((e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    const query = isDatabase
      ? `SELECT * FROM ${node.name}. LIMIT 100`
      : `SELECT * FROM ${databaseName}.${node.name} LIMIT 100`;

    addTab({
      id: genTabId(),
      type: "sql",
      title: `Query ${node.name}`,
      content: query,
    });
  }, [isDatabase, node.name, databaseName, addTab]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div className="select-none">
      <div
        className={cn(
          "group flex cursor-pointer items-center rounded-xs py-1 px-2 transition-colors",
          "hover:bg-ink-200",
          matchesSearch && searchTerm && "bg-brand/[0.08] hover:bg-brand/[0.12]"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleViewInfo}
      >
        {/* Expand/Collapse */}
        {hasChildren ? (
          <button
            type="button"
            onClick={handleToggle}
            className="mr-1 rounded-xs p-0.5 transition-colors hover:bg-ink-300"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            <motion.div
              animate={{ rotate: isExpanded ? 90 : 0 }}
              transition={{ duration: 0.15 }}
            >
              <ChevronRight className="h-3.5 w-3.5 text-paper-faint" aria-hidden />
            </motion.div>
          </button>
        ) : (
          <span className="w-5" />
        )}

        {/* Icon — monochrome paper-dim; shape distinguishes type */}
        {isDatabase ? (
          <Database className="mr-2 h-3.5 w-3.5 shrink-0 text-paper-dim" aria-hidden />
        ) : node.type === "view" ? (
          <Eye className="mr-2 h-3.5 w-3.5 shrink-0 text-paper-dim" aria-hidden />
        ) : (
          <Table2 className="mr-2 h-3.5 w-3.5 shrink-0 text-paper-dim" aria-hidden />
        )}

        {/* Name */}
        <TooltipProvider>
          <Tooltip delayDuration={500}>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "flex-1 truncate font-mono text-[12px] transition-colors",
                  "text-paper-muted group-hover:text-paper"
                )}
              >
                {node.name}
              </span>
            </TooltipTrigger>
            {!isDatabase && (node.rows || node.size || node.engine) && (
              <TooltipContent side="right" className="max-w-xs">
                <div className="space-y-1.5 font-mono text-[11px]">
                  {node.engine && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="uppercase tracking-[0.14em] text-paper-faint">Engine</span>
                      <span className="text-paper">{node.engine}</span>
                    </div>
                  )}
                  {node.rows && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="uppercase tracking-[0.14em] text-paper-faint">Rows</span>
                      <span className="text-paper">{node.rows}</span>
                    </div>
                  )}
                  {node.size && (
                    <div className="flex items-center justify-between gap-4">
                      <span className="uppercase tracking-[0.14em] text-paper-faint">Size</span>
                      <span className="text-paper">{node.size}</span>
                    </div>
                  )}
                </div>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        {/* Metadata badge — show on hover */}
        {!isDatabase && (node.rows || node.size) && (
          <div className="ml-2 hidden items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 sm:flex">
            {node.rows && (
              <Badge className="border border-ink-500 bg-ink-200 px-1 py-0 font-mono text-[9px] font-normal text-paper-muted">
                {node.rows}
              </Badge>
            )}
          </div>
        )}

        {/* Favorite star */}
        <Button
          size="icon"
          variant="ghost"
          onClick={handleToggleFavorite}
          className={cn(
            "ml-1 h-5 w-5 rounded-xs p-0 transition-all hover:bg-ink-300",
            isFavorited ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
          title={isFavorited ? "Remove from pinned" : "Pin"}
        >
          <Star
            className={cn(
              "h-3 w-3 transition-colors",
              isFavorited
                ? "fill-brand text-brand"
                : "text-paper-faint hover:text-brand"
            )}
          />
        </Button>

        {/* Actions menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => e.stopPropagation()}
              className="h-5 w-5 rounded-xs opacity-0 transition-all hover:bg-ink-300 group-hover:opacity-100"
              aria-label="More actions"
            >
              <MoreVertical className="h-3.5 w-3.5 text-paper-faint" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem 
              onClick={(e) => {
                e.stopPropagation();
                handleViewInfo();
              }} 
              className="text-xs gap-2"
            >
              <Info className="w-3.5 h-3.5" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={(e) => {
                e.stopPropagation();
                handleNewQuery(e);
              }} 
              className="text-xs gap-2"
            >
              <TerminalIcon className="w-3.5 h-3.5" />
              New Query
            </DropdownMenuItem>
            
            <DropdownMenuSeparator />
            
            {isDatabase && (
              <>
                <PermissionGuard requiredPermission={RBAC_PERMISSIONS.TABLE_CREATE} showTooltip>
                  <DropdownMenuItem 
                    onClick={(e) => {
                      e.stopPropagation();
                      openCreateTableModal(node.name);
                    }} 
                    className="text-xs gap-2"
                  >
                    <FilePlus className="h-3.5 w-3.5 text-paper-muted" aria-hidden />
                    Create Table
                  </DropdownMenuItem>
                </PermissionGuard>
                <PermissionGuard requiredPermission={RBAC_PERMISSIONS.TABLE_INSERT} showTooltip>
                  <DropdownMenuItem 
                    onClick={(e) => {
                      e.stopPropagation();
                      openUploadFileModal(node.name);
                    }} 
                    className="text-xs gap-2"
                  >
                    <FileUp className="h-3.5 w-3.5 text-paper-muted" aria-hidden />
                    Upload File
                  </DropdownMenuItem>
                </PermissionGuard>
              </>
            )}

            {!isDatabase && (
              <>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    try {
                      // Validate and escape identifiers to prevent SQL injection
                      const escapedTable = escapeQualifiedIdentifier([databaseName, node.name]);
                      addTab({
                        id: genTabId(),
                        type: "sql",
                        title: `Describe ${node.name}`,
                        content: `DESCRIBE TABLE ${escapedTable}`,
                      });
                    } catch (error) {
                      log.error('Invalid table identifier:', error);
                      // Still add tab but with error message
                      addTab({
                        id: genTabId(),
                        type: "sql",
                        title: `Describe ${node.name}`,
                        content: `-- Error: Invalid table identifier - ${(error as Error).message}`,
                      });
                    }
                  }}
                  className="text-xs gap-2"
                >
                  <FileType className="w-3.5 h-3.5" />
                  Describe Table
                </DropdownMenuItem>
                <PermissionGuard requiredPermission={RBAC_PERMISSIONS.TABLE_ALTER} showTooltip>
                  <DropdownMenuItem 
                    onClick={(e) => {
                      e.stopPropagation();
                      openAlterTableModal(databaseName, node.name);
                    }} 
                    className="text-xs gap-2"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    Alter Table
                  </DropdownMenuItem>
                </PermissionGuard>
                <DropdownMenuSeparator />
                <PermissionGuard requiredPermission={RBAC_PERMISSIONS.TABLE_DROP} showTooltip>
                  <DropdownMenuItem
                    className="text-xs gap-2 text-red-400 focus:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      addTab({
                        id: genTabId(),
                        type: "sql",
                        title: `Drop ${node.name}`,
                        content: `-- WARNING: This will permanently delete the table!\nDROP TABLE ${databaseName}.${node.name}`,
                      });
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Drop Table
                  </DropdownMenuItem>
                </PermissionGuard>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Children */}
      <AnimatePresence initial={false}>
        {isExpanded && filteredChildren.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            {filteredChildren.map((child) => (
              <TreeNode
                key={`${databaseName}-${child.name}`}
                node={child}
                level={level + 1}
                searchTerm={searchTerm}
                parentDatabaseName={databaseName}
                refreshData={refreshData}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// Memoize TreeNode to prevent unnecessary re-renders
export default React.memo(TreeNode, (prevProps, nextProps) => {
  return (
    prevProps.node.name === nextProps.node.name &&
    prevProps.node.type === nextProps.node.type &&
    prevProps.level === nextProps.level &&
    prevProps.searchTerm === nextProps.searchTerm &&
    prevProps.parentDatabaseName === nextProps.parentDatabaseName &&
    prevProps.node.children?.length === nextProps.node.children?.length
  );
});
