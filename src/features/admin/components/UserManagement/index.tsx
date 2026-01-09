import { useState, useMemo, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
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

type RoleType = "all" | "admin" | "developer" | "readwrite" | "readonly" | "noaccess" | "custom";

// Role detection based on actual grants
function detectUserRoleFromGrants(
  username: string,
  grants: UserGrants
): { role: string; roleType: RoleType; color: string; bgColor: string; permissions: string[] } {
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
      roleType: "admin",
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
      roleType: "developer",
      color: "text-blue-400",
      bgColor: "bg-blue-500/20 border-blue-500/30",
      permissions: userGrants,
    };
  }

  // Read-Write: SELECT + INSERT (no DDL)
  if (hasSelect && hasInsert && !hasDDL) {
    return {
      role: "Read-Write",
      roleType: "readwrite",
      color: "text-green-400",
      bgColor: "bg-green-500/20 border-green-500/30",
      permissions: userGrants,
    };
  }

  // Read Only: only SELECT
  if (hasSelect && !hasInsert && !hasDDL) {
    return {
      role: "Read Only",
      roleType: "readonly",
      color: "text-purple-400",
      bgColor: "bg-purple-500/20 border-purple-500/30",
      permissions: userGrants,
    };
  }

  // No grants
  if (userGrants.length === 0) {
    return {
      role: "No Access",
      roleType: "noaccess",
      color: "text-gray-500",
      bgColor: "bg-gray-500/20 border-gray-500/30",
      permissions: [],
    };
  }

  // Custom (has some grants but doesn't match predefined roles)
  return {
    role: "Custom",
    roleType: "custom",
    color: "text-orange-400",
    bgColor: "bg-orange-500/20 border-orange-500/30",
    permissions: userGrants,
  };
}

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];

// Helper to safely convert value to searchable string
const toSearchString = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.toLowerCase();
  if (Array.isArray(value)) return value.join(" ").toLowerCase();
  return String(value).toLowerCase();
};

const UserManagement: React.FC = () => {
  const navigate = useNavigate();
  const { data: users = [], isLoading, isFetching, refetch, error } = useUsers();
  const executeQuery = useExecuteQuery();

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleType>("all");
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // User management state
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [userGrants, setUserGrants] = useState<UserGrants>({});
  const [loadingGrants, setLoadingGrants] = useState(false);

  // Memoized fetch grants function to avoid dependency issues
  const fetchGrants = useCallback(async () => {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users.length]);

  // Fetch grants when users change
  useEffect(() => {
    fetchGrants();
  }, [fetchGrants]);

  // Filter users based on search and role - simple pattern like Explorer
  const filteredUsers = useMemo(() => {
    // Return empty if no users
    if (!users || users.length === 0) return [];
    
    // If no filters, return all users
    if (!searchQuery && roleFilter === "all") return users;
    
    const trimmedSearch = searchQuery.trim().toLowerCase();
    
    return users.filter((user) => {
      // Search filter
      if (trimmedSearch) {
        const nameMatch = toSearchString(user.name).includes(trimmedSearch);
        const hostIpMatch = toSearchString(user.host_ip).includes(trimmedSearch);
        const hostNamesMatch = toSearchString(user.host_names).includes(trimmedSearch);
        const rolesMatch = toSearchString(user.default_roles_list).includes(trimmedSearch);
        if (!nameMatch && !hostIpMatch && !hostNamesMatch && !rolesMatch) {
          return false;
        }
      }
      
      // Role filter
      if (roleFilter !== "all") {
        const roleInfo = detectUserRoleFromGrants(user.name, userGrants);
        if (roleInfo.roleType !== roleFilter) {
          return false;
        }
      }
      
      return true;
    });
  }, [users, searchQuery, roleFilter, userGrants]);

  // Pagination computed values
  const totalItems = filteredUsers.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  
  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, roleFilter]);
  
  // Ensure current page is valid
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  
  // Paginated users
  const paginatedUsers = useMemo(() => {
    if (totalItems === 0) return [];
    const start = (safeCurrentPage - 1) * pageSize;
    const end = Math.min(start + pageSize, totalItems);
    return filteredUsers.slice(start, end);
  }, [filteredUsers, safeCurrentPage, pageSize, totalItems]);

  // Pagination handlers
  const goToPage = (page: number) => {
    const newPage = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(newPage);
  };

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

  const openDeleteDialog = (user: User) => {
    setSelectedUser(user);
    setShowDeleteDialog(true);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setRoleFilter("all");
  };

  const hasActiveFilters = searchQuery.trim() !== "" || roleFilter !== "all";

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

  // Count users by role for stats
  const roleCounts = useMemo(() => {
    const counts = { admin: 0, withGrants: 0, noGrants: 0 };
    users.forEach((user) => {
      const grants = userGrants[user.name] || [];
      if (grants.length === 0) {
        counts.noGrants++;
      } else {
        counts.withGrants++;
        const grantSet = new Set(grants.map((g) => g.toUpperCase()));
        const adminIndicators = ["ALL", "GRANT OPTION", "ACCESS MANAGEMENT", "ROLE ADMIN", "CREATE USER", "DROP USER", "SYSTEM"];
        if (adminIndicators.some((ind) => grantSet.has(ind)) || grants.length > 20) {
          counts.admin++;
        }
      }
    });
    return counts;
  }, [users, userGrants]);

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

        <div className="flex items-center gap-2 w-full md:w-auto flex-wrap">
          {/* Search */}
          <div className="relative flex-1 md:w-64 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-white/5 border-white/10"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Role Filter */}
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as RoleType)}>
            <SelectTrigger className="w-[140px] bg-white/5 border-white/10">
              <Filter className="h-4 w-4 mr-2 text-gray-400" />
              <SelectValue placeholder="Filter role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="developer">Developer</SelectItem>
              <SelectItem value="readwrite">Read-Write</SelectItem>
              <SelectItem value="readonly">Read Only</SelectItem>
              <SelectItem value="noaccess">No Access</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="text-gray-400 hover:text-white"
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}

          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            className="shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
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
          <div className="text-2xl font-bold text-white">{roleCounts.admin}</div>
        </div>
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
          <div className="flex items-center gap-2 text-blue-400 text-sm mb-1">
            <UserCheck className="h-4 w-4" />
            With Grants
          </div>
          <div className="text-2xl font-bold text-white">{roleCounts.withGrants}</div>
        </div>
        <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
          <div className="flex items-center gap-2 text-purple-400 text-sm mb-1">
            <UserX className="h-4 w-4" />
            No Grants
          </div>
          <div className="text-2xl font-bold text-white">{roleCounts.noGrants}</div>
        </div>
      </div>

      {/* Filter Results Summary */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span>Showing {filteredUsers.length} of {users.length} users</span>
          {searchQuery && (
            <Badge variant="secondary" className="bg-white/10">
              Search: "{searchQuery}"
            </Badge>
          )}
          {roleFilter !== "all" && (
            <Badge variant="secondary" className="bg-white/10">
              Role: {roleFilter}
            </Badge>
          )}
        </div>
      )}

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
        <>
          <div
            key={`grid-${searchQuery}-${roleFilter}`}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {paginatedUsers.map((user) => {
              const roleInfo = detectUserRoleFromGrants(user.name, userGrants);
              return (
                <div
                  key={user.id || user.name}
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
                    </div>

                    {/* User Details */}
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-gray-400 shrink-0">Host</span>
                        <span className="text-gray-200 font-mono text-xs truncate max-w-[150px]" title={toSearchString(user.host_ip) || toSearchString(user.host_names) || "Any"}>
                          {(() => {
                            const hostIp = toSearchString(user.host_ip);
                            const hostNames = toSearchString(user.host_names);
                            const hostValue = hostIp || hostNames || "";
                            
                            if (!hostValue) return "Any";
                            
                            // Check if it's a list (comma-separated or array-like)
                            const hosts = hostValue.split(",").map(h => h.trim()).filter(Boolean);
                            if (hosts.length === 0) return "Any";
                            if (hosts.length === 1) return hosts[0];
                            
                            // Show first host + count
                            return `${hosts[0]} +${hosts.length - 1}`;
                          })()}
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
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => openDeleteDialog(user)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

          {/* Empty State */}
          {filteredUsers.length === 0 && (
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
                <Button onClick={() => navigate("/admin/users/create")}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create User
                </Button>
              )}
            </div>
          )}

          {/* Pagination Controls */}
          {filteredUsers.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-white/10">
              {/* Page Size Selector */}
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <span>Show</span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
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
                Showing {((safeCurrentPage - 1) * pageSize) + 1}-{Math.min(safeCurrentPage * pageSize, totalItems)} of {totalItems}
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
    </motion.div>
  );
};

export default UserManagement;
