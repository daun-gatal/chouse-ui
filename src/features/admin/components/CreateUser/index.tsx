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
  Shield,
  Key,
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
import { Badge } from "@/components/ui/badge";
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
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle } from "@/components/ui/glass-card";
import { rbacUsersApi, rbacRolesApi, rbacConnectionsApi, rbacDataAccessApi, type RbacRole, type CreateUserInput, type ClickHouseConnection } from "@/api/rbac";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";

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
  guest: {
    icon: "👋",
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/20",
    borderColor: "border-cyan-500/50",
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
        <GlassCard>
          <GlassCardHeader>
            <GlassCardTitle className="flex items-center gap-2 text-green-400">
              <Check className="h-5 w-5" />
              User Created Successfully
            </GlassCardTitle>
          </GlassCardHeader>
          <GlassCardContent className="space-y-6">
            <p className="text-gray-300">
              User <strong className="text-white">{username}</strong> has been created with the
              following credentials:
            </p>

            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="text-xs text-gray-400 mb-1">Username</div>
                <div className="text-white font-medium">{username}</div>
              </div>

              <div className="p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="text-xs text-gray-400 mb-1">Email</div>
                <div className="text-white font-medium">{email}</div>
              </div>

              <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <div className="text-xs text-yellow-400 mb-1">Generated Password</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-2 rounded bg-black/30 text-white font-mono text-sm break-all">
                    {generatedPassword}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={copyGeneratedPassword}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-yellow-400/80 mt-2 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Save this password securely. It won't be shown again.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => navigate("/admin")} className="flex-1">
                Back to Users
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
                className="flex-1"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Create Another
              </Button>
            </div>
          </GlassCardContent>
        </GlassCard>
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
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-3">
          <UserPlus className="h-6 w-6 text-green-400" />
          <h1 className="text-2xl font-bold text-white">Create New User</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - User Details */}
        <div className="space-y-6">
          {/* Basic Information */}
          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-blue-400" />
                User Information
              </GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-white">
                  Email <span className="text-red-400">*</span>
                </Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="bg-white/5 border-white/10"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-white">
                  Username <span className="text-red-400">*</span>
                </Label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                  placeholder="username"
                  className="bg-white/5 border-white/10"
                />
                <p className="text-xs text-gray-500">
                  Lowercase letters, numbers, underscores, and hyphens only
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-white">Display Name</Label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="John Doe"
                  className="bg-white/5 border-white/10"
                />
              </div>
            </GlassCardContent>
          </GlassCard>

          {/* Password Section */}
          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-yellow-400" />
                Password
              </GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                <Checkbox
                  id="generate-password"
                  checked={generatePassword}
                  onCheckedChange={(checked) => setGeneratePassword(!!checked)}
                />
                <Label htmlFor="generate-password" className="text-white cursor-pointer flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-yellow-400" />
                  Generate a secure password automatically
                </Label>
              </div>

              {!generatePassword && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-white">Password</Label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Enter password"
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

                  {/* Password Requirements */}
                  <div className="p-4 rounded-lg bg-white/5 border border-white/10">
                    <p className="text-xs text-gray-400 mb-3">Password Requirements:</p>
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
            </GlassCardContent>
          </GlassCard>
        </div>

        {/* Right Column - Role Selection */}
        <div className="space-y-6">
          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-purple-400" />
                Assign Roles <span className="text-red-400">*</span>
              </GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent className="space-y-4">
              {!canAssignRoles && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-400">
                  You don't have permission to assign roles. The default role will be used.
                </div>
              )}

              {loadingRoles ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
                </div>
              ) : (
                <div className="space-y-3">
                  {roles.map((role) => {
                    const colors = ROLE_COLORS[role.name] || {
                      icon: "🔐",
                      color: "text-gray-400",
                      bgColor: "bg-gray-500/20",
                      borderColor: "border-gray-500/50",
                    };
                    const isSelected = selectedRoles.includes(role.id);

                    return (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => canAssignRoles && toggleRole(role.id)}
                        disabled={!canAssignRoles}
                        className={`w-full p-4 rounded-lg border-2 transition-all text-left ${isSelected
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
                              {role.isSystem && (
                                <span className="px-2 py-0.5 rounded text-xs bg-gray-500/20 text-gray-400 border border-gray-500/30">
                                  System
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 mt-1">{role.description}</p>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {role.permissions.slice(0, 4).map((perm) => (
                                <span
                                  key={perm}
                                  className="px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-gray-300"
                                >
                                  {perm}
                                </span>
                              ))}
                              {role.permissions.length > 4 && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-gray-400">
                                  +{role.permissions.length - 4} more
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0">
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isSelected
                                ? 'border-cyan-400 bg-cyan-400'
                                : 'border-gray-500 bg-transparent'
                              }`}>
                              {isSelected && (
                                <div className="w-2.5 h-2.5 rounded-full bg-white" />
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedRoles.length === 0 && (
                <p className="text-sm text-amber-400">⚠️ Please select a role</p>
              )}
            </GlassCardContent>
          </GlassCard>

          {/* Data Access Section */}
          {showDataAccessUI && (
            <GlassCard className={requiresDataAccess && dataAccessRules.length === 0 ? "border-red-500/50" : ""}>
              <GlassCardHeader>
                <button
                  type="button"
                  onClick={() => setShowDataAccessSection(!showDataAccessSection)}
                  className="flex items-center justify-between w-full"
                >
                  <GlassCardTitle className="flex items-center gap-2">
                    <Database className={`h-5 w-5 ${requiresDataAccess && dataAccessRules.length === 0 ? "text-red-400" : "text-cyan-400"}`} />
                    Data Access Rules
                    {requiresDataAccess && (
                      <span className="text-red-400 text-xs">*</span>
                    )}
                    {dataAccessRules.length > 0 && (
                      <Badge variant="secondary" className="ml-2">
                        {dataAccessRules.length}
                      </Badge>
                    )}
                    {requiresDataAccess && dataAccessRules.length === 0 && (
                      <Badge variant="destructive" className="ml-2 text-xs">
                        Required
                      </Badge>
                    )}
                  </GlassCardTitle>
                  {showDataAccessSection ? (
                    <ChevronUp className="h-5 w-5 text-gray-400" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-gray-400" />
                  )}
                </button>
              </GlassCardHeader>
              {showDataAccessSection && (
                <GlassCardContent className="space-y-4">
                  {requiresDataAccess && dataAccessRules.length === 0 ? (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-300 flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-medium">Data access rules required</p>
                        <p className="text-xs text-red-400/80 mt-1">
                          Non-admin roles (Developer, Analyst, Viewer) must have at least one data access rule to specify which databases/tables they can access. Guest role has pre-defined rules and doesn't require additional rules.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-sm text-cyan-300 flex items-start gap-2">
                      <Info className="h-4 w-4 mt-0.5 shrink-0" />
                      <div>
                        <p>Configure which databases and tables this user can access.</p>
                        <p className="text-xs text-cyan-400/80 mt-1">
                          Access type (read/write/admin) is determined by the user's role permissions.
                        </p>
                      </div>
                    </div>
                  )}

                  {dataAccessRules.length > 0 ? (
                    <div className="space-y-2">
                      {dataAccessRules.map((rule, index) => (
                        <div
                          key={rule.id}
                          className="p-3 rounded-lg bg-white/5 border border-white/10 flex items-center justify-between gap-3"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant={rule.isAllowed ? "default" : "destructive"} className="text-xs">
                                {rule.isAllowed ? "Allow" : "Deny"}
                              </Badge>
                              <span className="text-sm text-white font-mono truncate">
                                {rule.databasePattern}.{rule.tablePattern}
                              </span>
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              {getConnectionName(rule.connectionId)}
                              {rule.description && ` • ${rule.description}`}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDataAccessDialog(index)}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-red-400 hover:text-red-300"
                              onClick={() => handleDeleteDataAccessRule(index)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-gray-400">
                      <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No data access rules configured</p>
                      <p className="text-xs text-gray-500 mt-1">User will have access based on role permissions only</p>
                    </div>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={openAddDataAccessDialog}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Data Access Rule
                  </Button>
                </GlassCardContent>
              )}
            </GlassCard>
          )}

          {/* Summary Card */}
          <GlassCard>
            <GlassCardContent className="py-4">
              <h3 className="text-sm font-medium text-gray-400 mb-3">Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Email</span>
                  <span className="text-white">{email || "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Username</span>
                  <span className="text-white">{username || "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Password</span>
                  <span className="text-white">{generatePassword ? "Auto-generated" : "Custom"}</span>
                </div>
                <div className="flex justify-between items-start">
                  <span className="text-gray-400">Roles</span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {selectedRoles.length > 0
                      ? selectedRoles.map((roleId) => {
                        const role = roles.find((r) => r.id === roleId);
                        return (
                          <span
                            key={roleId}
                            className="px-2 py-0.5 rounded text-xs bg-purple-500/20 text-purple-300"
                          >
                            {role?.displayName || roleId}
                          </span>
                        );
                      })
                      : "-"}
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Data Access Rules</span>
                  <span className="text-white">
                    {dataAccessRules.length > 0 ? (
                      <span className="text-cyan-400">{dataAccessRules.length} rule(s)</span>
                    ) : requiresDataAccess ? (
                      <span className="text-red-400">⚠️ Required</span>
                    ) : (
                      "None (admin bypass)"
                    )}
                  </span>
                </div>
              </div>
            </GlassCardContent>
          </GlassCard>
        </div>
      </div>

      {/* Submit buttons */}
      <div className="flex flex-col gap-3 pt-6 border-t border-white/10">
        {requiresDataAccess && dataAccessRules.length === 0 && (
          <div className="flex items-center justify-end gap-2 text-red-400 text-sm">
            <AlertCircle className="h-4 w-4" />
            Data access rules are required for non-admin roles
          </div>
        )}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => navigate("/admin")}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={onSubmit}
            disabled={isSubmitting || !isFormValid}
            className="gap-2 bg-white/5 border-white/10 hover:bg-white/10 transition-all"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating User...
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                Create User
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Data Access Rule Dialog */}
      <Dialog open={showDataAccessDialog} onOpenChange={setShowDataAccessDialog}>
        <DialogContent className="bg-gray-900 border border-white/10">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-cyan-400" />
              {editingRuleIndex !== null ? 'Edit' : 'Add'} Data Access Rule
            </DialogTitle>
            <DialogDescription>
              Configure access to specific databases and tables.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Connection Selection */}
            <div className="space-y-2">
              <Label>Connection</Label>
              <Select
                value={dataAccessForm.connectionId || 'all'}
                onValueChange={(value) =>
                  setDataAccessForm({ ...dataAccessForm, connectionId: value === 'all' ? null : value })
                }
              >
                <SelectTrigger className="bg-white/5 border-white/10">
                  <SelectValue placeholder="Select connection" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Connections</SelectItem>
                  {connections.map((conn) => (
                    <SelectItem key={conn.id} value={conn.id}>
                      {conn.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Apply rule to a specific connection or all connections
              </p>
            </div>

            {/* Database Pattern */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Database className="h-4 w-4 text-blue-400" />
                Database Pattern
              </Label>
              <Input
                value={dataAccessForm.databasePattern}
                onChange={(e) =>
                  setDataAccessForm({ ...dataAccessForm, databasePattern: e.target.value })
                }
                placeholder="* (all databases) or specific_db"
                className="bg-white/5 border-white/10 font-mono"
              />
              <p className="text-xs text-gray-500">
                Use * for all databases, or specify a name/pattern
              </p>
            </div>

            {/* Table Pattern */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Table2 className="h-4 w-4 text-green-400" />
                Table Pattern
              </Label>
              <Input
                value={dataAccessForm.tablePattern}
                onChange={(e) =>
                  setDataAccessForm({ ...dataAccessForm, tablePattern: e.target.value })
                }
                placeholder="* (all tables) or specific_table"
                className="bg-white/5 border-white/10 font-mono"
              />
              <p className="text-xs text-gray-500">
                Use * for all tables, or specify a name/pattern
              </p>
            </div>

            {/* Allow/Deny Toggle */}
            <TooltipProvider>
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-2">
                  <Label>Access Permission</Label>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-gray-400" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        Allow grants access, Deny blocks access even if other rules allow it
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${!dataAccessForm.isAllowed ? 'text-red-400' : 'text-gray-500'}`}>
                    Deny
                  </span>
                  <Switch
                    checked={dataAccessForm.isAllowed}
                    onCheckedChange={(checked) =>
                      setDataAccessForm({ ...dataAccessForm, isAllowed: checked })
                    }
                  />
                  <span className={`text-sm ${dataAccessForm.isAllowed ? 'text-green-400' : 'text-gray-500'}`}>
                    Allow
                  </span>
                </div>
              </div>
            </TooltipProvider>

            {/* Priority */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                Priority
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-4 w-4 text-gray-400" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
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
                className="bg-white/5 border-white/10"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label>Description (Optional)</Label>
              <Input
                value={dataAccessForm.description}
                onChange={(e) =>
                  setDataAccessForm({ ...dataAccessForm, description: e.target.value })
                }
                placeholder="e.g., Production read access"
                className="bg-white/5 border-white/10"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDataAccessDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={handleSaveDataAccessRule}
              className="gap-2 bg-white/5 border-white/10 hover:bg-white/10 transition-all"
            >
              {editingRuleIndex !== null ? 'Update' : 'Add'} Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

export default CreateUser;
