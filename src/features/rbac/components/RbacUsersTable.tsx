/**
 * RBAC Users Table Component
 * 
 * Displays a list of RBAC users with search, filtering, and actions.
 */

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Search,
  Plus,
  MoreHorizontal,
  Edit,
  Trash2,
  Key,
  Shield,
  CheckCircle,
  XCircle,
  RefreshCw,
  UserCog,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import ConfirmationDialog from '@/components/common/ConfirmationDialog';

import { rbacUsersApi, rbacRolesApi, type RbacUser, type RbacRole } from '@/api/rbac';
import { useRbacStore, RBAC_PERMISSIONS } from '@/stores/rbac';
import { cn } from '@/lib/utils';

// ============================================
// Role Badge Colors
// ============================================

const ROLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  super_admin: { bg: 'bg-red-500/20', text: 'text-red-300', border: 'border-red-500/30' },
  admin: { bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/30' },
  developer: { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/30' },
  analyst: { bg: 'bg-green-500/20', text: 'text-green-300', border: 'border-green-500/30' },
  viewer: { bg: 'bg-purple-500/20', text: 'text-purple-300', border: 'border-purple-500/30' },
};

const getRoleColor = (role: string) => {
  return ROLE_COLORS[role] || { bg: 'bg-gray-500/20', text: 'text-gray-300', border: 'border-gray-500/30' };
};

// ============================================
// Component Props
// ============================================

interface RbacUsersTableProps {
  onCreateUser?: () => void;
  onEditUser?: (user: RbacUser) => void;
}

// ============================================
// Component
// ============================================

export const RbacUsersTable: React.FC<RbacUsersTableProps> = ({
  onCreateUser,
  onEditUser,
}) => {
  const queryClient = useQueryClient();
  const { hasPermission } = useRbacStore();
  
  // State
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);

  // Queries
  const { data: usersData, isLoading: usersLoading, refetch } = useQuery({
    queryKey: ['rbac-users', page, search, roleFilter, statusFilter],
    queryFn: () => rbacUsersApi.list({
      page,
      limit: 20,
      search: search || undefined,
      roleId: roleFilter !== 'all' ? roleFilter : undefined,
      isActive: statusFilter === 'all' ? undefined : statusFilter === 'active',
    }),
  });

  const { data: roles } = useQuery({
    queryKey: ['rbac-roles'],
    queryFn: () => rbacRolesApi.list(),
  });

  // Mutations
  const deleteUserMutation = useMutation({
    mutationFn: (id: string) => rbacUsersApi.delete(id),
    onSuccess: () => {
      toast.success('User deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['rbac-users'] });
      setDeleteUserId(null);
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete user: ${error.message}`);
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (id: string) => rbacUsersApi.resetPassword(id, { generatePassword: true }),
    onSuccess: (data) => {
      if (data.generatedPassword) {
        toast.success(
          <div className="space-y-2">
            <p>Password reset successfully!</p>
            <code className="block bg-black/30 px-2 py-1 rounded text-sm">
              {data.generatedPassword}
            </code>
            <p className="text-xs text-gray-400">Copy this password now. It won't be shown again.</p>
          </div>,
          { duration: 15000 }
        );
      } else {
        toast.success('Password reset successfully');
      }
      setResetPasswordUserId(null);
    },
    onError: (error: Error) => {
      toast.error(`Failed to reset password: ${error.message}`);
    },
  });

  // Computed
  const users = usersData?.users || [];
  const total = usersData?.total || 0;
  const totalPages = Math.ceil(total / 20);

  const canCreate = hasPermission(RBAC_PERMISSIONS.USERS_CREATE);
  const canUpdate = hasPermission(RBAC_PERMISSIONS.USERS_UPDATE);
  const canDelete = hasPermission(RBAC_PERMISSIONS.USERS_DELETE);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/20">
            <Users className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Users</h2>
            <p className="text-sm text-gray-400">{total} total users</p>
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
          {canCreate && onCreateUser && (
            <Button onClick={onCreateUser} className="gap-2">
              <Plus className="h-4 w-4" />
              Add User
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search users..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-10 bg-white/5 border-white/10"
          />
        </div>
        
        <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[180px] bg-white/5 border-white/10">
            <SelectValue placeholder="Filter by role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            {roles?.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {role.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[140px] bg-white/5 border-white/10">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-white/5">
              <TableHead className="text-gray-400">User</TableHead>
              <TableHead className="text-gray-400">Roles</TableHead>
              <TableHead className="text-gray-400">Status</TableHead>
              <TableHead className="text-gray-400">Last Login</TableHead>
              <TableHead className="text-gray-400 w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usersLoading ? (
              // Loading skeleton
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i} className="border-white/10">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="space-y-1">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                </TableRow>
              ))
            ) : users.length === 0 ? (
              <TableRow className="border-white/10">
                <TableCell colSpan={5} className="text-center py-8 text-gray-400">
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              <AnimatePresence mode="popLayout">
                {users.map((user) => (
                  <motion.tr
                    key={user.id}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="border-white/10 hover:bg-white/5"
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white font-medium">
                          {user.displayName?.[0]?.toUpperCase() || user.username[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-white">
                            {user.displayName || user.username}
                          </p>
                          <p className="text-sm text-gray-400">{user.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((role) => {
                          const colors = getRoleColor(role);
                          return (
                            <Badge
                              key={role}
                              variant="outline"
                              className={cn(colors.bg, colors.text, colors.border, 'text-xs')}
                            >
                              {role}
                            </Badge>
                          );
                        })}
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.isActive ? (
                        <Badge variant="outline" className="bg-green-500/20 text-green-300 border-green-500/30">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-red-500/20 text-red-300 border-red-500/30">
                          <XCircle className="h-3 w-3 mr-1" />
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-gray-400 text-sm">
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleDateString()
                        : 'Never'}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canUpdate && onEditUser && (
                            <DropdownMenuItem onClick={() => onEditUser(user)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Edit User
                            </DropdownMenuItem>
                          )}
                          {canUpdate && (
                            <DropdownMenuItem onClick={() => setResetPasswordUserId(user.id)}>
                              <Key className="h-4 w-4 mr-2" />
                              Reset Password
                            </DropdownMenuItem>
                          )}
                          {(canUpdate || canDelete) && <DropdownMenuSeparator />}
                          {canDelete && (
                            <DropdownMenuItem
                              onClick={() => setDeleteUserId(user.id)}
                              className="text-red-400 focus:text-red-400"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete User
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </motion.tr>
                ))}
              </AnimatePresence>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-400">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={!!deleteUserId}
        onClose={() => setDeleteUserId(null)}
        title="Delete User"
        description="Are you sure you want to delete this user? This action cannot be undone."
        confirmText="Delete"
        onConfirm={() => deleteUserId && deleteUserMutation.mutate(deleteUserId)}
        variant="danger"
      />

      {/* Reset Password Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={!!resetPasswordUserId}
        onClose={() => setResetPasswordUserId(null)}
        title="Reset Password"
        description="A new random password will be generated. Make sure to copy it before closing the notification."
        confirmText="Reset Password"
        onConfirm={() => resetPasswordUserId && resetPasswordMutation.mutate(resetPasswordUserId)}
        variant="warning"
      />
    </div>
  );
};

export default RbacUsersTable;
