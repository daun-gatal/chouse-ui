/**
 * RBAC Roles Table Component
 * 
 * Displays a list of roles with their permissions.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield,
  Plus,
  MoreHorizontal,
  Edit,
  Trash2,
  Users,
  Lock,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';
import ConfirmationDialog from '@/components/common/ConfirmationDialog';

import { rbacRolesApi, type RbacRole } from '@/api/rbac';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores/rbac';
import { cn } from '@/lib/utils';

// ============================================
// Role Colors
// ============================================

const ROLE_COLORS: Record<string, { bg: string; text: string; border: string; icon: string }> = {
  super_admin: { bg: 'bg-red-500/20', text: 'text-red-300', border: 'border-red-500/30', icon: '🛡️' },
  admin: { bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/30', icon: '👑' },
  developer: { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/30', icon: '👨‍💻' },
  analyst: { bg: 'bg-green-500/20', text: 'text-green-300', border: 'border-green-500/30', icon: '📊' },
  viewer: { bg: 'bg-purple-500/20', text: 'text-purple-300', border: 'border-purple-500/30', icon: '👁️' },
};

const getRoleStyle = (role: string) => {
  return ROLE_COLORS[role] || { bg: 'bg-gray-500/20', text: 'text-gray-300', border: 'border-gray-500/30', icon: '🔐' };
};

// ============================================
// Permission Categories for Display
// ============================================

const PERMISSION_CATEGORIES: Record<string, string> = {
  'users': 'User Management',
  'roles': 'Role Management',
  'clickhouse': 'ClickHouse',
  'database': 'Database',
  'table': 'Table',
  'query': 'Query',
  'saved_queries': 'Saved Queries',
  'metrics': 'Metrics',
  'settings': 'Settings',
  'audit': 'Audit',
};

const getPermissionCategory = (permission: string): string => {
  const prefix = permission.split(':')[0];
  return PERMISSION_CATEGORIES[prefix] || 'Other';
};

// ============================================
// Component Props
// ============================================

interface RbacRolesTableProps {
  onCreateRole?: () => void;
  onEditRole?: (role: RbacRole) => void;
}

// ============================================
// Component
// ============================================

export const RbacRolesTable: React.FC<RbacRolesTableProps> = ({
  onCreateRole,
  onEditRole,
}) => {
  const queryClient = useQueryClient();
  const { hasPermission } = useRbacStore();

  // State
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());
  const [deleteRoleId, setDeleteRoleId] = useState<string | null>(null);

  // Query
  const { data: roles = [], isLoading, refetch } = useQuery({
    queryKey: ['rbac-roles'],
    queryFn: () => rbacRolesApi.list(),
  });

  // Mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => rbacRolesApi.delete(id),
    onSuccess: () => {
      toast.success('Role deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['rbac-roles'] });
      setDeleteRoleId(null);
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete role: ${error.message}`);
    },
  });

  // Permissions
  const canCreate = hasPermission(RBAC_PERMISSIONS.ROLES_CREATE);
  const canUpdate = hasPermission(RBAC_PERMISSIONS.ROLES_UPDATE);
  const canDelete = hasPermission(RBAC_PERMISSIONS.ROLES_DELETE);

  // Toggle expanded
  const toggleExpanded = (roleId: string) => {
    setExpandedRoles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(roleId)) {
        newSet.delete(roleId);
      } else {
        newSet.add(roleId);
      }
      return newSet;
    });
  };

  // Group permissions by category
  const groupPermissions = (permissions: string[]) => {
    const grouped: Record<string, string[]> = {};
    permissions.forEach((perm) => {
      const category = getPermissionCategory(perm);
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(perm);
    });
    return grouped;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/20">
            <Shield className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Roles</h2>
            <p className="text-sm text-gray-400">{roles.length} roles defined</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          {canCreate && onCreateRole && (
            <Button onClick={onCreateRole} className="gap-2">
              <Plus className="h-4 w-4" />
              Add Role
            </Button>
          )}
        </div>
      </div>

      {/* Roles List */}
      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))
        ) : roles.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            No roles found
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {roles.map((role) => {
              const style = getRoleStyle(role.name);
              const isExpanded = expandedRoles.has(role.id);
              const groupedPermissions = groupPermissions(role.permissions);

              return (
                <motion.div
                  key={role.id}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className={cn(
                    'rounded-lg border overflow-hidden',
                    style.bg,
                    style.border
                  )}
                >
                  <Collapsible open={isExpanded} onOpenChange={() => toggleExpanded(role.id)}>
                    {/* Role Header */}
                    <div className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-4">
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </CollapsibleTrigger>
                        <div className="text-2xl">{style.icon}</div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className={cn('font-semibold', style.text)}>
                              {role.displayName}
                            </h3>
                            {role.isSystem && (
                              <Badge variant="outline" className="text-xs bg-white/10">
                                <Lock className="h-3 w-3 mr-1" />
                                System
                              </Badge>
                            )}
                            {role.isDefault && (
                              <Badge variant="outline" className="text-xs bg-green-500/20 text-green-300">
                                Default
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-400">{role.description}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        {/* Stats */}
                        <div className="flex items-center gap-4 text-sm text-gray-400">
                          <div className="flex items-center gap-1">
                            <Users className="h-4 w-4" />
                            <span>{role.userCount || 0} users</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Shield className="h-4 w-4" />
                            <span>{role.permissions.length} permissions</span>
                          </div>
                        </div>

                        {/* Actions */}
                        {!role.isSystem && (canUpdate || canDelete) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {canUpdate && onEditRole && (
                                <DropdownMenuItem onClick={() => onEditRole(role)}>
                                  <Edit className="h-4 w-4 mr-2" />
                                  Edit Role
                                </DropdownMenuItem>
                              )}
                              {canUpdate && canDelete && <DropdownMenuSeparator />}
                              {canDelete && (
                                <DropdownMenuItem
                                  onClick={() => setDeleteRoleId(role.id)}
                                  className="text-red-400 focus:text-red-400"
                                  disabled={role.userCount && role.userCount > 0}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete Role
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>

                    {/* Permissions */}
                    <CollapsibleContent>
                      <div className="px-4 pb-4 pt-0">
                        <div className="p-4 rounded-lg bg-black/20 space-y-4">
                          <h4 className="text-sm font-medium text-white">Permissions</h4>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {Object.entries(groupedPermissions).map(([category, perms]) => (
                              <div key={category} className="space-y-2">
                                <h5 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                                  {category}
                                </h5>
                                <div className="flex flex-wrap gap-1">
                                  {perms.map((perm) => (
                                    <Badge
                                      key={perm}
                                      variant="outline"
                                      className="text-xs bg-white/5"
                                    >
                                      {perm.split(':').slice(1).join(':')}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* Delete Confirmation */}
      <ConfirmationDialog
        isOpen={!!deleteRoleId}
        onClose={() => setDeleteRoleId(null)}
        title="Delete Role"
        description="Are you sure you want to delete this role? Users assigned to this role will lose these permissions."
        confirmText="Delete"
        onConfirm={() => deleteRoleId && deleteMutation.mutate(deleteRoleId)}
        variant="danger"
      />
    </div>
  );
};

export default RbacRolesTable;
