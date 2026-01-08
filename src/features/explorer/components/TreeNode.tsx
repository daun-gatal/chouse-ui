import React from "react";
import { ChevronRight, ChevronDown, MoreVertical, Database, Table2, FilePlus, Info, FileUp, Trash2, TerminalIcon, FileType } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useExplorerStore, useWorkspaceStore, genTabId } from "@/stores";
import PermissionGuard from "@/components/common/PermissionGuard";

export interface TreeNodeData {
  name: string;
  type: "database" | "table";
  children: TreeNodeData[];
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
  } = useExplorerStore();
  const { addTab } = useWorkspaceStore();

  const isExpanded = expandedNodes.has(node.name);
  const hasChildren = node.children && node.children.length > 0;
  const isDatabase = node.type === "database";
  const databaseName = isDatabase ? node.name : parentDatabaseName;

  const handleToggle = () => {
    if (hasChildren) {
      toggleNode(node.name);
    }
  };

  const handleViewInfo = () => {
    if (isDatabase) {
      navigate(`/explorer?database=${node.name}`);
    } else {
      navigate(`/explorer?database=${databaseName}&table=${node.name}`);
    }
  };

  const handleNewQuery = () => {
    const query = isDatabase
      ? `SELECT * FROM ${node.name}. LIMIT 100`
      : `SELECT * FROM ${databaseName}.${node.name} LIMIT 100`;

    addTab({
      id: genTabId(),
      type: "sql",
      title: `Query ${node.name}`,
      content: query,
    });
  };

  // Match search term
  const matchesSearch = node.name.toLowerCase().includes(searchTerm.toLowerCase());

  if (searchTerm && !matchesSearch && !hasChildren) {
    return null;
  }

  // Filter children by search term
  const filteredChildren = hasChildren
    ? node.children.filter(
        (child) =>
          !searchTerm ||
          child.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : [];

  if (searchTerm && !matchesSearch && filteredChildren.length === 0) {
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
          <Database className="w-4 h-4 text-blue-400 mr-2" />
        ) : (
          <Table2 className="w-4 h-4 text-green-400 mr-2" />
        )}

        {/* Name */}
        <span
          className="flex-1 text-sm text-gray-200 truncate"
          onClick={handleViewInfo}
          title={node.name}
        >
          {node.name}
        </span>

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

export default TreeNode;
