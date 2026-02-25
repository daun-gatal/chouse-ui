/**
 * RBAC Roles Table Component
 * 
 * Displays a list of roles with their permissions.
 * Beautiful, interactive UI with smooth animations.
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
  Sparkles,
  CheckCircle2,
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
import { RoleFormDialog } from './RoleFormDialog';

// ============================================
// Role Colors
// ============================================

const ROLE_COLORS: Record<string, { bg: string; text: string; border: string; icon: string; gradient: string }> = {
  super_admin: {
    bg: 'bg-gradient-to-br from-red-500/20 via-red-500/10 to-red-500/20',
    text: 'text-red-300',
    border: 'border-red-500/30',
    icon: '👑',
    gradient: 'from-red-500/30 to-orange-500/30',
  },
  admin: {
    bg: 'bg-gradient-to-br from-orange-500/20 via-orange-500/10 to-orange-500/20',
    text: 'text-orange-300',
    border: 'border-orange-500/30',
    icon: '🛡️',
    gradient: 'from-orange-500/30 to-yellow-500/30',
  },
  developer: {
    bg: 'bg-gradient-to-br from-blue-500/20 via-blue-500/10 to-blue-500/20',
    text: 'text-blue-300',
    border: 'border-blue-500/30',
    icon: '👨‍💻',
    gradient: 'from-blue-500/30 to-cyan-500/30',
  },
  analyst: {
    bg: 'bg-gradient-to-br from-green-500/20 via-green-500/10 to-green-500/20',
    text: 'text-green-300',
    border: 'border-green-500/30',
    icon: '📊',
    gradient: 'from-green-500/30 to-emerald-500/30',
  },
  viewer: {
    bg: 'bg-gradient-to-br from-purple-500/20 via-purple-500/10 to-purple-500/20',
    text: 'text-purple-300',
    border: 'border-purple-500/30',
    icon: '👁️',
    gradient: 'from-purple-500/30 to-pink-500/30',
  },
  guest: {
    bg: 'bg-gradient-to-br from-cyan-500/20 via-cyan-500/10 to-cyan-500/20',
    text: 'text-cyan-300',
    border: 'border-cyan-500/30',
    icon: '👋',
    gradient: 'from-cyan-500/30 to-blue-500/30',
  },
};

const getRoleStyle = (role: string) => {
  return ROLE_COLORS[role] || {
    bg: 'bg-gradient-to-br from-gray-500/20 via-gray-500/10 to-gray-500/20',
    text: 'text-gray-300',
    border: 'border-gray-500/30',
    icon: '🔐',
    gradient: 'from-gray-500/30 to-gray-600/30',
  };
};

// ============================================
// Permission Categories for Display
// ============================================

const PERMISSION_CATEGORIES: Record<string, string> = {
  'users': 'User Management',
  'roles': 'Role Management',
  'connections': 'ClickHouse Connections',
  'clickhouse': 'ClickHouse Users',
  'database': 'Database',
  'table': 'Table',
  'query': 'Query',
  'saved_queries': 'Saved Queries',
  'metrics': 'Metrics',
  'settings': 'Settings',
  'audit': 'Audit',
  'live_queries': 'Live Queries',
  'ai': 'AI Assistant',
  'ai_models': 'AI Models',
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
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RbacRole | null>(null);

  // Query
  const { data: roles = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['rbac-roles'],
    queryFn: () => rbacRolesApi.list(),
  });

  // Mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => rbacRolesApi.delete(id),
    onSuccess: () => {
      toast.success('Role deleted successfully', {
        icon: <CheckCircle2 className="h-5 w-5 text-green-400" />,
      });
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
    <div className="p-6 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <motion.div
            whileHover={{ scale: 1.1, rotate: 5 }}
            className="p-3 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/30"
          >
            <Shield className="h-6 w-6 text-purple-400" />
          </motion.div>
          <div>
            <h2 className="text-xl font-bold text-white">Roles</h2>
            <p className="text-sm text-gray-400">{roles.length} roles defined</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2 bg-white/5 border-white/10 hover:bg-white/10 transition-all"
          >
            <motion.div
              animate={{ rotate: isFetching ? 360 : 0 }}
              transition={{ duration: 1, repeat: isFetching ? Infinity : 0, ease: 'linear' }}
            >
              <RefreshCw className="h-4 w-4" />
            </motion.div>
            Refresh
          </Button>
          {canCreate && (
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCreateDialogOpen(true)}
                className="gap-2 bg-white/5 border-white/10 hover:bg-white/10 transition-all"
              >
                <Plus className="h-4 w-4" />
                Add Role
              </Button>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* Roles List */}
      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl bg-white/5" />
          ))
        ) : roles.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16 text-gray-400"
          >
            <Shield className="h-12 w-12 mx-auto mb-4 text-gray-600" />
            <p className="text-lg">No roles found</p>
            <p className="text-sm mt-2">Create your first role to get started</p>
          </motion.div>
        ) : (
          <AnimatePresence mode="popLayout">
            {roles.map((role, index) => {
              const style = getRoleStyle(role.name);
              const isExpanded = expandedRoles.has(role.id);
              const groupedPermissions = groupPermissions(role.permissions);

              return (
                <motion.div
                  key={role.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20, scale: 0.95 }}
                  transition={{ delay: index * 0.05, duration: 0.3 }}
                  whileHover={{ scale: 1.01 }}
                  className={cn(
                    'rounded-xl border overflow-hidden backdrop-blur-sm transition-all',
                    style.bg,
                    style.border,
                    'hover:shadow-lg hover:shadow-purple-500/10'
                  )}
                >
                  <Collapsible open={isExpanded} onOpenChange={() => toggleExpanded(role.id)}>
                    {/* Role Header */}
                    <div className="flex items-center justify-between p-5">
                      <div className="flex items-center gap-4 flex-1">
                        <CollapsibleTrigger className="h-9 w-9 p-0 inline-flex items-center justify-center rounded-lg hover:bg-white/10 transition-all group">
                          <motion.div
                            animate={{ rotate: isExpanded ? 90 : 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-5 w-5 text-purple-400" />
                            ) : (
                              <ChevronRight className="h-5 w-5 text-gray-400 group-hover:text-purple-400 transition-colors" />
                            )}
                          </motion.div>
                        </CollapsibleTrigger>
                        <motion.div
                          whileHover={{ scale: 1.1, rotate: 5 }}
                          className="text-3xl"
                        >
                          {style.icon}
                        </motion.div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className={cn('text-lg font-bold', style.text)}>
                              {role.displayName}
                            </h3>
                            {role.isSystem && (
                              <Badge
                                variant="outline"
                                className="text-xs bg-amber-500/20 text-amber-300 border-amber-500/30"
                              >
                                <Lock className="h-3 w-3 mr-1" />
                                System
                              </Badge>
                            )}
                            {role.isDefault && (
                              <Badge
                                variant="outline"
                                className="text-xs bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-300 border-green-500/30"
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Default
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-400 mt-1">{role.description || 'No description'}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        {/* Stats */}
                        <div className="flex items-center gap-4 text-sm">
                          <motion.div
                            whileHover={{ scale: 1.1 }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10"
                          >
                            <Users className="h-4 w-4 text-blue-400" />
                            <span className="text-gray-300 font-medium">{role.userCount || 0}</span>
                            <span className="text-gray-500 text-xs">users</span>
                          </motion.div>
                          <motion.div
                            whileHover={{ scale: 1.1 }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10"
                          >
                            <Shield className="h-4 w-4 text-purple-400" />
                            <span className="text-gray-300 font-medium">{role.permissions.length}</span>
                            <span className="text-gray-500 text-xs">perms</span>
                          </motion.div>
                        </div>

                        {/* Actions */}
                        {(canUpdate || canDelete) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-9 w-9 p-0 hover:bg-white/10"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </motion.div>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-gray-900 border-gray-800">
                              {canUpdate && (
                                <DropdownMenuItem
                                  onClick={() => setEditingRole(role)}
                                  className="hover:bg-white/10 cursor-pointer"
                                >
                                  <Edit className="h-4 w-4 mr-2" />
                                  Edit Role
                                </DropdownMenuItem>
                              )}
                              {canUpdate && canDelete && !role.isSystem && <DropdownMenuSeparator className="bg-gray-800" />}
                              {canDelete && !role.isSystem && (
                                <DropdownMenuItem
                                  onClick={() => setDeleteRoleId(role.id)}
                                  className="text-red-400 focus:text-red-400 hover:bg-red-500/10 cursor-pointer"
                                  disabled={(role.userCount ?? 0) > 0}
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
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="px-5 pb-5 pt-0"
                      >
                        <div className="p-5 rounded-xl bg-gradient-to-br from-black/40 to-black/20 border border-white/10 backdrop-blur-sm space-y-4">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-purple-400" />
                            <h4 className="text-sm font-semibold text-white">Permissions</h4>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {Object.entries(groupedPermissions).map(([category, perms]) => (
                              <motion.div
                                key={category}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 }}
                                className="space-y-2 p-3 rounded-lg bg-white/5 border border-white/10"
                              >
                                <h5 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                                  {category}
                                </h5>
                                <div className="flex flex-wrap gap-1.5">
                                  {perms.map((perm) => (
                                    <Badge
                                      key={perm}
                                      variant="outline"
                                      className="text-xs bg-gradient-to-r from-purple-500/10 to-blue-500/10 border-purple-500/20 text-purple-300 hover:border-purple-500/40 transition-colors"
                                    >
                                      {perm.split(':').slice(1).join(':')}
                                    </Badge>
                                  ))}
                                </div>
                              </motion.div>
                            ))}
                          </div>
                        </div>
                      </motion.div>
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

      {/* Create Role Dialog */}
      <RoleFormDialog
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        role={null}
        onSuccess={() => {
          setIsCreateDialogOpen(false);
          if (onCreateRole) onCreateRole();
        }}
      />

      {/* Edit Role Dialog */}
      <RoleFormDialog
        isOpen={!!editingRole}
        onClose={() => setEditingRole(null)}
        role={editingRole}
        onSuccess={() => {
          setEditingRole(null);
          if (onEditRole && editingRole) onEditRole(editingRole);
        }}
      />
    </div>
  );
};

export default RbacRolesTable;
