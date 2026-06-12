/**
 * RBAC Roles Table Component
 * 
 * Displays a list of roles with their permissions.
 * Beautiful, interactive UI with smooth animations.
 */

import React, { useState, useMemo } from 'react';
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
  Database,
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

import { rbacRolesApi, rbacDataAccessPoliciesApi, type RbacRole } from '@/api/rbac';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores/rbac';
import { cn } from '@/lib/utils';
import { RoleFormDialog } from './RoleFormDialog';

// ============================================
// Role Colors
// ============================================

// Editorial: uniform hairline chrome for every role; identity comes from the
// role name itself, not from per-role color theming.
const ROLE_STYLE = {
  bg: 'bg-ink-200',
  text: 'text-paper',
  border: 'border-ink-500',
  gradient: 'from-ink-200 to-ink-200', // unused but kept for API compat
} as const;

const ROLE_ICONS: Record<string, string> = {
  super_admin: 'SA',
  admin: 'AD',
  developer: 'DV',
  analyst: 'AN',
  viewer: 'VW',
  guest: 'GS',
};

const getRoleStyle = (role: string) => ({
  ...ROLE_STYLE,
  icon: ROLE_ICONS[role] || role.slice(0, 2).toUpperCase(),
});

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
  'logs': 'Monitoring',
  'parts': 'Monitoring',
  'schema_advisor': 'Monitoring',
  'cluster': 'Monitoring',
  'errors': 'Monitoring',
  'fleet': 'Fleet Management',
  'doctor': 'Fleet Doctor',
  'settings': 'Settings',
  'audit': 'Audit',
  'live_queries': 'Live Queries',
  'ai': 'AI Assistant',
  'ai_models': 'AI Models',
  'data_access': 'Data Access',
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

  // Data access policies — to resolve the names of policies attached to a role.
  // Gated on permission so users who can see roles but not policies don't 403.
  const { data: policies = [] } = useQuery({
    queryKey: ['rbac-data-access-policies'],
    queryFn: () => rbacDataAccessPoliciesApi.list(),
    enabled: hasPermission(RBAC_PERMISSIONS.DATA_ACCESS_VIEW),
  });

  const policyNameById = useMemo(() => {
    const map = new Map<string, string>();
    policies.forEach((policy) => map.set(policy.id, policy.name));
    return map;
  }, [policies]);

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
          <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
            <Shield className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[18px] font-semibold tracking-tight text-paper">Roles</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
              {roles.length} role{roles.length !== 1 ? 's' : ''} defined
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 text-paper hover:border-ink-700 hover:bg-ink-200"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            Refresh
          </Button>
          {canCreate && (
            <Button
              size="sm"
              onClick={() => setIsCreateDialogOpen(true)}
              className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
            >
              <Plus className="h-3.5 w-3.5" />
              Add role
            </Button>
          )}
        </div>
      </motion.div>

      {/* Roles List */}
      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xs bg-ink-200" />
          ))
        ) : roles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-dim">
              <Shield className="h-5 w-5" aria-hidden />
            </div>
            <p className="text-[15px] font-semibold text-paper">No roles yet</p>
            <p className="mt-1 text-[13px] text-paper-muted">Roles bundle permissions so you don't repeat yourself.</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {roles.map((role, index) => {
              const style = getRoleStyle(role.name);
              const isExpanded = expandedRoles.has(role.id);
              const groupedPermissions = groupPermissions(role.permissions);
              const policyCount = role.dataAccessPolicyIds.length;
              const rolePolicies = role.dataAccessPolicyIds
                .map((id) => policyNameById.get(id))
                .filter((name): name is string => !!name);

              return (
                <motion.div
                  key={role.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20, scale: 0.95 }}
                  transition={{ delay: index * 0.05, duration: 0.3 }}
                  whileHover={{ scale: 1.01 }}
                  className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100 transition-colors hover:border-ink-700"
                >
                  <Collapsible open={isExpanded} onOpenChange={() => toggleExpanded(role.id)}>
                    {/* Role header */}
                    <div className="flex items-center justify-between p-4">
                      <div className="flex flex-1 items-center gap-3">
                        <CollapsibleTrigger className="group grid h-8 w-8 place-items-center rounded-xs text-paper-dim transition-colors hover:bg-ink-200 hover:text-paper">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </CollapsibleTrigger>
                        <span className="grid h-10 w-10 place-items-center rounded-xs border border-ink-500 bg-ink-200 font-mono text-[12px] font-semibold tracking-tight text-paper">
                          {style.icon}
                        </span>
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-[15px] font-semibold text-paper">
                              {role.displayName}
                            </h3>
                            {role.isSystem && (
                              <span className="inline-flex items-center gap-1 rounded-xs border border-ink-500 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
                                <Lock className="h-3 w-3" />
                                System
                              </span>
                            )}
                            {role.isDefault && (
                              <span className="inline-flex items-center gap-1 rounded-xs border border-brand/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
                                <CheckCircle2 className="h-3 w-3" />
                                Default
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[12px] text-paper-muted">{role.description || 'No description'}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {/* Stats */}
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-xs border border-ink-500 bg-ink-200 px-2 py-1 font-mono text-[11px]">
                            <Users className="h-3 w-3 text-paper-dim" />
                            <span className="text-paper">{role.userCount || 0}</span>
                            <span className="uppercase tracking-[0.14em] text-paper-faint">users</span>
                          </span>
                          <span className="inline-flex items-center gap-1.5 rounded-xs border border-ink-500 bg-ink-200 px-2 py-1 font-mono text-[11px]">
                            <Shield className="h-3 w-3 text-paper-dim" />
                            <span className="text-paper">{role.permissions.length}</span>
                            <span className="uppercase tracking-[0.14em] text-paper-faint">perms</span>
                          </span>
                          {policyCount > 0 && (
                            <span className="inline-flex items-center gap-1.5 rounded-xs border border-ink-500 bg-ink-200 px-2 py-1 font-mono text-[11px]">
                              <Database className="h-3 w-3 text-paper-dim" />
                              <span className="text-paper">{policyCount}</span>
                              <span className="uppercase tracking-[0.14em] text-paper-faint">access</span>
                            </span>
                          )}
                        </div>

                        {/* Actions */}
                        {(canUpdate || canDelete) && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 rounded-xs p-0 text-paper-dim hover:bg-ink-200 hover:text-paper"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="rounded-md border-ink-500 bg-ink-100">
                              {canUpdate && (
                                <DropdownMenuItem
                                  onClick={() => setEditingRole(role)}
                                  className="cursor-pointer hover:bg-ink-200"
                                >
                                  <Edit className="mr-2 h-4 w-4" />
                                  Edit role
                                </DropdownMenuItem>
                              )}
                              {canUpdate && canDelete && !role.isSystem && <DropdownMenuSeparator className="bg-ink-500" />}
                              {canDelete && !role.isSystem && (
                                <DropdownMenuItem
                                  onClick={() => setDeleteRoleId(role.id)}
                                  className="cursor-pointer text-red-400 hover:bg-red-950/40 focus:text-red-300"
                                  disabled={(role.userCount ?? 0) > 0}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete role
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
                        className="space-y-4 px-5 pb-5 pt-0"
                      >
                        <div className="p-5 rounded-xs bg-ink-200 border border-ink-500 space-y-4">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-violet-600 dark:text-purple-400" />
                            <h4 className="text-sm font-semibold text-paper">Permissions</h4>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {Object.entries(groupedPermissions).map(([category, perms]) => (
                              <motion.div
                                key={category}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.1 }}
                                className="space-y-2 p-3 rounded-xs bg-ink-100 border border-ink-500"
                              >
                                <h5 className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-faint">
                                  {category}
                                </h5>
                                <div className="flex flex-wrap gap-1.5">
                                  {perms.map((perm) => (
                                    <span
                                      key={perm}
                                      className="inline-flex items-center rounded-xs border border-ink-500 bg-ink-200 px-2 py-0.5 font-mono text-[11px] text-paper-muted transition-colors hover:border-ink-700 hover:text-paper"
                                    >
                                      {perm}
                                    </span>
                                  ))}
                                </div>
                              </motion.div>
                            ))}
                          </div>
                        </div>

                        {/* Data access — policies attached to this role */}
                        {policyCount > 0 && (
                          <div className="p-5 rounded-xs bg-ink-200 border border-ink-500 space-y-3">
                            <div className="flex items-center gap-2">
                              <Database className="h-4 w-4 text-brand" />
                              <h4 className="text-sm font-semibold text-paper">Data access</h4>
                            </div>
                            {rolePolicies.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {rolePolicies.map((name) => (
                                  <span
                                    key={name}
                                    className="inline-flex items-center gap-1.5 rounded-xs border border-ink-500 bg-ink-100 px-2 py-0.5 font-mono text-[11px] text-paper-muted transition-colors hover:border-ink-700 hover:text-paper"
                                  >
                                    <Database className="h-3 w-3 text-paper-faint" />
                                    {name}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
                                {policyCount} polic{policyCount === 1 ? 'y' : 'ies'} attached
                              </p>
                            )}
                          </div>
                        )}
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
