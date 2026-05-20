/**
 * RBAC Create User Component
 *
 * Creates users through the RBAC system with role assignment.
 * No ClickHouse DDL is executed - user management is done through RBAC.
 */

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  UserPlus,
  ArrowLeft,
  Loader2,
  Copy,
  Check,
  Eye,
  EyeOff,
  AlertCircle,
  Sparkles,
  Database,
  Table2,
  Plus,
  Trash2,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { log } from "@/lib/log";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { rbacUsersApi, rbacRolesApi, rbacConnectionsApi, rbacDataAccessApi, type RbacRole, type CreateUserInput, type ClickHouseConnection } from "@/api/rbac";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";

// Editorial role chrome: uniform hairline; identity comes from a 2-letter code.
const ROLE_CODES: Record<string, string> = {
  super_admin: "SA",
  admin: "AD",
  developer: "DV",
  analyst: "AN",
  viewer: "VW",
  guest: "GS",
};

const getRoleCode = (roleName: string) =>
  ROLE_CODES[roleName] || roleName.slice(0, 2).toUpperCase();

// Password requirement indicator component
const RequirementItem = ({ fulfilled, label }: { fulfilled: boolean; label: string }) => (
  <div className={`flex items-center gap-2 text-[11px] transition-colors ${fulfilled ? "text-emerald-300" : "text-paper-faint"}`}>
    <div className={`w-3 h-3 rounded-full flex items-center justify-center border ${fulfilled ? "border-emerald-700 bg-emerald-950/40" : "border-ink-500 bg-ink-200"}`}>
      {fulfilled ? <Check className="h-2 w-2" /> : <div className="h-1 w-1 rounded-full bg-paper-faint" />}
    </div>
    <span>{label}</span>
  </div>
);

// Data access rule type for local state (before user is created)
interface PendingDataAccessRule {
  id: string;
  connectionId: string | null;
  databasePattern: string;
  tablePattern: string;
  isAllowed: boolean;
  priority: number;
  description: string;
}

interface DataAccessFormData {
  connectionId: string | null;
  databasePattern: string;
  tablePattern: string;
  isAllowed: boolean;
  priority: number;
  description: string;
}

const defaultDataAccessForm: DataAccessFormData = {
  connectionId: null,
  databasePattern: '*',
  tablePattern: '*',
  isAllowed: true,
  priority: 0,
  description: '',
};

const CreateUser: React.FC = () => {
  const navigate = useNavigate();
  const { hasPermission, isSuperAdmin } = useRbacStore();

  // Permission checks
  const canAssignRoles = hasPermission(RBAC_PERMISSIONS.ROLES_ASSIGN);

  // Form state
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [generatePassword, setGeneratePassword] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);

  // Roles data
  const [roles, setRoles] = useState<RbacRole[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);

  // Data access state
  const [dataAccessRules, setDataAccessRules] = useState<PendingDataAccessRule[]>([]);
  const [connections, setConnections] = useState<ClickHouseConnection[]>([]);
  const [showDataAccessDialog, setShowDataAccessDialog] = useState(false);
  const [editingRuleIndex, setEditingRuleIndex] = useState<number | null>(null);
  const [dataAccessForm, setDataAccessForm] = useState<DataAccessFormData>(defaultDataAccessForm);
  const [showDataAccessSection, setShowDataAccessSection] = useState(false);

  // Fetch available roles and connections
  useEffect(() => {
    // Fetch roles
    rbacRolesApi
      .list()
      .then((result) => {
        // Filter out super_admin if current user is not super_admin
        const filteredRoles = isSuperAdmin()
          ? result
          : result.filter((r) => r.name !== "super_admin");
        setRoles(filteredRoles);

        // Select default role if exists
        const defaultRole = filteredRoles.find((r) => r.isDefault);
        if (defaultRole) {
          setSelectedRoles([defaultRole.id]);
        }
      })
      .catch((err) => {
        toast.error(`Failed to load roles: ${err.message}`);
      })
      .finally(() => {
        setLoadingRoles(false);
      });

    // Fetch connections for data access rules
    rbacConnectionsApi
      .list()
      .then((result) => {
        setConnections(result.connections);
      })
      .catch((err) => {
        log.error('Failed to load connections:', err);
      });
  }, [isSuperAdmin]);

  // Auto-expand data access section when required
  useEffect(() => {
    const ADMIN_ROLES = ['super_admin', 'admin'];
    const ROLES_WITH_PREDEFINED_RULES = ['guest'];
    const selectedRoleNames = selectedRoles.map(roleId => roles.find(r => r.id === roleId)?.name || '');
    const hasAdminRole = selectedRoleNames.some(name => ADMIN_ROLES.includes(name));
    const hasPredefinedRules = selectedRoleNames.some(name => ROLES_WITH_PREDEFINED_RULES.includes(name));
    const needsDataAccess = !hasAdminRole && !hasPredefinedRules && selectedRoles.length > 0;

    if (needsDataAccess && dataAccessRules.length === 0) {
      setShowDataAccessSection(true);
    }
  }, [selectedRoles, roles, dataAccessRules.length]);

  // Password validation requirements
  const passwordReqs = {
    length: password.length >= 12,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password),
  };

  const isPasswordValid = generatePassword || Object.values(passwordReqs).every(Boolean);
  const passwordsMatch = generatePassword || password === confirmPassword;

  // Check if selected roles require data access rules (non-admin roles)
  // Note: GUEST role has pre-defined role-level data access rules, so it doesn't require user-level rules
  const ADMIN_ROLES = ['super_admin', 'admin'];
  const ROLES_WITH_PREDEFINED_RULES = ['guest']; // Roles that have role-level data access rules
  const ROLES_WITHOUT_DATA_ACCESS_UI = [...ADMIN_ROLES, ...ROLES_WITH_PREDEFINED_RULES]; // Roles that don't need data access UI
  const selectedRoleNames = selectedRoles.map(roleId => roles.find(r => r.id === roleId)?.name || '');
  const hasAdminRole = selectedRoleNames.some(name => ADMIN_ROLES.includes(name));
  const hasPredefinedRules = selectedRoleNames.some(name => ROLES_WITH_PREDEFINED_RULES.includes(name));
  const requiresDataAccess = !hasAdminRole && !hasPredefinedRules && selectedRoles.length > 0;
  const showDataAccessUI = !selectedRoleNames.some(name => ROLES_WITHOUT_DATA_ACCESS_UI.includes(name));
  const dataAccessValid = !requiresDataAccess || dataAccessRules.length > 0;

  // Form validation
  const isFormValid =
    email.trim() !== "" &&
    username.trim() !== "" &&
    selectedRoles.length > 0 &&
    isPasswordValid &&
    passwordsMatch &&
    dataAccessValid;

  const toggleRole = (roleId: string) => {
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
    setPassword(pwd);
    setConfirmPassword(pwd);
  };

  const copyGeneratedPassword = async () => {
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

  // Data access helper functions
  const getConnectionName = (connectionId: string | null) => {
    if (!connectionId) return 'All Connections';
    const conn = connections.find(c => c.id === connectionId);
    return conn ? conn.name : 'Unknown';
  };

  const openAddDataAccessDialog = () => {
    setEditingRuleIndex(null);
    setDataAccessForm(defaultDataAccessForm);
    setShowDataAccessDialog(true);
  };

  const openEditDataAccessDialog = (index: number) => {
    const rule = dataAccessRules[index];
    setEditingRuleIndex(index);
    setDataAccessForm({
      connectionId: rule.connectionId,
      databasePattern: rule.databasePattern,
      tablePattern: rule.tablePattern,
      isAllowed: rule.isAllowed,
      priority: rule.priority,
      description: rule.description,
    });
    setShowDataAccessDialog(true);
  };

  const handleSaveDataAccessRule = () => {
    const newRule: PendingDataAccessRule = {
      id: editingRuleIndex !== null ? dataAccessRules[editingRuleIndex].id : `temp-${Date.now()}`,
      connectionId: dataAccessForm.connectionId,
      databasePattern: dataAccessForm.databasePattern || '*',
      tablePattern: dataAccessForm.tablePattern || '*',
      isAllowed: dataAccessForm.isAllowed,
      priority: dataAccessForm.priority,
      description: dataAccessForm.description,
    };

    if (editingRuleIndex !== null) {
      const updated = [...dataAccessRules];
      updated[editingRuleIndex] = newRule;
      setDataAccessRules(updated);
    } else {
      setDataAccessRules([...dataAccessRules, newRule]);
    }

    setShowDataAccessDialog(false);
  };

  const handleDeleteDataAccessRule = (index: number) => {
    setDataAccessRules(dataAccessRules.filter((_, i) => i !== index));
  };

  const onSubmit = async () => {
    if (!isFormValid) {
      toast.error("Please fill in all required fields correctly");
      return;
    }

    setIsSubmitting(true);

    try {
      const input: CreateUserInput = {
        email: email.trim(),
        username: username.trim(),
        displayName: displayName.trim() || undefined,
        roleIds: selectedRoles,
        generatePassword,
        password: generatePassword ? undefined : password,
      };

      const result = await rbacUsersApi.create(input);

      // Save data access rules if any
      if (dataAccessRules.length > 0 && result.user?.id) {
        try {
          const rulesToSave = dataAccessRules.map(rule => ({
            connectionId: rule.connectionId,
            databasePattern: rule.databasePattern,
            tablePattern: rule.tablePattern,
            isAllowed: rule.isAllowed,
            priority: rule.priority,
            description: rule.description || undefined,
          }));
          await rbacDataAccessApi.bulkSetForUser(result.user.id, rulesToSave);
        } catch (err) {
          log.error('Failed to save data access rules:', err);
          toast.warning('User created but failed to save data access rules');
        }
      }

      if (result.generatedPassword) {
        setGeneratedPassword(result.generatedPassword);
        toast.success(`User "${username}" created successfully!`);
      } else {
        toast.success(`User "${username}" created successfully!`);
        navigate("/admin");
      }
    } catch (error) {
      log.error("Failed to create user:", error);
      toast.error(`Failed to create user: ${(error as Error).message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show generated password dialog
  if (generatedPassword) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="container mx-auto p-6 max-w-lg"
      >
        <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
          <div className="flex items-center gap-3 border-b border-ink-500 px-5 py-4">
            <span className="grid h-9 w-9 place-items-center rounded-xs border border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
              <Check className="h-4 w-4" aria-hidden />
            </span>
            <div className="flex flex-col gap-0.5">
              <h2 className="text-[16px] font-semibold tracking-tight text-paper">User created successfully</h2>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Credentials ready</p>
            </div>
          </div>
          <div className="space-y-6 px-5 py-5">
            <p className="text-[13px] text-paper-muted">
              User <strong className="text-paper">{username}</strong> has been created with the following credentials.
            </p>

            <div className="space-y-3">
              <div className="rounded-xs border border-ink-500 bg-ink-200 p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Username</div>
                <div className="mt-1 font-medium text-paper">{username}</div>
              </div>

              <div className="rounded-xs border border-ink-500 bg-ink-200 p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Email</div>
                <div className="mt-1 font-medium text-paper">{email}</div>
              </div>

              <div className="rounded-xs border border-amber-900/60 bg-amber-950/40 p-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-300">Generated password</div>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 rounded-xs border border-ink-500 bg-ink-0 p-2 font-mono text-[12px] text-paper break-all">
                    {generatedPassword}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={copyGeneratedPassword}
                    className="h-9 rounded-xs border-ink-500 bg-ink-100 px-3 text-paper hover:border-ink-700 hover:bg-ink-200"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-200">
                  <AlertCircle className="h-3 w-3" />
                  Save this password securely. It won't be shown again.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => navigate("/admin")}
                className="h-9 flex-1 rounded-xs border-ink-500 bg-ink-100 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
              >
                Back to users
              </Button>
              <Button
                onClick={() => {
                  setGeneratedPassword(null);
                  setEmail("");
                  setUsername("");
                  setDisplayName("");
                  setPassword("");
                  setConfirmPassword("");
                }}
                className="h-9 flex-1 gap-2 rounded-xs bg-brand font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Create another
              </Button>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="container mx-auto p-6 space-y-6 max-w-4xl"
    >
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/admin")}
          className="h-9 w-9 rounded-xs text-paper-dim hover:bg-ink-200 hover:text-paper"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
            <UserPlus className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-[18px] font-semibold tracking-tight text-paper">Create new user</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">RBAC user provisioning</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - User Details */}
        <div className="space-y-6">
          {/* Basic Information */}
          <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
            <div className="flex items-center gap-3 border-b border-ink-500 px-5 py-4">
              <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                <span className="h-px w-6 bg-ink-700" aria-hidden />
                <span>User information</span>
              </span>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                  Email <span className="text-red-400">*</span>
                </Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="rounded-xs border-ink-500 bg-ink-200 text-paper"
                />
              </div>

              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                  Username <span className="text-red-400">*</span>
                </Label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                  placeholder="username"
                  className="rounded-xs border-ink-500 bg-ink-200 text-paper"
                />
                <p className="text-[11px] text-paper-faint">
                  Lowercase letters, numbers, underscores, and hyphens only.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Display name</Label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="John Doe"
                  className="rounded-xs border-ink-500 bg-ink-200 text-paper"
                />
              </div>
            </div>
          </div>

          {/* Password Section */}
          <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
            <div className="flex items-center gap-3 border-b border-ink-500 px-5 py-4">
              <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                <span className="h-px w-6 bg-ink-700" aria-hidden />
                <span>Password</span>
              </span>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="flex items-center gap-3 rounded-xs border border-ink-500 bg-ink-200 p-3">
                <Checkbox
                  id="generate-password"
                  checked={generatePassword}
                  onCheckedChange={(checked) => setGeneratePassword(!!checked)}
                  className="border-ink-500"
                />
                <Label htmlFor="generate-password" className="flex cursor-pointer items-center gap-2 text-[12px] text-paper">
                  <Sparkles className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
                  Generate a secure password automatically
                </Label>
              </div>

              {!generatePassword && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Password</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter password"
                          className="rounded-xs border-ink-500 bg-ink-200 pr-10 text-paper"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-paper-dim hover:text-paper"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleGeneratePasswordManually}
                        className="h-9 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
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
                      className="rounded-xs border-ink-500 bg-ink-200 text-paper"
                    />
                    {confirmPassword && !passwordsMatch && (
                      <p className="text-[11px] text-red-300">Passwords do not match.</p>
                    )}
                  </div>

                  {/* Password Requirements */}
                  <div className="rounded-xs border border-ink-500 bg-ink-200 p-3">
                    <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Password requirements</p>
                    <div className="grid grid-cols-2 gap-2">
                      <RequirementItem fulfilled={passwordReqs.length} label="At least 12 characters" />
                      <RequirementItem fulfilled={passwordReqs.upper} label="Uppercase letter" />
                      <RequirementItem fulfilled={passwordReqs.lower} label="Lowercase letter" />
                      <RequirementItem fulfilled={passwordReqs.number} label="Number" />
                      <RequirementItem fulfilled={passwordReqs.special} label="Special character" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column - Role Selection */}
        <div className="space-y-6">
          <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
            <div className="flex items-center gap-3 border-b border-ink-500 px-5 py-4">
              <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                <span className="h-px w-6 bg-ink-700" aria-hidden />
                <span>Assign role <span className="text-red-400">*</span></span>
              </span>
            </div>
            <div className="space-y-4 px-5 py-5">
              {!canAssignRoles && (
                <div className="rounded-xs border border-amber-900/60 bg-amber-950/40 p-3 text-[12px] text-amber-200">
                  You don't have permission to assign roles. The default role will be used.
                </div>
              )}

              {loadingRoles ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-paper-dim" />
                </div>
              ) : (
                <div className="space-y-3">
                  {roles.map((role) => {
                    const code = getRoleCode(role.name);
                    const isSelected = selectedRoles.includes(role.id);

                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => canAssignRoles && toggleRole(role.id)}
                        disabled={!canAssignRoles}
                        className={`w-full rounded-xs border p-4 text-left transition-colors ${isSelected
                          ? "border-brand/60 bg-ink-200"
                          : "border-ink-500 bg-ink-100 hover:border-ink-700"
                          } ${!canAssignRoles ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <div className="flex items-start gap-3">
                          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xs border font-mono text-[12px] font-semibold tracking-tight ${isSelected
                            ? "border-brand/60 bg-brand/10 text-brand"
                            : "border-ink-500 bg-ink-200 text-paper"
                            }`}>
                            {code}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[14px] font-semibold text-paper">
                                {role.displayName}
                              </span>
                              {role.isDefault && (
                                <span className="inline-flex items-center gap-1 rounded-xs border border-brand/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
                                  Default
                                </span>
                              )}
                              {role.isSystem && (
                                <span className="inline-flex items-center gap-1 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                                  System
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-[12px] text-paper-muted">{role.description}</p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {role.permissions.slice(0, 4).map((perm) => (
                                <span
                                  key={perm}
                                  className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted"
                                >
                                  {perm}
                                </span>
                              ))}
                              {role.permissions.length > 4 && (
                                <span className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-paper-faint">
                                  +{role.permissions.length - 4} more
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0">
                            {isSelected ? (
                              <span className="grid h-5 w-5 place-items-center rounded-xs bg-brand text-ink-50">
                                <Check className="h-3 w-3" />
                              </span>
                            ) : (
                              <span className="block h-5 w-5 rounded-xs border border-ink-500 bg-ink-200" />
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedRoles.length === 0 && (
                <p className="flex items-center gap-1.5 text-[12px] text-amber-300">
                  <AlertCircle className="h-3.5 w-3.5" aria-hidden />
                  Please select a role.
                </p>
              )}
            </div>
          </div>

          {/* Data Access Section */}
          {showDataAccessUI && (
            <div className={`overflow-hidden rounded-xs border bg-ink-100 ${requiresDataAccess && dataAccessRules.length === 0 ? "border-red-900/60" : "border-ink-500"}`}>
              <div className="border-b border-ink-500 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setShowDataAccessSection(!showDataAccessSection)}
                  className="flex w-full items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                      <span className="h-px w-6 bg-ink-700" aria-hidden />
                      <span className="flex items-center gap-2">
                        Data access rules
                        {requiresDataAccess && <span className="text-red-400">*</span>}
                      </span>
                    </span>
                    {dataAccessRules.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-xs border border-brand/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
                        {dataAccessRules.length}
                      </span>
                    )}
                    {requiresDataAccess && dataAccessRules.length === 0 && (
                      <span className="inline-flex items-center gap-1 rounded-xs border border-red-300 bg-red-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                        Required
                      </span>
                    )}
                  </div>
                  {showDataAccessSection ? (
                    <ChevronUp className="h-4 w-4 text-paper-dim" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-paper-dim" />
                  )}
                </button>
              </div>
              {showDataAccessSection && (
                <div className="space-y-4 px-5 py-5">
                  {requiresDataAccess && dataAccessRules.length === 0 ? (
                    <div className="rounded-xs border border-red-900/60 bg-red-950/40 p-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" aria-hidden />
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-red-300">Data access rules required</p>
                          <p className="mt-1 text-[12px] text-red-200">
                            Non-admin roles (Developer, Analyst, Viewer) must have at least one data access rule to specify which databases/tables they can access. Guest role has pre-defined rules and doesn't require additional rules.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xs border border-ink-500 bg-ink-200 p-3">
                      <div className="flex items-start gap-2">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-paper-dim" aria-hidden />
                        <div>
                          <p className="text-[12px] text-paper">Configure which databases and tables this user can access.</p>
                          <p className="mt-1 text-[11px] text-paper-faint">
                            Access type (read/write/admin) is determined by the user's role permissions.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {dataAccessRules.length > 0 ? (
                    <div className="space-y-2">
                      {dataAccessRules.map((rule, index) => (
                        <div
                          key={rule.id}
                          className="flex items-center justify-between gap-3 rounded-xs border border-ink-500 bg-ink-200 p-3"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={
                                rule.isAllowed
                                  ? "inline-flex items-center gap-1 rounded-xs border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                                  : "inline-flex items-center gap-1 rounded-xs border border-red-300 bg-red-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                              }>
                                {rule.isAllowed ? "Allow" : "Deny"}
                              </span>
                              <span className="truncate font-mono text-[12px] text-paper">
                                {rule.databasePattern}.{rule.tablePattern}
                              </span>
                            </div>
                            <div className="mt-1 text-[11px] text-paper-faint">
                              {getConnectionName(rule.connectionId)}
                              {rule.description && ` · ${rule.description}`}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDataAccessDialog(index)}
                              className="h-8 rounded-xs font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper"
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 rounded-xs text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                              onClick={() => handleDeleteDataAccessRule(index)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xs border border-ink-500 bg-ink-100 px-6 py-12 text-center">
                      <Database className="mx-auto mb-4 h-8 w-8 text-paper-faint" aria-hidden />
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">No data access rules configured</p>
                      <p className="mt-2 text-[12px] text-paper-muted">User will have access based on role permissions only.</p>
                    </div>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 w-full gap-2 rounded-xs border-ink-500 bg-ink-100 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
                    onClick={openAddDataAccessDialog}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add data access rule
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Summary Card */}
          <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
            <div className="flex items-center gap-3 border-b border-ink-500 px-5 py-4">
              <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
                <span className="h-px w-6 bg-ink-700" aria-hidden />
                <span>Summary</span>
              </span>
            </div>
            <div className="space-y-2 px-5 py-4 text-[12px]">
              <div className="flex justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Email</span>
                <span className="text-paper">{email || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Username</span>
                <span className="text-paper">{username || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Password</span>
                <span className="text-paper">{generatePassword ? "Auto-generated" : "Custom"}</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Roles</span>
                <div className="flex flex-wrap justify-end gap-1">
                  {selectedRoles.length > 0
                    ? selectedRoles.map((roleId) => {
                      const role = roles.find((r) => r.id === roleId);
                      return (
                        <span
                          key={roleId}
                          className="inline-flex items-center gap-1 rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted"
                        >
                          {role?.displayName || roleId}
                        </span>
                      );
                    })
                    : <span className="text-paper">—</span>}
                </div>
              </div>
              <div className="flex justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Data access rules</span>
                <span>
                  {dataAccessRules.length > 0 ? (
                    <span className="text-paper">{dataAccessRules.length} rule(s)</span>
                  ) : requiresDataAccess ? (
                    <span className="inline-flex items-center gap-1 text-red-300">
                      <AlertCircle className="h-3 w-3" aria-hidden /> Required
                    </span>
                  ) : (
                    <span className="text-paper-muted">None (admin bypass)</span>
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Submit buttons */}
      <div className="flex flex-col gap-3 pt-6 border-t border-ink-500">
        {requiresDataAccess && dataAccessRules.length === 0 && (
          <div className="flex items-center justify-end gap-2 text-[12px] text-red-300">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden />
            Data access rules are required for non-admin roles.
          </div>
        )}
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate("/admin")}
            className="h-9 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
          >
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isSubmitting || !isFormValid}
            className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Creating user…
              </>
            ) : (
              <>
                <UserPlus className="h-3.5 w-3.5" />
                Create user
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Data Access Rule Dialog */}
      <Dialog open={showDataAccessDialog} onOpenChange={setShowDataAccessDialog}>
        <DialogContent className="rounded-xs border-ink-500 bg-ink-100">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-paper">
              <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                <Database className="h-4 w-4" aria-hidden />
              </span>
              <span className="flex flex-col gap-0.5 text-left">
                <span className="text-[16px] font-semibold tracking-tight">
                  {editingRuleIndex !== null ? 'Edit' : 'Add'} data access rule
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                  {editingRuleIndex !== null ? 'Update rule' : 'New access rule'}
                </span>
              </span>
            </DialogTitle>
            <DialogDescription className="text-paper-muted">
              Configure access to specific databases and tables.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Connection Selection */}
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Connection</Label>
              <Select
                value={dataAccessForm.connectionId || 'all'}
                onValueChange={(value) =>
                  setDataAccessForm({ ...dataAccessForm, connectionId: value === 'all' ? null : value })
                }
              >
                <SelectTrigger className="rounded-xs border-ink-500 bg-ink-200 text-paper">
                  <SelectValue placeholder="Select connection" />
                </SelectTrigger>
                <SelectContent className="rounded-xs border-ink-500 bg-ink-100">
                  <SelectItem value="all">All Connections</SelectItem>
                  {connections.map((conn) => (
                    <SelectItem key={conn.id} value={conn.id}>
                      {conn.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-paper-faint">
                Apply rule to a specific connection or all connections.
              </p>
            </div>

            {/* Database Pattern */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                <Database className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
                Database pattern
              </Label>
              <Input
                value={dataAccessForm.databasePattern}
                onChange={(e) =>
                  setDataAccessForm({ ...dataAccessForm, databasePattern: e.target.value })
                }
                placeholder="* (all databases) or specific_db"
                className="rounded-xs border-ink-500 bg-ink-200 font-mono text-paper"
              />
              <p className="text-[11px] text-paper-faint">
                Use * for all databases, or specify a name/pattern.
              </p>
            </div>

            {/* Table Pattern */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                <Table2 className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
                Table pattern
              </Label>
              <Input
                value={dataAccessForm.tablePattern}
                onChange={(e) =>
                  setDataAccessForm({ ...dataAccessForm, tablePattern: e.target.value })
                }
                placeholder="* (all tables) or specific_table"
                className="rounded-xs border-ink-500 bg-ink-200 font-mono text-paper"
              />
              <p className="text-[11px] text-paper-faint">
                Use * for all tables, or specify a name/pattern.
              </p>
            </div>

            {/* Allow/Deny Toggle */}
            <TooltipProvider>
              <div className="flex items-center justify-between rounded-xs border border-ink-500 bg-ink-200 p-3">
                <div className="flex items-center gap-2">
                  <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Access permission</Label>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3.5 w-3.5 text-paper-dim" />
                    </TooltipTrigger>
                    <TooltipContent className="rounded-xs border border-ink-500 bg-ink-200 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
                      <p className="max-w-xs normal-case">
                        Allow grants access, Deny blocks access even if other rules allow it
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[12px] ${!dataAccessForm.isAllowed ? 'text-red-300' : 'text-paper-faint'}`}>
                    Deny
                  </span>
                  <Switch
                    checked={dataAccessForm.isAllowed}
                    onCheckedChange={(checked) =>
                      setDataAccessForm({ ...dataAccessForm, isAllowed: checked })
                    }
                  />
                  <span className={`text-[12px] ${dataAccessForm.isAllowed ? 'text-emerald-300' : 'text-paper-faint'}`}>
                    Allow
                  </span>
                </div>
              </div>
            </TooltipProvider>

            {/* Priority */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">
                Priority
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3.5 w-3.5 text-paper-dim" />
                    </TooltipTrigger>
                    <TooltipContent className="rounded-xs border border-ink-500 bg-ink-200 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
                      <p className="max-w-xs normal-case">
                        Higher priority rules are evaluated first. Use this to override more general rules.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </Label>
              <Input
                type="number"
                value={dataAccessForm.priority}
                onChange={(e) =>
                  setDataAccessForm({ ...dataAccessForm, priority: parseInt(e.target.value) || 0 })
                }
                className="rounded-xs border-ink-500 bg-ink-200 text-paper"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim">Description (optional)</Label>
              <Input
                value={dataAccessForm.description}
                onChange={(e) =>
                  setDataAccessForm({ ...dataAccessForm, description: e.target.value })
                }
                placeholder="e.g., Production read access"
                className="rounded-xs border-ink-500 bg-ink-200 text-paper"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowDataAccessDialog(false)}
              className="h-9 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper hover:border-ink-700 hover:bg-ink-200"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveDataAccessRule}
              className="h-9 gap-2 rounded-xs bg-brand px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
            >
              {editingRuleIndex !== null ? 'Update' : 'Add'} rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

export default CreateUser;
