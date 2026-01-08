import React, { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  RefreshCw,
  Plus,
  Trash2,
  Edit,
  Shield,
  Search,
  Key,
  MoreHorizontal,
  UserCheck,
  UserX,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useUsers, useExecuteQuery } from "@/hooks";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface User {
  name: string;
  id: string;
  host_ip: string;
  host_names: string;
  default_roles_all: number;
  default_roles_list: string;
  default_roles_except: string;
}

interface UserGrants {
  [username: string]: string[];
}

// Role detection based on actual grants
function detectUserRoleFromGrants(
  username: string,
  grants: UserGrants
): { role: string; color: string; bgColor: string; permissions: string[] } {
  const userGrants = grants[username] || [];
  const grantSet = new Set(userGrants.map((g) => g.toUpperCase()));

  // Admin indicators - check for user/role management or system privileges
  const adminIndicators = [
    "ALL",
    "GRANT OPTION",
    "ACCESS MANAGEMENT",
    "ROLE ADMIN",
    "CREATE USER",
    "DROP USER",
    "ALTER USER",
    "CREATE ROLE",
    "DROP ROLE",
    "SYSTEM",
  ];
  
  const hasAdminPrivileges = adminIndicators.some((indicator) => grantSet.has(indicator));
  
  // Also check if user has a LOT of permissions (likely full admin)
  const isLikelyAdmin = userGrants.length > 20;

  if (hasAdminPrivileges || isLikelyAdmin) {
    return {
      role: "Admin",
      color: "text-red-400",
      bgColor: "bg-red-500/20 border-red-500/30",
      permissions: userGrants,
    };
  }

  // Check permissions
  const hasSelect = grantSet.has("SELECT") || grantSet.has("READ");
  const hasInsert = grantSet.has("INSERT") || grantSet.has("WRITE");
  const hasDDL =
    grantSet.has("CREATE") ||
    grantSet.has("CREATE TABLE") ||
    grantSet.has("DROP") ||
    grantSet.has("DROP TABLE") ||
    grantSet.has("ALTER") ||
    grantSet.has("ALTER TABLE");

  // Developer: SELECT + INSERT + DDL
  if (hasSelect && hasInsert && hasDDL) {
    return {
      role: "Developer",
      color: "text-blue-400",
      bgColor: "bg-blue-500/20 border-blue-500/30",
      permissions: userGrants,
    };
  }

  // Read-Write: SELECT + INSERT (no DDL)
  if (hasSelect && hasInsert && !hasDDL) {
    return {
      role: "Read-Write",
      color: "text-green-400",
      bgColor: "bg-green-500/20 border-green-500/30",
      permissions: userGrants,
    };
  }

  // Read Only: only SELECT
  if (hasSelect && !hasInsert && !hasDDL) {
    return {
      role: "Read Only",
      color: "text-purple-400",
      bgColor: "bg-purple-500/20 border-purple-500/30",
      permissions: userGrants,
    };
  }

  // No grants
  if (userGrants.length === 0) {
    return {
      role: "No Access",
      color: "text-gray-500",
      bgColor: "bg-gray-500/20 border-gray-500/30",
      permissions: [],
    };
  }

  // Custom (has some grants but doesn't match predefined roles)
  return {
    role: "Custom",
    color: "text-orange-400",
    bgColor: "bg-orange-500/20 border-orange-500/30",
    permissions: userGrants,
  };
}

const UserManagement: React.FC = () => {
  const navigate = useNavigate();
  const { data: users = [], isLoading, refetch, error } = useUsers();
  const executeQuery = useExecuteQuery();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [userGrants, setUserGrants] = useState<UserGrants>({});
  const [loadingGrants, setLoadingGrants] = useState(false);

  // Fetch grants for all users
  useEffect(() => {
    const fetchGrants = async () => {
      if (users.length === 0) return;
      setLoadingGrants(true);
      try {
        const result = await executeQuery.mutateAsync({
          query: `SELECT user_name, access_type FROM system.grants WHERE user_name != ''`,
        });
        const grants: UserGrants = {};
        (result.data as { user_name: string; access_type: string }[]).forEach((row) => {
          if (!grants[row.user_name]) {
            grants[row.user_name] = [];
          }
          if (!grants[row.user_name].includes(row.access_type)) {
            grants[row.user_name].push(row.access_type);
          }
        });
        setUserGrants(grants);
      } catch (err) {
        console.error("Failed to fetch grants:", err);
      } finally {
        setLoadingGrants(false);
      }
    };
    fetchGrants();
  }, [users]);

  // Filter users based on search
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const query = searchQuery.toLowerCase();
    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(query) ||
        user.host_ip?.toLowerCase().includes(query) ||
        user.default_roles_list?.toLowerCase().includes(query)
    );
  }, [users, searchQuery]);

  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    setIsDeleting(true);

    try {
      await executeQuery.mutateAsync({
        query: `DROP USER IF EXISTS '${selectedUser.name}'`,
      });
      toast.success(`User "${selectedUser.name}" deleted successfully`);
      setShowDeleteDialog(false);
      setSelectedUser(null);
      refetch();
    } catch (error) {
      toast.error(`Failed to delete user: ${(error as Error).message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleChangePassword = async () => {
    if (!selectedUser || !newPassword.trim()) return;
    setIsUpdatingPassword(true);

    try {
      const escapedPassword = newPassword.replace(/'/g, "\\'");
      await executeQuery.mutateAsync({
        query: `ALTER USER '${selectedUser.name}' IDENTIFIED BY '${escapedPassword}'`,
      });
      toast.success(`Password updated for "${selectedUser.name}"`);
      setShowPasswordDialog(false);
      setNewPassword("");
      setSelectedUser(null);
    } catch (error) {
      toast.error(`Failed to update password: ${(error as Error).message}`);
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const openDeleteDialog = (user: User) => {
    setSelectedUser(user);
    setShowDeleteDialog(true);
  };

  const openPasswordDialog = (user: User) => {
    setSelectedUser(user);
    setNewPassword("");
    setShowPasswordDialog(true);
  };

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.05 },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 space-y-6"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/20">
            <Users className="h-6 w-6 text-blue-400" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">User Management</h2>
            <p className="text-sm text-gray-400">
              {users.length} user{users.length !== 1 ? "s" : ""} configured
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-white/5 border-white/10"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isLoading}
            className="shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            onClick={() => navigate("/admin/users/create")}
            className="gap-2 shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Create User</span>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white/5 border border-white/10">
          <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
            <Users className="h-4 w-4" />
            Total Users
          </div>
          <div className="text-2xl font-bold text-white">{users.length}</div>
        </div>
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20">
          <div className="flex items-center gap-2 text-red-400 text-sm mb-1">
            <Shield className="h-4 w-4" />
            Admins
          </div>
          <div className="text-2xl font-bold text-white">
            {users.filter((u) => {
              const grants = userGrants[u.name] || [];
              const grantSet = new Set(grants.map((g) => g.toUpperCase()));
              const adminIndicators = ["ALL", "GRANT OPTION", "ACCESS MANAGEMENT", "ROLE ADMIN", "CREATE USER", "DROP USER", "SYSTEM"];
              return adminIndicators.some((ind) => grantSet.has(ind)) || grants.length > 20;
            }).length}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
          <div className="flex items-center gap-2 text-blue-400 text-sm mb-1">
            <UserCheck className="h-4 w-4" />
            With Grants
          </div>
          <div className="text-2xl font-bold text-white">
            {users.filter((u) => (userGrants[u.name] || []).length > 0).length}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
          <div className="flex items-center gap-2 text-purple-400 text-sm mb-1">
            <UserX className="h-4 w-4" />
            No Grants
          </div>
          <div className="text-2xl font-bold text-white">
            {users.filter((u) => (userGrants[u.name] || []).length === 0).length}
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-6 rounded-xl bg-red-500/10 border border-red-500/30 text-center">
          <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-2" />
          <p className="text-red-400">{error.message}</p>
          <Button variant="outline" onClick={() => refetch()} className="mt-4">
            Retry
          </Button>
        </div>
      )}

      {/* Loading State */}
      {isLoading && !error && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
        </div>
      )}

      {/* User Cards */}
      {!isLoading && !error && (
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          <AnimatePresence mode="popLayout">
            {filteredUsers.map((user) => {
              const roleInfo = detectUserRoleFromGrants(user.name, userGrants);
              return (
                <motion.div
                  key={user.id || user.name}
                  variants={item}
                  layout
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="group relative p-5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
                >
                  {/* User Avatar & Name */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white font-bold text-lg uppercase">
                        {user.name.slice(0, 2)}
                      </div>
                      <div>
                        <h3 className="font-semibold text-white text-lg">{user.name}</h3>
                        <Badge
                          variant="outline"
                          className={`${roleInfo.bgColor} ${roleInfo.color} border text-xs`}
                        >
                          {loadingGrants ? "Loading..." : roleInfo.role}
                        </Badge>
                      </div>
                    </div>

                    {/* Actions Dropdown */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/admin/users/edit/${user.name}`)}>
                          <Edit className="h-4 w-4 mr-2" />
                          Edit User
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openPasswordDialog(user)}>
                          <Key className="h-4 w-4 mr-2" />
                          Change Password
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => openDeleteDialog(user)}
                          className="text-red-400 focus:text-red-400"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete User
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {/* User Details */}
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Host</span>
                      <span className="text-gray-200 font-mono text-xs">
                        {user.host_ip || user.host_names || "Any"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Permissions</span>
                      <span className="text-gray-200 text-xs">
                        {roleInfo.permissions.length} grants
                      </span>
                    </div>
                  </div>

                  {/* Permission badges */}
                  <div className="flex flex-wrap gap-1 mt-3">
                    {roleInfo.permissions.slice(0, 4).map((perm, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-gray-300"
                      >
                        {perm}
                      </span>
                    ))}
                    {roleInfo.permissions.length > 4 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-gray-400">
                        +{roleInfo.permissions.length - 4}
                      </span>
                    )}
                  </div>

                  {/* Quick Actions */}
                  <div className="flex gap-2 mt-4 pt-4 border-t border-white/10">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1 text-xs"
                      onClick={() => navigate(`/admin/users/edit/${user.name}`)}
                    >
                      <Edit className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1 text-xs"
                      onClick={() => openPasswordDialog(user)}
                    >
                      <Key className="h-3 w-3 mr-1" />
                      Password
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      onClick={() => openDeleteDialog(user)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Empty State */}
          {filteredUsers.length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="col-span-full py-20 text-center"
            >
              <Users className="h-12 w-12 text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-400 mb-2">
                {searchQuery ? "No users found" : "No users configured"}
              </h3>
              <p className="text-gray-500 mb-4">
                {searchQuery
                  ? "Try adjusting your search query"
                  : "Get started by creating your first user"}
              </p>
              {!searchQuery && (
                <Button onClick={() => navigate("/admin/users/create")}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create User
                </Button>
              )}
            </motion.div>
          )}
        </motion.div>
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
              Are you sure you want to delete user <strong>{selectedUser?.name}</strong>?
              This action cannot be undone. All grants and permissions will be revoked.
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

      {/* Change Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-yellow-500" />
              Change Password
            </DialogTitle>
            <DialogDescription>
              Set a new password for user <strong>{selectedUser?.name}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                className="bg-white/5 border-white/10"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)} disabled={isUpdatingPassword}>
              Cancel
            </Button>
            <Button onClick={handleChangePassword} disabled={isUpdatingPassword || !newPassword.trim()}>
              {isUpdatingPassword ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                "Update Password"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

export default UserManagement;
