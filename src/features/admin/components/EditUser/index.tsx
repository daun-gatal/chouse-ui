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
  Copy,
  AlertCircle,
  Save,
  UserX,
  UserCheck,
  Database,
  Unlink,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { log } from "@/lib/log";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
import { rbacUsersApi, rbacRolesApi, type RbacUser, type RbacRole, type UpdateUserInput, type SsoIdentityInfo } from "@/api/rbac";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { SsoProviderIcon } from "@/features/auth/SsoProviderIcon";
import { formatDistanceToNow, format } from "date-fns";

// Editorial: uniform hairline chrome for every role; identity is conveyed by
// a 2-letter monospace code rather than per-role color theming.
const ROLE_ICONS: Record<string, string> = {
  super_admin: 'SA',
  admin: 'AD',
  developer: 'DV',
  analyst: 'AN',
  viewer: 'VW',
  guest: 'GS',
};

const getRoleCode = (roleName: string) =>
  ROLE_ICONS[roleName] || roleName.slice(0, 2).toUpperCase();

// Password requirement indicator (editorial)
const RequirementItem = ({ fulfilled, label }: { fulfilled: boolean; label: string }) => (
  <div
    className={cn(
      "flex items-center gap-2 text-[11px] transition-colors",
      fulfilled ? "text-emerald-300" : "text-paper-faint"
    )}
  >
    <div
      className={cn(
        "flex h-3 w-3 items-center justify-center rounded-full border",
        fulfilled ? "border-emerald-700 bg-emerald-950/40" : "border-ink-500 bg-ink-200"
      )}
    >
      {fulfilled ? <Check className="h-2 w-2" /> : <div className="h-1 w-1 rounded-full bg-paper-faint" />}
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

  // SSO identity state
  // null = still loading; [] = loaded, no SSO; [...] = loaded, has SSO.
  // Avoids a flash where the reset-password button appears briefly before we
  // know the user has SSO identities.
  const [identities, setIdentities] = useState<SsoIdentityInfo[] | null>(null);
  const [identityToUnlink, setIdentityToUnlink] = useState<SsoIdentityInfo | null>(null);
  const [isUnlinking, setIsUnlinking] = useState(false);

  const isCurrentUser = user?.id === currentUser?.id;

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
      rbacUsersApi.getIdentities(userId),
    ])
      .then(([userData, rolesData, userIdentities]) => {
        // Check if basic admin is trying to edit super admin
        const userIsSuperAdmin = userData.roles.includes('super_admin');
        if (!isSuperAdmin() && userIsSuperAdmin) {
          toast.error("You do not have permission to edit super admin users");
          navigate("/admin");
          return;
        }

        setUser(userData);
        setEmail(userData.email);
        setUsername(userData.username);
        setDisplayName(userData.displayName || "");
        setIsActive(userData.isActive);
        setIdentities(userIdentities);

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
  }, [userId, isSuperAdmin, navigate]);

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
    // Only allow one role to be selected at a time
    setSelectedRoles(selectedRoles.includes(roleId) ? [] : [roleId]);
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

  const handleUnlinkIdentity = async () => {
    if (!identityToUnlink || !userId) return;

    setIsUnlinking(true);

    try {
      await rbacUsersApi.unlinkIdentity(userId, identityToUnlink.id);
      setIdentities((prev) => (prev ?? []).filter((i) => i.id !== identityToUnlink.id));
      toast.success(`Unlinked ${identityToUnlink.displayName} sign-in`);
      setIdentityToUnlink(null);
    } catch (err) {
      log.error("Failed to unlink SSO identity:", err);
      toast.error(`Failed to unlink identity: ${(err as Error).message}`);
    } finally {
      setIsUnlinking(false);
    }
  };

  // Get role display info
  const getRoleDisplay = (roleName: string) => {
    const role = roles.find((r) => r.name === roleName);
    return {
      displayName: role?.displayName || roleName,
      code: getRoleCode(roleName),
    };
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-paper-dim" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="container mx-auto max-w-lg p-6">
        <div className="rounded-xs border border-ink-500 bg-ink-100 px-6 py-12 text-center">
          <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-red-300" aria-hidden />
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">Error loading user</h2>
          <p className="mt-2 text-[12px] text-paper-muted">{error || "User not found"}</p>
          <Button
            onClick={() => navigate("/admin")}
            className="mt-6 h-9 gap-2 rounded-xs border-ink-500 bg-ink-200 px-3 text-paper hover:border-ink-700 hover:bg-ink-300"
            variant="outline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to users
          </Button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="container mx-auto max-w-4xl space-y-6 p-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/admin")}
            className="h-9 w-9 rounded-xs text-paper-dim hover:bg-ink-200 hover:text-paper"
            aria-label="Back to admin"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
            <UserCog className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[18px] font-semibold tracking-tight text-paper">Edit user</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
              @{user.username}
              {isCurrentUser && (
                <span className="ml-2 text-brand">(you)</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canDeleteUsers && !isCurrentUser && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  className="h-9 gap-2 rounded-xs border border-red-900/60 bg-red-950/40 px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-red-200 hover:bg-red-950/60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-xs border-ink-500 bg-ink-100">
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2 text-paper">
                    <AlertTriangle className="h-4 w-4 text-red-300" />
                    Delete user
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-paper-muted">
                    Are you sure you want to delete user <strong className="text-paper">{user.username}</strong>? This action
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    disabled={isDeleting}
                    className="h-9 rounded-xs border-ink-500 bg-ink-200 text-paper hover:border-ink-700 hover:bg-ink-300"
                  >
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className="h-9 rounded-xs border border-red-900/60 bg-red-950/40 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-red-200 hover:bg-red-950/60"
                    disabled={isDeleting}
                  >
                    {isDeleting ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        Deleting…
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

      {/* User Info — hairline editorial grid */}
      <div>
        <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
          <span className="h-px w-6 bg-ink-700" />
          <span>User information</span>
        </span>
        <div className="mt-3 grid grid-cols-2 border-l border-t border-ink-500 md:grid-cols-4">
          {/* Status */}
          <div className="flex flex-col gap-2 border-b border-r border-ink-500 px-5 py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">Status</span>
            <div className="flex items-center gap-2">
              {user.isActive ? (
                <>
                  <UserCheck className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
                  <span className="text-[13px] font-medium text-emerald-300">Active</span>
                </>
              ) : (
                <>
                  <UserX className="h-3.5 w-3.5 text-red-300" aria-hidden />
                  <span className="text-[13px] font-medium text-red-300">Inactive</span>
                </>
              )}
            </div>
          </div>

          {/* Created */}
          <div className="flex flex-col gap-2 border-b border-r border-ink-500 px-5 py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">Created</span>
            <span className="text-[13px] font-medium text-paper">
              {format(new Date(user.createdAt), "MMM d, yyyy")}
            </span>
          </div>

          {/* Last login */}
          <div className="flex flex-col gap-2 border-b border-r border-ink-500 px-5 py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">Last login</span>
            <span className="text-[13px] font-medium text-paper">
              {user.lastLoginAt
                ? formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true })
                : "Never"}
            </span>
          </div>

          {/* Roles */}
          <div className="flex flex-col gap-2 border-b border-r border-ink-500 px-5 py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">Roles</span>
            <div className="flex flex-wrap gap-1">
              {user.roles.map((role) => {
                const display = getRoleDisplay(role);
                return (
                  <span
                    key={role}
                    className="inline-flex items-center gap-1.5 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted"
                  >
                    <span className="font-semibold text-paper">{display.code}</span>
                    <span>{display.displayName}</span>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="details" className="space-y-6">
        <TabsList className="rounded-xs border border-ink-500 bg-ink-100 p-1">
          <TabsTrigger
            value="details"
            className="rounded-xs px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:bg-ink-200 data-[state=active]:text-paper"
          >
            <UserCog className="mr-2 h-3.5 w-3.5" />
            Details
          </TabsTrigger>
          <TabsTrigger
            value="roles"
            className="rounded-xs px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:bg-ink-200 data-[state=active]:text-paper"
          >
            <Shield className="mr-2 h-3.5 w-3.5" />
            Roles
          </TabsTrigger>
          <TabsTrigger
            value="security"
            className="rounded-xs px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:bg-ink-200 data-[state=active]:text-paper"
          >
            <Key className="mr-2 h-3.5 w-3.5" />
            Security
          </TabsTrigger>
        </TabsList>

        {/* Details Tab */}
        <TabsContent value="details">
          <div className="rounded-xs border border-ink-500 bg-ink-100">
            <div className="flex items-center gap-2 border-b border-ink-500 px-4 py-3">
              <UserCog className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
              <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper">User details</h3>
            </div>
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Email</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-paper-dim" />
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="rounded-xs border-ink-500 bg-ink-200 pl-9 text-paper"
                      disabled={!canUpdateUsers}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Username</Label>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                    className="rounded-xs border-ink-500 bg-ink-200 text-paper"
                    disabled={!canUpdateUsers}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Display name</Label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="John Doe"
                    className="rounded-xs border-ink-500 bg-ink-200 text-paper placeholder:text-paper-faint"
                    disabled={!canUpdateUsers}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Status</Label>
                  <div className="flex items-center gap-3 rounded-xs border border-ink-500 bg-ink-200 p-3">
                    <Switch
                      checked={isActive}
                      onCheckedChange={setIsActive}
                      disabled={!canUpdateUsers || isCurrentUser}
                    />
                    <span className={cn("text-[13px] font-medium", isActive ? "text-emerald-300" : "text-red-300")}>
                      {isActive ? "Active" : "Inactive"}
                    </span>
                    {isCurrentUser && (
                      <span className="text-[11px] text-paper-faint">(Cannot deactivate yourself)</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Roles Tab */}
        <TabsContent value="roles">
          <div className="rounded-xs border border-ink-500 bg-ink-100">
            <div className="flex items-center gap-2 border-b border-ink-500 px-4 py-3">
              <Shield className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
              <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper">Role assignment</h3>
            </div>
            <div className="space-y-4 p-4">
              {!canAssignRoles && (
                <div className="rounded-xs border border-amber-900/60 bg-amber-950/40 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-300">No permission</p>
                  <p className="mt-1 text-[12px] text-amber-200">You don't have permission to modify roles.</p>
                </div>
              )}

              <div className="space-y-3">
                {roles.map((role) => {
                  const code = getRoleCode(role.name);
                  const isSelected = selectedRoles.includes(role.id);

                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => toggleRole(role.id)}
                      disabled={!canAssignRoles}
                      className={cn(
                        "w-full rounded-xs border p-4 text-left transition-all",
                        isSelected
                          ? "border-brand/60 bg-ink-200"
                          : "border-ink-500 bg-ink-100 hover:border-ink-700",
                        !canAssignRoles && "cursor-not-allowed opacity-50"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            "grid h-9 w-9 shrink-0 place-items-center rounded-xs border font-mono text-[11px] font-semibold uppercase tracking-[0.14em]",
                            isSelected
                              ? "border-brand/60 bg-brand/10 text-brand"
                              : "border-ink-500 bg-ink-200 text-paper-muted"
                          )}
                        >
                          {code}
                        </span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold text-paper">
                              {role.displayName}
                            </span>
                            {role.isDefault && (
                              <span className="inline-flex items-center gap-1 rounded-xs border border-brand/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
                                Default
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[12px] text-paper-muted">{role.description}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {role.permissions.slice(0, 5).map((perm) => (
                              <span
                                key={perm}
                                className="inline-flex items-center rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted"
                              >
                                {perm}
                              </span>
                            ))}
                            {role.permissions.length > 5 && (
                              <span className="inline-flex items-center rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-paper-faint">
                                +{role.permissions.length - 5} more
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0">
                          <div
                            className={cn(
                              "flex h-5 w-5 items-center justify-center rounded-full border-2",
                              isSelected
                                ? "border-brand bg-brand"
                                : "border-ink-700 bg-transparent"
                            )}
                          >
                            {isSelected && (
                              <Check className="h-3 w-3 text-ink-50" />
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedRoles.length === 0 && (
                <div className="flex items-center gap-2 rounded-xs border border-amber-900/60 bg-amber-950/40 px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 text-amber-300" aria-hidden />
                  <p className="text-[12px] text-amber-200">User must have a role.</p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security">
          <div className="rounded-xs border border-ink-500 bg-ink-100">
            <div className="flex items-center gap-2 border-b border-ink-500 px-4 py-3">
              <Key className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
              <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper">Security</h3>
            </div>
            <div className="space-y-4 p-4">
              {/* Password Reset — only for password-based users. SSO accounts
                  have no usable local password. */}
              <div className="rounded-xs border border-ink-500 bg-ink-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-[13px] font-semibold text-paper">Password</h4>
                    <p className="mt-1 text-[12px] text-paper-muted">
                      {identities === null
                        ? "Loading…"
                        : identities.length === 0
                        ? "Reset the user's password."
                        : (() => {
                            const providers = identities.map((i) =>
                              i.provider.charAt(0).toUpperCase() + i.provider.slice(1)
                            );
                            const providerList =
                              providers.length === 1
                                ? providers[0]
                                : `${providers.slice(0, -1).join(", ")} and ${providers.at(-1)}`;
                            return `This user authenticates via ${providerList}. Manage credentials through the identity provider.`;
                          })()}
                    </p>
                  </div>
                  {canUpdateUsers && identities !== null && identities.length === 0 && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowResetPasswordDialog(true);
                        setGeneratedPassword(null);
                        setNewPassword("");
                        setConfirmPassword("");
                        setUseGeneratedPassword(true);
                      }}
                      className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 text-paper hover:border-ink-700 hover:bg-ink-300"
                    >
                      <Key className="h-3.5 w-3.5" />
                      Reset password
                    </Button>
                  )}
                </div>
              </div>

              {/* SSO Identity */}
              <div className="rounded-xs border border-ink-500 bg-ink-200 p-4">
                <h4 className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">SSO identity</h4>
                {identities === null ? (
                  <p className="text-[12px] italic text-paper-faint">Loading…</p>
                ) : identities.length === 0 ? (
                  <p className="text-[12px] italic text-paper-faint">
                    No SSO identity linked. This user signs in with a password.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {identities.map((identity) => (
                      <div
                        key={identity.id}
                        className="flex items-center justify-between gap-3 rounded-xs border border-ink-500 bg-ink-100 px-3 py-2.5"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xs border border-ink-500 bg-ink-200">
                            <SsoProviderIcon
                              provider={{ id: identity.provider, displayName: identity.displayName }}
                              className="h-4 w-4"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-semibold text-paper">{identity.displayName}</span>
                              <span className="inline-flex items-center rounded-xs border border-emerald-800 bg-emerald-950/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-emerald-300">
                                Linked
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-[11px] text-paper-muted">
                              {identity.email || "no email"} · last sign-in{" "}
                              {identity.lastLoginAt
                                ? formatDistanceToNow(new Date(identity.lastLoginAt), { addSuffix: true })
                                : "never"}
                            </p>
                          </div>
                        </div>
                        {canUpdateUsers && (
                          <Button
                            variant="outline"
                            onClick={() => setIdentityToUnlink(identity)}
                            className="h-8 shrink-0 gap-1.5 rounded-xs border-ink-500 bg-ink-100 px-2.5 text-[12px] text-paper hover:border-red-900/60 hover:bg-red-950/30 hover:text-red-200"
                          >
                            <Unlink className="h-3.5 w-3.5" />
                            Unlink
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Permissions Summary */}
              <div className="rounded-xs border border-ink-500 bg-ink-200 p-4">
                <h4 className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Effective permissions</h4>
                <div className="flex flex-wrap gap-1.5">
                  {user.permissions.length === 0 ? (
                    <span className="text-[12px] italic text-paper-faint">No permissions</span>
                  ) : (
                    user.permissions.map((perm) => (
                      <span
                        key={perm}
                        className="inline-flex items-center rounded-xs border border-ink-500 bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted"
                      >
                        {perm}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Save Button */}
      {canUpdateUsers && (
        <div className="flex items-center justify-between border-t border-ink-500 pt-6">
          <div className="flex flex-col gap-1">
            {hasChanges && (
              <span className="flex items-center gap-2 text-[12px] text-amber-300">
                <AlertCircle className="h-3.5 w-3.5" />
                You have unsaved changes
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => navigate("/admin")}
              className="h-9 rounded-xs border-ink-500 bg-ink-100 px-3 text-paper hover:border-ink-700 hover:bg-ink-200"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || isSaving || selectedRoles.length === 0}
              className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  Save changes
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Reset Password Dialog */}
      <Dialog open={showResetPasswordDialog} onOpenChange={setShowResetPasswordDialog}>
        <DialogContent className="max-w-md rounded-xs border-ink-500 bg-ink-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-paper">
              <Key className="h-4 w-4 text-paper-dim" aria-hidden />
              Reset password
            </DialogTitle>
            <DialogDescription className="text-paper-muted">
              Reset the password for user <strong className="text-paper">{user.username}</strong>.
            </DialogDescription>
          </DialogHeader>

          {generatedPassword ? (
            <div className="space-y-4">
              <div className="rounded-xs border border-emerald-900/60 bg-emerald-950/40 p-4">
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-300">Password reset successfully</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-xs border border-ink-500 bg-ink-100 p-2 font-mono text-[12px] text-paper break-all">
                    {generatedPassword}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={copyPassword}
                    className="h-8 rounded-xs border-ink-500 bg-ink-200 text-paper hover:border-ink-700 hover:bg-ink-300"
                    aria-label="Copy password"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="mt-2 text-[11px] text-emerald-200/80">
                  Save this password securely. It won't be shown again.
                </p>
              </div>
              <Button
                onClick={() => setShowResetPasswordDialog(false)}
                className="h-9 w-full rounded-xs bg-brand font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
              >
                Done
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-xs border border-ink-500 bg-ink-200 p-3">
                <Checkbox
                  id="use-generated"
                  checked={useGeneratedPassword}
                  onCheckedChange={(checked) => setUseGeneratedPassword(!!checked)}
                />
                <Label htmlFor="use-generated" className="cursor-pointer text-[13px] text-paper">
                  Generate a secure password automatically
                </Label>
              </div>

              {!useGeneratedPassword && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">New password</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showPassword ? "text" : "password"}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Enter new password"
                          className="rounded-xs border-ink-500 bg-ink-200 pr-10 text-paper placeholder:text-paper-faint"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-paper-dim hover:text-paper"
                          aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleGeneratePasswordManually}
                        className="h-9 shrink-0 rounded-xs border-ink-500 bg-ink-200 text-paper hover:border-ink-700 hover:bg-ink-300"
                      >
                        Generate
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Confirm password</Label>
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm password"
                      className="rounded-xs border-ink-500 bg-ink-200 text-paper placeholder:text-paper-faint"
                    />
                    {confirmPassword && !passwordsMatch && (
                      <p className="text-[11px] text-red-300">Passwords do not match.</p>
                    )}
                  </div>

                  <div className="rounded-xs border border-ink-500 bg-ink-200 p-3">
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Requirements</p>
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
                  className="h-9 flex-1 rounded-xs border-ink-500 bg-ink-200 text-paper hover:border-ink-700 hover:bg-ink-300"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleResetPassword}
                  disabled={isResettingPassword || (!useGeneratedPassword && (!isPasswordValid || !passwordsMatch))}
                  className="h-9 flex-1 gap-2 rounded-xs bg-brand font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50"
                >
                  {isResettingPassword ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Resetting…
                    </>
                  ) : (
                    "Reset password"
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Unlink SSO identity confirmation */}
      <AlertDialog
        open={!!identityToUnlink}
        onOpenChange={(open) => {
          if (!open) setIdentityToUnlink(null);
        }}
      >
        <AlertDialogContent className="rounded-xs border-ink-500 bg-ink-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-paper">
              <AlertTriangle className="h-4 w-4 text-red-300" />
              Unlink SSO identity
            </AlertDialogTitle>
            <AlertDialogDescription className="text-paper-muted">
              Remove the <strong className="text-paper">{identityToUnlink?.displayName}</strong> sign-in link from{" "}
              <strong className="text-paper">{user?.username}</strong>? If this is their only sign-in method, they will be
              locked out until you reset their password.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isUnlinking}
              className="h-9 rounded-xs border-ink-500 bg-ink-200 text-paper hover:border-ink-700 hover:bg-ink-300"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleUnlinkIdentity();
              }}
              disabled={isUnlinking}
              className="h-9 gap-2 rounded-xs border border-red-900/60 bg-red-950/40 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-red-200 hover:bg-red-950/60"
            >
              {isUnlinking ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Unlinking…
                </>
              ) : (
                <>
                  <Unlink className="h-3.5 w-3.5" />
                  Unlink
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
};

export default EditUser;
