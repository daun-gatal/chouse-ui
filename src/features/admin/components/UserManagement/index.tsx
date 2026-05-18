/**
 * RBAC User Management Component
 * 
 * Manages users through the RBAC system (no ClickHouse DDL).
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { usePaginationPreference, useUserManagementPreferences } from "@/hooks";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { log } from "@/lib/log";
import {
  Users,
  RefreshCw,
  Plus,
  Trash2,
  Edit,
  Shield,
  Search,
  UserCheck,
  UserX,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Filter,
  X,
  Key,
  MoreVertical,
  Mail,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { rbacUsersApi, rbacRolesApi, type RbacUser, type RbacRole } from "@/api/rbac";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { formatDistanceToNow } from "date-fns";

// Role colors for display
const ROLE_COLORS: Record<string, { color: string; bgColor: string }> = {
  super_admin: { color: "text-red-400", bgColor: "bg-red-500/20 border-red-500/30" },
  admin: { color: "text-orange-400", bgColor: "bg-orange-500/20 border-orange-500/30" },
  developer: { color: "text-blue-400", bgColor: "bg-blue-500/20 border-blue-500/30" },
  analyst: { color: "text-green-400", bgColor: "bg-green-500/20 border-green-500/30" },
  viewer: { color: "text-purple-400", bgColor: "bg-purple-500/20 border-purple-500/30" },
  guest: { color: "text-cyan-400", bgColor: "bg-cyan-500/20 border-cyan-500/30" },
};

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];

const UserManagement: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission, user: currentUser, isSuperAdmin } = useRbacStore();

  // Data state
  const [users, setUsers] = useState<RbacUser[]>([]);
  const [roles, setRoles] = useState<RbacRole[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preferences
  const { pageSize: defaultPageSize, setPageSize: setPageSizePreference } = usePaginationPreference('userManagement');
  const { preferences: userMgmtPrefs, updatePreferences: updateUserMgmtPrefs } = useUserManagementPreferences();

  // Search and filter state - initialize from preferences
  const [searchQuery, setSearchQuery] = useState(userMgmtPrefs.defaultSearchQuery || "");
  const [roleFilter, setRoleFilter] = useState<string>(userMgmtPrefs.defaultRoleFilter || "all");
  const [statusFilter, setStatusFilter] = useState<string>(userMgmtPrefs.defaultStatusFilter || "all");

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  // Sync pageSize state when preference changes
  useEffect(() => {
    setPageSize(defaultPageSize);
  }, [defaultPageSize]);

  // Sync state from preferences when they load
  useEffect(() => {
    if (!userMgmtPrefs) return;
    if (userMgmtPrefs.defaultSearchQuery !== undefined) setSearchQuery(userMgmtPrefs.defaultSearchQuery);
    if (userMgmtPrefs.defaultRoleFilter) setRoleFilter(userMgmtPrefs.defaultRoleFilter);
    if (userMgmtPrefs.defaultStatusFilter) setStatusFilter(userMgmtPrefs.defaultStatusFilter);
  }, [userMgmtPrefs]);

  // Update preferences when state changes (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      updateUserMgmtPrefs({
        defaultSearchQuery: searchQuery,
        defaultRoleFilter: roleFilter,
        defaultStatusFilter: statusFilter,
      });
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, roleFilter, statusFilter, updateUserMgmtPrefs]);

  // Update page size preference when pageSize changes
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setPageSizePreference(pageSize);
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [pageSize, setPageSizePreference]);

  // User management state
  const [selectedUser, setSelectedUser] = useState<RbacUser | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);

  // Permission checks
  const canCreateUsers = hasPermission(RBAC_PERMISSIONS.USERS_CREATE);
  const canUpdateUsers = hasPermission(RBAC_PERMISSIONS.USERS_UPDATE);
  const canDeleteUsers = hasPermission(RBAC_PERMISSIONS.USERS_DELETE);

  // Fetch roles on mount
  useEffect(() => {
    rbacRolesApi.list().then(setRoles).catch((e) => log.error('Failed to fetch roles', e));
  }, []);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    setIsFetching(true);
    setError(null);

    try {
      const result = await rbacUsersApi.list({
        page: currentPage,
        limit: pageSize,
        search: searchQuery || undefined,
        roleId: roleFilter !== "all" ? roleFilter : undefined,
        isActive: statusFilter === "all" ? undefined : statusFilter === "active",
      });
      setUsers(result.users);
      setTotal(result.total);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch users";
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
      setIsFetching(false);
    }
  }, [currentPage, pageSize, searchQuery, roleFilter, statusFilter]);

  // Fetch on mount and when filters change
  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, roleFilter, statusFilter]);

  // Pagination computed values
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const goToPage = (page: number) => {
    const newPage = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(newPage);
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    setIsDeleting(true);

    try {
      await rbacUsersApi.delete(selectedUser.id);
      toast.success(`User "${selectedUser.username}" deleted successfully`);
      setShowDeleteDialog(false);
      setSelectedUser(null);
      fetchUsers();
    } catch (err) {
      toast.error(`Failed to delete user: ${(err as Error).message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!selectedUser) return;
    setIsResettingPassword(true);

    try {
      const result = await rbacUsersApi.resetPassword(selectedUser.id, { generatePassword: true });
      setGeneratedPassword(result.generatedPassword || null);
      toast.success(`Password reset for "${selectedUser.username}"`);
    } catch (err) {
      toast.error(`Failed to reset password: ${(err as Error).message}`);
    } finally {
      setIsResettingPassword(false);
    }
  };

  const copyPassword = async () => {
    if (generatedPassword) {
      try {
        await navigator.clipboard.writeText(generatedPassword);
        toast.success("Password copied to clipboard");
      } catch (error) {
        log.error('Failed to copy password:', error);
        toast.error("Failed to copy password to clipboard");
      }
    }
  };

  const openDeleteDialog = (user: RbacUser) => {
    setSelectedUser(user);
    setShowDeleteDialog(true);
  };

  const openResetPasswordDialog = (user: RbacUser) => {
    setSelectedUser(user);
    setGeneratedPassword(null);
    setShowResetPasswordDialog(true);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setRoleFilter("all");
    setStatusFilter("all");
  };

  const hasActiveFilters = searchQuery.trim() !== "" || roleFilter !== "all" || statusFilter !== "all";

  // Get role display info
  const getRoleDisplay = (roleName: string) => {
    const role = roles.find((r) => r.name === roleName);
    const colors = ROLE_COLORS[roleName] || { color: "text-gray-400", bgColor: "bg-gray-500/20 border-gray-500/30" };
    return {
      displayName: role?.displayName || roleName,
      ...colors,
    };
  };

  // Count users by status
  const statusCounts = useMemo(() => {
    return {
      total: total,
      active: users.filter((u) => u.isActive).length,
      inactive: users.filter((u) => !u.isActive).length,
    };
  }, [users, total]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
            <Users className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[18px] font-semibold tracking-tight text-paper">User management</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
              {total} user{total !== 1 ? "s" : ""} in the system
            </p>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
          {/* Search */}
          <div className="relative min-w-[200px] flex-1 md:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-paper-dim" />
            <Input
              placeholder="Search by name, email…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 rounded-xs border-ink-500 bg-ink-200 pl-9 font-mono text-[12px] text-paper placeholder:text-paper-faint focus-visible:border-brand focus-visible:ring-0"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-xs text-paper-dim hover:bg-ink-300 hover:text-paper"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Role filter */}
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-9 w-[140px] rounded-xs border-ink-500 bg-ink-200 font-mono text-[12px] text-paper">
              <Filter className="mr-2 h-3.5 w-3.5 text-paper-dim" />
              <SelectValue placeholder="Filter role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {roles.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[120px] rounded-xs border-ink-500 bg-ink-200 font-mono text-[12px] text-paper">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>

          {/* Clear filters */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-9 rounded-xs px-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim hover:bg-ink-200 hover:text-paper"
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Clear
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={fetchUsers}
            disabled={isFetching}
            className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 text-paper hover:border-ink-700 hover:bg-ink-200"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>

          {canCreateUsers && (
            <Button
              size="sm"
              onClick={() => navigate("/admin/users/create")}
              className="h-9 shrink-0 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Create user</span>
            </Button>
          )}
        </div>
      </div>

      {/* Stats — hairline editorial grid */}
      <div className="grid grid-cols-2 border-l border-t border-ink-500 md:grid-cols-4">
        {[
          { icon: Users, label: "Total users", value: total },
          { icon: UserCheck, label: "Active", value: statusCounts.active },
          { icon: UserX, label: "Inactive", value: statusCounts.inactive },
          { icon: Shield, label: "Roles", value: roles.length },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex flex-col gap-2 border-b border-r border-ink-500 px-5 py-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">{label}</span>
              <Icon className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
            </div>
            <span className="font-mono text-[20px] font-semibold leading-none text-paper">{value}</span>
          </div>
        ))}
      </div>

      {/* Filter Results Summary */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span>Showing {users.length} of {total} users</span>
          {searchQuery && (
            <Badge variant="secondary" className="bg-white/10">
              Search: "{searchQuery}"
            </Badge>
          )}
          {roleFilter !== "all" && (
            <Badge variant="secondary" className="bg-white/10">
              Role: {roles.find((r) => r.id === roleFilter)?.displayName}
            </Badge>
          )}
          {statusFilter !== "all" && (
            <Badge variant="secondary" className="bg-white/10">
              Status: {statusFilter}
            </Badge>
          )}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="rounded-xs border border-red-900/60 bg-red-950/40 p-6 text-center">
          <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-red-300" />
          <p className="text-[13px] text-red-200">{error}</p>
          <Button variant="outline" onClick={fetchUsers} className="mt-4 rounded-xs border-ink-500 bg-ink-200 text-paper hover:border-ink-700 hover:bg-ink-300">
            Retry
          </Button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && !error && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-paper-dim" />
        </div>
      )}

      {/* User Cards */}
      {!isLoading && !error && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {users.map((user) => {
              const primaryRole = user.roles[0] || "viewer";
              const roleDisplay = getRoleDisplay(primaryRole);
              const isCurrentUser = user.id === currentUser?.id;
              const userIsSuperAdmin = user.roles.includes('super_admin');
              // Basic admins cannot edit super admins
              const canEditThisUser = canUpdateUsers && (isSuperAdmin() || !userIsSuperAdmin);
              const canDeleteThisUser = canDeleteUsers && !isCurrentUser && (isSuperAdmin() || !userIsSuperAdmin);
              const hasActions = canEditThisUser || canDeleteThisUser;

              return (
                <div
                  key={user.id}
                  className="group relative p-5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
                >
                  {/* Status indicator */}
                  <div
                    className={`absolute top-4 right-4 w-2 h-2 rounded-full ${user.isActive ? "bg-green-500" : "bg-gray-500"
                      }`}
                    title={user.isActive ? "Active" : "Inactive"}
                  />

                  {/* User Avatar & Name */}
                  <div className="flex items-start gap-3 mb-4">
                    <div className="grid h-10 w-10 place-items-center rounded-xs border border-ink-500 bg-ink-200 font-mono text-[13px] font-semibold uppercase tracking-tight text-paper">
                      {user.displayName?.slice(0, 2) || user.username.slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-white text-lg truncate">
                        {user.displayName || user.username}
                        {isCurrentUser && (
                          <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">(You)</span>
                        )}
                      </h3>
                      <p className="text-sm text-gray-400 truncate">@{user.username}</p>
                    </div>
                  </div>

                  {/* User Details */}
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Mail className="h-3 w-3 text-gray-400 shrink-0" />
                      <span className="text-gray-300 truncate">{user.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-3 w-3 text-gray-400 shrink-0" />
                      <span className="text-gray-400">
                        {user.lastLoginAt
                          ? `Last login ${formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true })}`
                          : "Never logged in"}
                      </span>
                    </div>
                  </div>

                  {/* Role badges */}
                  <div className="flex flex-wrap gap-1 mt-3">
                    {user.roles.map((role) => {
                      const display = getRoleDisplay(role);
                      return (
                        <Badge
                          key={role}
                          variant="outline"
                          className={`${display.bgColor} ${display.color} border text-xs`}
                        >
                          {display.displayName}
                        </Badge>
                      );
                    })}
                  </div>

                  {/* Quick Actions */}
                  <div className="flex gap-2 mt-4 pt-4 border-t border-white/10">
                    {canEditThisUser && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="flex-1 text-xs"
                        onClick={() => navigate(`/admin/users/edit/${user.id}`)}
                      >
                        <Edit className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                    )}
                    {hasActions && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" className="px-2">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canEditThisUser && (
                            <DropdownMenuItem onClick={() => openResetPasswordDialog(user)}>
                              <Key className="h-4 w-4 mr-2" />
                              Reset Password
                            </DropdownMenuItem>
                          )}
                          {canEditThisUser && canDeleteThisUser && <DropdownMenuSeparator />}
                          {canDeleteThisUser && (
                            <DropdownMenuItem
                              className="text-red-400 focus:text-red-400"
                              onClick={() => openDeleteDialog(user)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete User
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Empty State */}
          {users.length === 0 && (
            <div className="py-20 text-center">
              <Users className="h-12 w-12 text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-400 mb-2">
                {hasActiveFilters ? "No users found" : "No users configured"}
              </h3>
              <p className="text-gray-500 mb-4">
                {hasActiveFilters
                  ? "Try adjusting your search or filters"
                  : "Get started by creating your first user"}
              </p>
              {hasActiveFilters ? (
                <Button variant="outline" onClick={clearFilters}>
                  Clear Filters
                </Button>
              ) : (
                canCreateUsers && (
                  <Button onClick={() => navigate("/admin/users/create")}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create User
                  </Button>
                )
              )}
            </div>
          )}

          {/* Pagination Controls */}
          {total > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-white/10">
              {/* Page Size Selector */}
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span>Show</span>
                <Select value={String(pageSize)} onValueChange={(v) => {
                  const newPageSize = Number(v);
                  setPageSize(newPageSize);
                  setPageSizePreference(newPageSize);
                }}>
                  <SelectTrigger className="w-[70px] h-8 bg-white/5 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span>per page</span>
              </div>

              {/* Page Info */}
              <div className="text-sm text-gray-400">
                Showing {(safeCurrentPage - 1) * pageSize + 1}-{Math.min(safeCurrentPage * pageSize, total)} of {total}
              </div>

              {/* Page Navigation */}
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToPage(1)}
                  disabled={safeCurrentPage === 1}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToPage(safeCurrentPage - 1)}
                  disabled={safeCurrentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                {/* Page Numbers */}
                <div className="flex items-center gap-1 px-2">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (safeCurrentPage <= 3) {
                      pageNum = i + 1;
                    } else if (safeCurrentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = safeCurrentPage - 2 + i;
                    }
                    return (
                      <Button
                        key={pageNum}
                        variant={safeCurrentPage === pageNum ? "default" : "ghost"}
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => goToPage(pageNum)}
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                </div>

                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToPage(safeCurrentPage + 1)}
                  disabled={safeCurrentPage === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => goToPage(totalPages)}
                  disabled={safeCurrentPage === totalPages}
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete User
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete user <strong>{selectedUser?.username}</strong>?
              This action cannot be undone. The user will lose all access to the system.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              className="bg-red-600 hover:bg-red-700"
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete User"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Password Dialog */}
      <Dialog open={showResetPasswordDialog} onOpenChange={setShowResetPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-yellow-500" />
              Reset Password
            </DialogTitle>
            <DialogDescription>
              Reset the password for user <strong>{selectedUser?.username}</strong>.
            </DialogDescription>
          </DialogHeader>

          {generatedPassword ? (
            <div className="space-y-4">
              <div className="rounded-xs border border-emerald-900/60 bg-emerald-950/40 p-4">
                <p className="mb-2 text-[13px] text-emerald-200">Password reset successfully!</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2 rounded bg-black/30 text-white font-mono text-sm">
                    {generatedPassword}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={copyPassword}
                  >
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Save this password securely. It won't be shown again.
                </p>
              </div>
              <Button onClick={() => setShowResetPasswordDialog(false)} className="w-full">
                Done
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-400">
                A new secure password will be generated for this user. Make sure to share it securely.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowResetPasswordDialog(false)}
                  disabled={isResettingPassword}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleResetPassword}
                  disabled={isResettingPassword}
                  className="flex-1"
                >
                  {isResettingPassword ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    "Reset Password"
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

export default UserManagement;
