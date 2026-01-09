/**
 * RBAC Edit User Component
 * 
 * Edits users through the RBAC system with role management.
 * No ClickHouse DDL is executed - user management is done through RBAC.
 */

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  UserCog,
  ArrowLeft,
  Loader2,
  Shield,
  Key,
  Trash2,
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  Mail,
  Clock,
  Copy,
  AlertCircle,
  Save,
  UserX,
  UserCheck,
  Database,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle } from "@/components/ui/glass-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { rbacUsersApi, rbacRolesApi, rbacDataAccessApi, type RbacUser, type RbacRole, type UpdateUserInput } from "@/api/rbac";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { formatDistanceToNow, format } from "date-fns";
import { UserDataAccess } from "../UserDataAccess";

// Admin roles that don't require data access rules
const ADMIN_ROLES = ['super_admin', 'admin'];

// Role colors for display
const ROLE_COLORS: Record<string, { icon: string; color: string; bgColor: string; borderColor: string }> = {
  super_admin: {
    icon: "👑",
    color: "text-red-400",
    bgColor: "bg-red-500/20",
    borderColor: "border-red-500/50",
  },
  admin: {
    icon: "🛡️",
    color: "text-orange-400",
    bgColor: "bg-orange-500/20",
    borderColor: "border-orange-500/50",
  },
  developer: {
    icon: "👨‍💻",
    color: "text-blue-400",
    bgColor: "bg-blue-500/20",
    borderColor: "border-blue-500/50",
  },
  analyst: {
    icon: "📊",
    color: "text-green-400",
    bgColor: "bg-green-500/20",
    borderColor: "border-green-500/50",
  },
  viewer: {
    icon: "👁️",
    color: "text-purple-400",
    bgColor: "bg-purple-500/20",
    borderColor: "border-purple-500/50",
  },
};

// Password requirement indicator component
const RequirementItem = ({ fulfilled, label }: { fulfilled: boolean; label: string }) => (
  <div className={`flex items-center gap-2 text-xs transition-colors duration-200 ${fulfilled ? "text-green-400" : "text-gray-500"}`}>
    <div className={`w-4 h-4 rounded-full flex items-center justify-center border ${fulfilled ? "bg-green-500/10 border-green-500/50" : "border-gray-700 bg-gray-800"}`}>
      {fulfilled ? <Check className="w-2.5 h-2.5" /> : <div className="w-1 h-1 rounded-full bg-gray-600" />}
    </div>
    <span>{label}</span>
  </div>
);

const EditUser: React.FC = () => {
  const navigate = useNavigate();
  const { userId } = useParams<{ userId: string }>();
  const { hasPermission, isSuperAdmin, user: currentUser } = useRbacStore();

  // Permission checks
  const canUpdateUsers = hasPermission(RBAC_PERMISSIONS.USERS_UPDATE);
  const canDeleteUsers = hasPermission(RBAC_PERMISSIONS.USERS_DELETE);
  const canAssignRoles = hasPermission(RBAC_PERMISSIONS.ROLES_ASSIGN);

  // Data state
  const [user, setUser] = useState<RbacUser | null>(null);
  const [roles, setRoles] = useState<RbacRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Password reset state
  const [showResetPasswordDialog, setShowResetPasswordDialog] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [useGeneratedPassword, setUseGeneratedPassword] = useState(true);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);

  // Delete state
  const [isDeleting, setIsDeleting] = useState(false);

  // Data access state
  const [dataAccessRulesCount, setDataAccessRulesCount] = useState(0);

  const isCurrentUser = user?.id === currentUser?.id;

  // Check if selected roles require data access rules
  const selectedRoleNames = selectedRoles.map(roleId => roles.find(r => r.id === roleId)?.name || '');
  const hasAdminRole = selectedRoleNames.some(name => ADMIN_ROLES.includes(name));
  const requiresDataAccess = !hasAdminRole && selectedRoles.length > 0;
  const dataAccessValid = !requiresDataAccess || dataAccessRulesCount > 0;

  // Fetch user and roles
  useEffect(() => {
    if (!userId) {
      setError("User ID is required");
      setIsLoading(false);
      return;
    }

    Promise.all([
      rbacUsersApi.get(userId), 
      rbacRolesApi.list(),
      rbacDataAccessApi.getRulesForUser(userId)
    ])
      .then(([userData, rolesData, userRules]) => {
        setUser(userData);
        setEmail(userData.email);
        setUsername(userData.username);
        setDisplayName(userData.displayName || "");
        setIsActive(userData.isActive);
        setDataAccessRulesCount(userRules.length);

        // Filter out super_admin if current user is not super_admin
        const filteredRoles = isSuperAdmin()
          ? rolesData
          : rolesData.filter((r) => r.name !== "super_admin");
        setRoles(filteredRoles);

        // Find role IDs for user's roles
        const userRoleIds = rolesData
          .filter((r) => userData.roles.includes(r.name))
          .map((r) => r.id);
        setSelectedRoles(userRoleIds);
      })
      .catch((err) => {
        setError(err.message || "Failed to load user");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [userId, isSuperAdmin]);

  // Track changes
  useEffect(() => {
    if (!user) return;

    const roleIds = roles.filter((r) => user.roles.includes(r.name)).map((r) => r.id);

    const changed =
      email !== user.email ||
      username !== user.username ||
      displayName !== (user.displayName || "") ||
      isActive !== user.isActive ||
      JSON.stringify(selectedRoles.sort()) !== JSON.stringify(roleIds.sort());

    setHasChanges(changed);
  }, [user, email, username, displayName, isActive, selectedRoles, roles]);

  // Password validation
  const passwordReqs = {
    length: newPassword.length >= 12,
    upper: /[A-Z]/.test(newPassword),
    lower: /[a-z]/.test(newPassword),
    number: /\d/.test(newPassword),
    special: /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(newPassword),
  };

  const isPasswordValid = useGeneratedPassword || Object.values(passwordReqs).every(Boolean);
  const passwordsMatch = useGeneratedPassword || newPassword === confirmPassword;

  const toggleRole = (roleId: string) => {
    if (!canAssignRoles) return;
    setSelectedRoles((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]
    );
  };

  const handleGeneratePasswordManually = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let pwd = "";
    pwd += "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 26)];
    pwd += "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)];
    pwd += "0123456789"[Math.floor(Math.random() * 10)];
    pwd += "!@#$%^&*"[Math.floor(Math.random() * 8)];
    for (let i = 0; i < 12; i++) {
      pwd += chars[Math.floor(Math.random() * chars.length)];
    }
    pwd = pwd.split("").sort(() => Math.random() - 0.5).join("");
    setNewPassword(pwd);
    setConfirmPassword(pwd);
  };

  const copyPassword = () => {
    if (generatedPassword) {
      navigator.clipboard.writeText(generatedPassword);
      toast.success("Password copied to clipboard");
    }
  };

  const handleSave = async () => {
    if (!user || !hasChanges) return;

    setIsSaving(true);

    try {
      const input: UpdateUserInput = {};

      if (email !== user.email) input.email = email.trim();
      if (username !== user.username) input.username = username.trim();
      if (displayName !== (user.displayName || "")) input.displayName = displayName.trim() || undefined;
      if (isActive !== user.isActive) input.isActive = isActive;
      if (canAssignRoles) {
        const originalRoleIds = roles.filter((r) => user.roles.includes(r.name)).map((r) => r.id);
        if (JSON.stringify(selectedRoles.sort()) !== JSON.stringify(originalRoleIds.sort())) {
          input.roleIds = selectedRoles;
        }
      }

      const updatedUser = await rbacUsersApi.update(user.id, input);
      setUser(updatedUser);
      toast.success("User updated successfully");
      setHasChanges(false);
    } catch (err) {
      toast.error(`Failed to update user: ${(err as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!user) return;

    setIsResettingPassword(true);

    try {
      if (useGeneratedPassword) {
        const result = await rbacUsersApi.resetPassword(user.id, { generatePassword: true });
        setGeneratedPassword(result.generatedPassword || null);
        toast.success("Password reset successfully");
      } else {
        if (!isPasswordValid || !passwordsMatch) {
          toast.error("Please enter a valid password");
          setIsResettingPassword(false);
          return;
        }
        await rbacUsersApi.resetPassword(user.id, { newPassword });
        toast.success("Password reset successfully");
        setShowResetPasswordDialog(false);
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch (err) {
      toast.error(`Failed to reset password: ${(err as Error).message}`);
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleDelete = async () => {
    if (!user) return;

    setIsDeleting(true);

    try {
      await rbacUsersApi.delete(user.id);
      toast.success(`User "${user.username}" deleted successfully`);
      navigate("/admin");
    } catch (err) {
      toast.error(`Failed to delete user: ${(err as Error).message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Get role display info
  const getRoleDisplay = (roleName: string) => {
    const role = roles.find((r) => r.name === roleName);
    const colors = ROLE_COLORS[roleName] || {
      icon: "🔹",
      color: "text-gray-400",
      bgColor: "bg-gray-500/20",
      borderColor: "border-gray-500/50",
    };
    return {
      displayName: role?.displayName || roleName,
      ...colors,
    };
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="container mx-auto p-6 max-w-lg">
        <GlassCard>
          <GlassCardContent className="py-12 text-center">
            <AlertTriangle className="h-12 w-12 text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">Error Loading User</h2>
            <p className="text-gray-400 mb-6">{error || "User not found"}</p>
            <Button onClick={() => navigate("/admin")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Users
            </Button>
          </GlassCardContent>
        </GlassCard>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="container mx-auto p-6 space-y-6 max-w-4xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <UserCog className="h-6 w-6 text-blue-400" />
            <div>
              <h1 className="text-2xl font-bold text-white">Edit User</h1>
              <p className="text-gray-400 text-sm">
                @{user.username}
                {isCurrentUser && <span className="text-purple-400 ml-2">(You)</span>}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canDeleteUsers && !isCurrentUser && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="gap-2">
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-red-500" />
                    Delete User
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete user <strong>{user.username}</strong>? This action
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="bg-red-600 hover:bg-red-700"
                    disabled={isDeleting}
                  >
                    {isDeleting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      "Delete"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* User Info Card */}
      <GlassCard>
        <GlassCardHeader>
          <GlassCardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-purple-400" />
            User Information
          </GlassCardTitle>
        </GlassCardHeader>
        <GlassCardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 rounded-lg bg-white/5">
              <div className="text-xs text-gray-400 mb-1">Status</div>
              <div className="flex items-center gap-2">
                {user.isActive ? (
                  <>
                    <UserCheck className="h-4 w-4 text-green-400" />
                    <span className="text-green-400 font-medium">Active</span>
                  </>
                ) : (
                  <>
                    <UserX className="h-4 w-4 text-red-400" />
                    <span className="text-red-400 font-medium">Inactive</span>
                  </>
                )}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <div className="text-xs text-gray-400 mb-1">Created</div>
              <div className="text-white font-medium">
                {format(new Date(user.createdAt), "MMM d, yyyy")}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <div className="text-xs text-gray-400 mb-1">Last Login</div>
              <div className="text-white font-medium">
                {user.lastLoginAt
                  ? formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true })
                  : "Never"}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <div className="text-xs text-gray-400 mb-1">Roles</div>
              <div className="flex flex-wrap gap-1">
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
            </div>
          </div>
        </GlassCardContent>
      </GlassCard>

      {/* Tabs */}
      <Tabs defaultValue="details" className="space-y-6">
        <TabsList className="bg-white/5 border border-white/10 p-1">
          <TabsTrigger value="details" className="data-[state=active]:bg-blue-500/20">
            <UserCog className="h-4 w-4 mr-2" />
            Details
          </TabsTrigger>
          <TabsTrigger value="roles" className="data-[state=active]:bg-purple-500/20">
            <Shield className="h-4 w-4 mr-2" />
            Roles
          </TabsTrigger>
          <TabsTrigger 
            value="data-access" 
            className={`data-[state=active]:bg-cyan-500/20 ${requiresDataAccess && !dataAccessValid ? "text-red-400" : ""}`}
          >
            <Database className="h-4 w-4 mr-2" />
            Data Access
            {requiresDataAccess && !dataAccessValid && (
              <span className="ml-1 text-red-400">*</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="security" className="data-[state=active]:bg-yellow-500/20">
            <Key className="h-4 w-4 mr-2" />
            Security
          </TabsTrigger>
        </TabsList>

        {/* Details Tab */}
        <TabsContent value="details">
          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle className="flex items-center gap-2">
                <UserCog className="h-5 w-5 text-blue-400" />
                User Details
              </GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-white">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="bg-white/5 border-white/10 pl-10"
                      disabled={!canUpdateUsers}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-white">Username</Label>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                    className="bg-white/5 border-white/10"
                    disabled={!canUpdateUsers}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-white">Display Name</Label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="John Doe"
                    className="bg-white/5 border-white/10"
                    disabled={!canUpdateUsers}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-white">Status</Label>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                    <Switch
                      checked={isActive}
                      onCheckedChange={setIsActive}
                      disabled={!canUpdateUsers || isCurrentUser}
                    />
                    <span className={isActive ? "text-green-400" : "text-red-400"}>
                      {isActive ? "Active" : "Inactive"}
                    </span>
                    {isCurrentUser && (
                      <span className="text-xs text-gray-500">(Cannot deactivate yourself)</span>
                    )}
                  </div>
                </div>
              </div>
            </GlassCardContent>
          </GlassCard>
        </TabsContent>

        {/* Roles Tab */}
        <TabsContent value="roles">
          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-purple-400" />
                Role Assignment
              </GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent className="space-y-4">
              {!canAssignRoles && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-400">
                  You don't have permission to modify roles.
                </div>
              )}

              <div className="space-y-3">
                {roles.map((role) => {
                  const colors = ROLE_COLORS[role.name] || {
                    icon: "🔹",
                    color: "text-gray-400",
                    bgColor: "bg-gray-500/20",
                    borderColor: "border-gray-500/50",
                  };
                  const isSelected = selectedRoles.includes(role.id);

                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => toggleRole(role.id)}
                      disabled={!canAssignRoles}
                      className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
                        isSelected
                          ? `${colors.bgColor} ${colors.borderColor}`
                          : "bg-white/5 border-white/10 hover:bg-white/10"
                      } ${!canAssignRoles && "opacity-50 cursor-not-allowed"}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="text-2xl">{colors.icon}</div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`font-semibold ${isSelected ? colors.color : "text-white"}`}>
                              {role.displayName}
                            </span>
                            {role.isDefault && (
                              <span className="px-2 py-0.5 rounded text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                Default
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 mt-1">{role.description}</p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {role.permissions.slice(0, 5).map((perm) => (
                              <span
                                key={perm}
                                className="px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-gray-300"
                              >
                                {perm}
                              </span>
                            ))}
                            {role.permissions.length > 5 && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-gray-400">
                                +{role.permissions.length - 5} more
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0">
                          <Checkbox checked={isSelected} disabled={!canAssignRoles} />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedRoles.length === 0 && (
                <p className="text-sm text-amber-400">⚠️ User must have at least one role</p>
              )}
            </GlassCardContent>
          </GlassCard>
        </TabsContent>

        {/* Data Access Tab */}
        <TabsContent value="data-access">
          <GlassCard className={requiresDataAccess && !dataAccessValid ? "border-red-500/50" : ""}>
            <GlassCardHeader>
              <GlassCardTitle className="flex items-center gap-2">
                <Database className={`h-5 w-5 ${requiresDataAccess && !dataAccessValid ? "text-red-400" : "text-cyan-400"}`} />
                Database & Table Access
                {requiresDataAccess && (
                  <span className="text-red-400 text-xs">*</span>
                )}
                {dataAccessRulesCount > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {dataAccessRulesCount} rule{dataAccessRulesCount !== 1 ? 's' : ''}
                  </Badge>
                )}
                {requiresDataAccess && !dataAccessValid && (
                  <Badge variant="destructive" className="ml-2 text-xs">
                    Required
                  </Badge>
                )}
              </GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent>
              {requiresDataAccess && !dataAccessValid ? (
                <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-300 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium">Data access rules required</p>
                    <p className="text-xs text-red-400/80 mt-1">
                      Non-admin roles (Developer, Analyst, Viewer) must have at least one data access rule to specify which databases/tables they can access.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mb-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm text-blue-300">
                  <p>
                    These rules define which databases and tables this user can access.
                    User-specific rules supplement the permissions from assigned roles.
                  </p>
                </div>
              )}
              <UserDataAccess
                userId={userId!}
                userName={user.displayName || user.username}
                canEdit={canUpdateUsers}
                onRulesChange={(count) => setDataAccessRulesCount(count)}
              />
            </GlassCardContent>
          </GlassCard>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security">
          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-yellow-400" />
                Security
              </GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent className="space-y-6">
              {/* Password Reset */}
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-white">Password</h3>
                    <p className="text-sm text-gray-400">Reset the user's password</p>
                  </div>
                  {canUpdateUsers && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowResetPasswordDialog(true);
                        setGeneratedPassword(null);
                        setNewPassword("");
                        setConfirmPassword("");
                        setUseGeneratedPassword(true);
                      }}
                    >
                      <Key className="h-4 w-4 mr-2" />
                      Reset Password
                    </Button>
                  )}
                </div>
              </div>

              {/* Permissions Summary */}
              <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                <h3 className="font-medium text-white mb-3">Effective Permissions</h3>
                <div className="flex flex-wrap gap-2">
                  {user.permissions.length === 0 ? (
                    <span className="text-sm text-gray-500 italic">No permissions</span>
                  ) : (
                    user.permissions.map((perm) => (
                      <span
                        key={perm}
                        className="px-2 py-1 rounded text-xs bg-white/10 text-gray-300 border border-white/10"
                      >
                        {perm}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </GlassCardContent>
          </GlassCard>
        </TabsContent>
      </Tabs>

      {/* Save Button */}
      {canUpdateUsers && (
        <div className="flex items-center justify-between pt-6 border-t border-white/10">
          <div>
            {hasChanges && (
              <span className="text-sm text-amber-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                You have unsaved changes
              </span>
            )}
            {requiresDataAccess && !dataAccessValid && (
              <span className="text-sm text-red-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                Data access rules required for non-admin roles
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => navigate("/admin")}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!hasChanges || isSaving || selectedRoles.length === 0 || !dataAccessValid}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Reset Password Dialog */}
      <Dialog open={showResetPasswordDialog} onOpenChange={setShowResetPasswordDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-yellow-500" />
              Reset Password
            </DialogTitle>
            <DialogDescription>
              Reset the password for user <strong>{user.username}</strong>.
            </DialogDescription>
          </DialogHeader>

          {generatedPassword ? (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                <p className="text-sm text-green-300 mb-2">Password reset successfully!</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2 rounded bg-black/30 text-white font-mono text-sm break-all">
                    {generatedPassword}
                  </code>
                  <Button size="sm" variant="outline" onClick={copyPassword}>
                    <Copy className="h-4 w-4" />
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
              <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                <Checkbox
                  id="use-generated"
                  checked={useGeneratedPassword}
                  onCheckedChange={(checked) => setUseGeneratedPassword(!!checked)}
                />
                <Label htmlFor="use-generated" className="text-white cursor-pointer">
                  Generate a secure password automatically
                </Label>
              </div>

              {!useGeneratedPassword && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-white">New Password</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showPassword ? "text" : "password"}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Enter new password"
                          className="bg-white/5 border-white/10 pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <Button type="button" variant="outline" onClick={handleGeneratePasswordManually}>
                        Generate
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-white">Confirm Password</Label>
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm password"
                      className="bg-white/5 border-white/10"
                    />
                    {confirmPassword && !passwordsMatch && (
                      <p className="text-xs text-red-400">Passwords do not match</p>
                    )}
                  </div>

                  <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                    <p className="text-xs text-gray-400 mb-2">Requirements:</p>
                    <div className="grid grid-cols-2 gap-1">
                      <RequirementItem fulfilled={passwordReqs.length} label="12+ characters" />
                      <RequirementItem fulfilled={passwordReqs.upper} label="Uppercase" />
                      <RequirementItem fulfilled={passwordReqs.lower} label="Lowercase" />
                      <RequirementItem fulfilled={passwordReqs.number} label="Number" />
                      <RequirementItem fulfilled={passwordReqs.special} label="Special char" />
                    </div>
                  </div>
                </div>
              )}

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
                  disabled={isResettingPassword || (!useGeneratedPassword && (!isPasswordValid || !passwordsMatch))}
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

export default EditUser;
