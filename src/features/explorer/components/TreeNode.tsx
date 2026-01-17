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
import { useExplorerStore, useWorkspaceStore, genTabId } from "@/stores";
import PermissionGuard from "@/components/common/PermissionGuard";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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

  const handleNewQuery = useCallback(() => {
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
          "flex items-center py-1 px-2 rounded-md cursor-pointer transition-all duration-150 group",
          "hover:bg-white/5",
          matchesSearch && searchTerm && "bg-amber-500/10 hover:bg-amber-500/15"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleViewInfo}
      >
        {/* Expand/Collapse Button */}
        {hasChildren ? (
          <button 
            onClick={handleToggle} 
            className="p-0.5 hover:bg-white/10 rounded transition-colors mr-1"
          >
            <motion.div
              animate={{ rotate: isExpanded ? 90 : 0 }}
              transition={{ duration: 0.15 }}
            >
              <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
            </motion.div>
          </button>
        ) : (
          <span className="w-5" />
        )}

        {/* Icon */}
        {isDatabase ? (
          <Database className="w-3.5 h-3.5 text-blue-400 mr-2 flex-shrink-0" />
        ) : node.type === "view" ? (
          <Eye className="w-3.5 h-3.5 text-purple-400 mr-2 flex-shrink-0" />
        ) : (
          <Table2 className="w-3.5 h-3.5 text-emerald-400 mr-2 flex-shrink-0" />
        )}

        {/* Name */}
        <TooltipProvider>
          <Tooltip delayDuration={500}>
            <TooltipTrigger asChild>
              <span className="flex-1 text-xs text-gray-300 truncate group-hover:text-white transition-colors">
                {node.name}
              </span>
            </TooltipTrigger>
            {!isDatabase && (node.rows || node.size || node.engine) && (
              <TooltipContent side="right" className="max-w-xs">
                <div className="space-y-1 text-xs">
                  {node.engine && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400">Engine</span>
                      <span className="text-white font-medium">{node.engine}</span>
                    </div>
                  )}
                  {node.rows && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400">Rows</span>
                      <span className="text-white font-medium">{node.rows}</span>
                    </div>
                  )}
                  {node.size && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400">Size</span>
                      <span className="text-white font-medium">{node.size}</span>
                    </div>
                  )}
                </div>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        {/* Metadata Badges - Show on hover */}
        {!isDatabase && (node.rows || node.size) && (
          <div className="hidden sm:flex items-center gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {node.rows && (
              <Badge className="text-[9px] px-1 py-0 bg-blue-500/15 text-blue-400 border-0 font-normal">
                {node.rows}
              </Badge>
            )}
          </div>
        )}

        {/* Favorite Star */}
        <Button
          size="icon"
          variant="ghost"
          onClick={handleToggleFavorite}
          className={cn(
            "h-5 w-5 ml-1 p-0 transition-opacity",
            isFavorited ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
          title={isFavorited ? "Remove from pinned" : "Pin"}
        >
          <Star
            className={cn(
              "w-3 h-3 transition-colors",
              isFavorited 
                ? "fill-amber-400 text-amber-400" 
                : "text-gray-500 hover:text-amber-400"
            )}
          />
        </Button>

        {/* Actions Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => e.stopPropagation()}
              className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreVertical className="w-3.5 h-3.5 text-gray-500" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={handleViewInfo} className="text-xs gap-2">
              <Info className="w-3.5 h-3.5" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleNewQuery} className="text-xs gap-2">
              <TerminalIcon className="w-3.5 h-3.5" />
              New Query
            </DropdownMenuItem>
            
            <DropdownMenuSeparator />
            
            {isDatabase && (
              <>
                <PermissionGuard requiredPermission="CREATE TABLE" showTooltip>
                  <DropdownMenuItem onClick={() => openCreateTableModal(node.name)} className="text-xs gap-2">
                    <FilePlus className="w-3.5 h-3.5 text-emerald-400" />
                    Create Table
                  </DropdownMenuItem>
                </PermissionGuard>
                <PermissionGuard requiredPermission="INSERT" showTooltip>
                  <DropdownMenuItem onClick={() => openUploadFileModal(node.name)} className="text-xs gap-2">
                    <FileUp className="w-3.5 h-3.5 text-purple-400" />
                    Upload File
                  </DropdownMenuItem>
                </PermissionGuard>
              </>
            )}

            {!isDatabase && (
              <>
                <DropdownMenuItem
                  onClick={() => {
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
                      console.error('Invalid table identifier:', error);
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
                <PermissionGuard requiredPermission="ALTER TABLE" showTooltip>
                  <DropdownMenuItem onClick={() => openAlterTableModal(databaseName, node.name)} className="text-xs gap-2">
                    <Settings2 className="w-3.5 h-3.5" />
                    Alter Table
                  </DropdownMenuItem>
                </PermissionGuard>
                <DropdownMenuSeparator />
                <PermissionGuard requiredPermission="DROP TABLE" showTooltip>
                  <DropdownMenuItem
                    className="text-xs gap-2 text-red-400 focus:text-red-400"
                    onClick={() => {
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
