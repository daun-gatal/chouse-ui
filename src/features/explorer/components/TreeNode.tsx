import React, { useCallback, useMemo, useEffect, useRef } from "react";
import { ChevronRight, ChevronDown, MoreVertical, Database, Table2, FilePlus, Info, FileUp, Trash2, TerminalIcon, FileType, Settings2, Eye, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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

export interface TreeNodeData {
  name: string;
  type: "database" | "table" | "view";
  children: TreeNodeData[];
  rows?: string; // Formatted row count (e.g., "1.2M")
  size?: string; // Formatted size (e.g., "500 MB")
  engine?: string; // Table engine type
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
    isFavorite,
    toggleFavorite,
    addRecentItem,
  } = useExplorerStore();
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

  // Early return for non-matching nodes (memoized check)
  const shouldRender = useMemo(() => {
    if (!searchTerm) return true;
    if (matchesSearch) return true;
    if (hasChildren && filteredChildren.length > 0) return true;
    return false;
  }, [searchTerm, matchesSearch, hasChildren, filteredChildren.length]);

  // Memoized callbacks
  const handleToggle = useCallback(() => {
    if (hasChildren) {
      toggleNode(node.name);
    }
  }, [hasChildren, toggleNode, node.name]);

  const handleViewInfo = useCallback(async () => {
    // Track as recent item
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
    return isFavorite(databaseName, isDatabase ? undefined : node.name);
  }, [isFavorite, databaseName, isDatabase, node.name]);

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
        className={`flex items-center py-1 px-2 hover:bg-white/5 rounded-md cursor-pointer transition-colors group ${
          matchesSearch && searchTerm ? "bg-yellow-500/10" : ""
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {/* Expand/Collapse */}
        {hasChildren ? (
          <button onClick={handleToggle} className="p-1 hover:bg-white/10 rounded">
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400" />
            )}
          </button>
        ) : (
          <span className="w-6" />
        )}

        {/* Icon */}
        {isDatabase ? (
          <Database className="w-4 h-4 text-blue-400 mr-2 flex-shrink-0" />
        ) : node.type === "view" ? (
          <Eye className="w-4 h-4 text-purple-400 mr-2 flex-shrink-0" />
        ) : (
          <Table2 className="w-4 h-4 text-green-400 mr-2 flex-shrink-0" />
        )}

        {/* Name and Metadata */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="flex-1 text-sm text-gray-200 truncate cursor-pointer"
                onClick={handleViewInfo}
                title={node.name}
              >
                {node.name}
              </span>
            </TooltipTrigger>
            {!isDatabase && (node.rows || node.size || node.engine) && (
              <TooltipContent side="right" className="max-w-xs">
                <div className="space-y-1 text-xs">
                  {node.engine && (
                    <div>
                      <span className="text-gray-400">Engine: </span>
                      <span className="text-white">{node.engine}</span>
                    </div>
                  )}
                  {node.rows && (
                    <div>
                      <span className="text-gray-400">Rows: </span>
                      <span className="text-white">{node.rows}</span>
                    </div>
                  )}
                  {node.size && (
                    <div>
                      <span className="text-gray-400">Size: </span>
                      <span className="text-white">{node.size}</span>
                    </div>
                  )}
                </div>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        {/* Favorite Star */}
        <Button
          size="icon"
          variant="ghost"
          onClick={handleToggleFavorite}
          className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity p-0"
          title={isFavorited ? "Remove from favorites" : "Add to favorites"}
        >
          <Star
            className={cn(
              "w-3.5 h-3.5 transition-colors",
              isFavorited ? "fill-yellow-400 text-yellow-400" : "text-gray-500 hover:text-yellow-400"
            )}
          />
        </Button>

        {/* Metadata Badges */}
        {!isDatabase && (node.rows || node.size) && (
          <div className="flex items-center gap-1 mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {node.rows && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-blue-500/20 text-blue-300 border-blue-500/30">
                {node.rows}
              </Badge>
            )}
            {node.size && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-purple-500/20 text-purple-300 border-purple-500/30">
                {node.size}
              </Badge>
            )}
          </div>
        )}

        {/* Actions Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleViewInfo}>
              <Info className="w-4 h-4 mr-2" />
              View Information
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleNewQuery}>
              <TerminalIcon className="w-4 h-4 mr-2" />
              New Query
            </DropdownMenuItem>
            
            {isDatabase && (
              <>
                <PermissionGuard requiredPermission="CREATE TABLE" showTooltip>
                  <DropdownMenuItem onClick={() => openCreateTableModal(node.name)}>
                    <FilePlus className="w-4 h-4 mr-2" />
                    Create Table
                  </DropdownMenuItem>
                </PermissionGuard>
                <PermissionGuard requiredPermission="INSERT" showTooltip>
                  <DropdownMenuItem onClick={() => openUploadFileModal(node.name)}>
                    <FileUp className="w-4 h-4 mr-2" />
                    Upload File
                  </DropdownMenuItem>
                </PermissionGuard>
              </>
            )}

            {!isDatabase && (
              <>
                <DropdownMenuItem
                  onClick={() => {
                    addTab({
                      id: genTabId(),
                      type: "sql",
                      title: `Describe ${node.name}`,
                      content: `DESCRIBE TABLE ${databaseName}.${node.name}`,
                    });
                  }}
                >
                  <FileType className="w-4 h-4 mr-2" />
                  Describe Table
                </DropdownMenuItem>
                <PermissionGuard requiredPermission="ALTER TABLE" showTooltip>
                  <DropdownMenuItem onClick={() => openAlterTableModal(databaseName, node.name)}>
                    <Settings2 className="w-4 h-4 mr-2" />
                    Alter Table
                  </DropdownMenuItem>
                </PermissionGuard>
                <PermissionGuard requiredPermission="DROP TABLE" showTooltip>
                  <DropdownMenuItem
                    className="text-red-500"
                    onClick={() => {
                      addTab({
                        id: genTabId(),
                        type: "sql",
                        title: `Drop ${node.name}`,
                        content: `-- WARNING: This will permanently delete the table!\nDROP TABLE ${databaseName}.${node.name}`,
                      });
                    }}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Drop Table
                  </DropdownMenuItem>
                </PermissionGuard>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Children */}
      {isExpanded && filteredChildren.length > 0 && (
        <div>
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
        </div>
      )}
    </div>
  );
};

// Memoize TreeNode to prevent unnecessary re-renders
export default React.memo(TreeNode, (prevProps, nextProps) => {
  // Custom comparison function for better performance
  return (
    prevProps.node.name === nextProps.node.name &&
    prevProps.node.type === nextProps.node.type &&
    prevProps.level === nextProps.level &&
    prevProps.searchTerm === nextProps.searchTerm &&
    prevProps.parentDatabaseName === nextProps.parentDatabaseName &&
    prevProps.node.children?.length === nextProps.node.children?.length
  );
});
