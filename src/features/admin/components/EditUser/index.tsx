import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UserCog, ArrowLeft, Loader2, Shield, Key, Trash2, AlertTriangle, Server, Database, X, FileText, Check, Globe } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle } from "@/components/ui/glass-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useExecuteQuery, useUserDetails, useClusterNames, useDatabases } from "@/hooks";

// Predefined role templates (same as CreateUser)
const ROLE_TEMPLATES = {
  admin: {
    name: "Admin",
    description: "Full access to all databases and system operations",
    icon: "🛡️",
    color: "text-red-400",
    bgColor: "bg-red-500/20",
    borderColor: "border-red-500/50",
  },
  developer: {
    name: "Developer",
    description: "Read/write access with DDL capabilities",
    icon: "👨‍💻",
    color: "text-blue-400",
    bgColor: "bg-blue-500/20",
    borderColor: "border-blue-500/50",
  },
  readWrite: {
    name: "Read-Write",
    description: "Read and write data, no schema changes",
    icon: "📝",
    color: "text-green-400",
    bgColor: "bg-green-500/20",
    borderColor: "border-green-500/50",
  },
  readOnly: {
    name: "Read Only",
    description: "Query data only, no modifications",
    icon: "👁️",
    color: "text-purple-400",
    bgColor: "bg-purple-500/20",
    borderColor: "border-purple-500/50",
  },
};

type RoleTemplate = keyof typeof ROLE_TEMPLATES;
type HostRestrictionType = "any" | "ip" | "name" | "local";

// Password requirement indicator component
const RequirementItem = ({ fulfilled, label }: { fulfilled: boolean; label: string }) => (
  <div className={`flex items-center gap-2 text-xs transition-colors duration-200 ${fulfilled ? 'text-green-400' : 'text-gray-500'}`}>
    <div className={`w-4 h-4 rounded-full flex items-center justify-center border ${fulfilled ? 'bg-green-500/10 border-green-500/50' : 'border-gray-700 bg-gray-800'}`}>
      {fulfilled ? <Check className="w-2.5 h-2.5" /> : <div className="w-1 h-1 rounded-full bg-gray-600" />}
    </div>
    <span>{label}</span>
  </div>
);

const EditUser: React.FC = () => {
  const navigate = useNavigate();
  const { username } = useParams<{ username: string }>();
  const executeQuery = useExecuteQuery();
  const { data: userDetails, isLoading: loadingDetails, refetch } = useUserDetails(username || "");
  const { data: clusters = [] } = useClusterNames();
  const { data: databasesData = [] } = useDatabases();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentGrants, setCurrentGrants] = useState<string[]>([]);
  const [useCluster, setUseCluster] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState("");
  const [selectedDatabases, setSelectedDatabases] = useState<string[]>([]);
  const [isApplyingRole, setIsApplyingRole] = useState(false);
  const [allowQueryLogs, setAllowQueryLogs] = useState(true); // Allow viewing own query logs
  const [hostRestriction, setHostRestriction] = useState<HostRestrictionType>("any");
  const [allowedHosts, setAllowedHosts] = useState<string[]>([]);
  const [newHost, setNewHost] = useState("");
  const [isUpdatingHost, setIsUpdatingHost] = useState(false);

  const databases = databasesData.map((db) => db.name);

  // Initialize host restriction from user details
  useEffect(() => {
    if (userDetails) {
      const hostIp = String(userDetails.host_ip || "");
      const hostNames = String(userDetails.host_names || "");
      
      if (hostIp === "localhost" || hostIp === "127.0.0.1" || hostIp === "::1") {
        setHostRestriction("local");
      } else if (hostIp && hostIp !== "::/0" && hostIp !== "::") {
        setHostRestriction("ip");
        setAllowedHosts(hostIp.split(",").map((h) => h.trim()).filter(Boolean));
      } else if (hostNames) {
        setHostRestriction("name");
        setAllowedHosts(hostNames.split(",").map((h) => h.trim()).filter(Boolean));
      } else {
        setHostRestriction("any");
      }
    }
  }, [userDetails]);

  // Fetch current grants for the user
  useEffect(() => {
    if (username) {
      executeQuery.mutateAsync({
        query: `SELECT access_type FROM system.grants WHERE user_name = '${username}'`,
      }).then((result) => {
        const grants = (result.data as { access_type: string }[]).map(g => g.access_type);
        setCurrentGrants(grants);
      }).catch(() => {
        // Ignore errors
      });
    }
  }, [username]);

  // Build cluster clause helper
  const getClusterClause = () => useCluster && selectedCluster ? ` ON CLUSTER '${selectedCluster}'` : "";

  // Host management functions
  const addHost = () => {
    if (newHost.trim() && !allowedHosts.includes(newHost.trim())) {
      setAllowedHosts([...allowedHosts, newHost.trim()]);
      setNewHost("");
    }
  };

  const removeHost = (host: string) => {
    setAllowedHosts(allowedHosts.filter((h) => h !== host));
  };

  const handleUpdateHost = async () => {
    setIsUpdatingHost(true);

    try {
      const clusterClause = getClusterClause();
      
      // Build host restriction clause
      let hostClause = "";
      if (hostRestriction === "local") {
        hostClause = "HOST LOCAL";
      } else if (hostRestriction === "ip" && allowedHosts.length > 0) {
        hostClause = `HOST IP ${allowedHosts.map((ip) => `'${ip}'`).join(", ")}`;
      } else if (hostRestriction === "name" && allowedHosts.length > 0) {
        hostClause = `HOST NAME ${allowedHosts.map((name) => `'${name}'`).join(", ")}`;
      } else {
        hostClause = "HOST ANY";
      }

      await executeQuery.mutateAsync({
        query: `ALTER USER '${username}'${clusterClause} ${hostClause}`,
      });

      const clusterMsg = clusterClause ? ` on cluster ${selectedCluster}` : "";
      toast.success(`Host restriction updated successfully${clusterMsg}`);
      refetch();
    } catch (error) {
      console.error("Failed to update host restriction:", error);
      toast.error(`Failed to update host restriction: ${(error as Error).message}`);
    } finally {
      setIsUpdatingHost(false);
    }
  };

  // Password validation requirements (same as CreateUser)
  const passwordReqs = {
    length: newPassword.length >= 12,
    upper: /[A-Z]/.test(newPassword),
    lower: /[a-z]/.test(newPassword),
    number: /\d/.test(newPassword),
    special: /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(newPassword),
  };

  const isPasswordValid = Object.values(passwordReqs).every(Boolean);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassword.trim()) {
      toast.error("Please enter a new password");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (!isPasswordValid) {
      toast.error("Password does not meet all requirements");
      return;
    }

    setIsUpdatingPassword(true);

    try {
      const escapedPassword = newPassword.replace(/'/g, "\\'");
      const clusterClause = getClusterClause();
      await executeQuery.mutateAsync({
        query: `ALTER USER '${username}'${clusterClause} IDENTIFIED BY '${escapedPassword}'`,
      });
      const clusterMsg = clusterClause ? ` on cluster ${selectedCluster}` : "";
      toast.success(`Password updated successfully${clusterMsg}`);
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      console.error("Failed to update password:", error);
      toast.error(`Failed to update password: ${(error as Error).message}`);
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  // Generate secure password (same as CreateUser)
  const generatePassword = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let password = "";
    password += "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 26)];
    password += "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)];
    password += "0123456789"[Math.floor(Math.random() * 10)];
    password += "!@#$%^&*"[Math.floor(Math.random() * 8)];
    for (let i = 0; i < 12; i++) {
      password += chars[Math.floor(Math.random() * chars.length)];
    }
    password = password.split("").sort(() => Math.random() - 0.5).join("");
    setNewPassword(password);
    setConfirmPassword(password);
  };

  const handleDeleteUser = async () => {
    setIsDeleting(true);

    try {
      const clusterClause = getClusterClause();
      await executeQuery.mutateAsync({
        query: `DROP USER IF EXISTS '${username}'${clusterClause}`,
      });
      const clusterMsg = clusterClause ? ` on cluster ${selectedCluster}` : "";
      toast.success(`User "${username}" deleted successfully${clusterMsg}`);
      navigate("/admin");
    } catch (error) {
      console.error("Failed to delete user:", error);
      toast.error(`Failed to delete user: ${(error as Error).message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleApplyRole = async (role: RoleTemplate) => {
    // For non-admin roles, require database selection
    if (role !== "admin" && selectedDatabases.length === 0) {
      toast.error("Please select at least one database for non-admin roles");
      return;
    }

    setIsApplyingRole(true);

    try {
      const clusterClause = getClusterClause();
      
      // First revoke all existing grants
      await executeQuery.mutateAsync({
        query: `REVOKE${clusterClause} ALL ON *.* FROM '${username}'`,
      });

      // Then apply new grants based on role
      if (role === "admin") {
        // Admin gets full access
        await executeQuery.mutateAsync({
          query: `GRANT${clusterClause} ALL ON *.* TO '${username}' WITH GRANT OPTION`,
        });
      } else {
        // Other roles get access only to selected databases
        for (const db of selectedDatabases) {
          const dbTarget = `\`${db}\`.*`;
          
          switch (role) {
            case "developer":
              await executeQuery.mutateAsync({
                query: `GRANT${clusterClause} SELECT, INSERT, CREATE TABLE, DROP TABLE, ALTER TABLE ON ${dbTarget} TO '${username}'`,
              });
              break;
            case "readWrite":
              await executeQuery.mutateAsync({
                query: `GRANT${clusterClause} SELECT, INSERT ON ${dbTarget} TO '${username}'`,
              });
              break;
            case "readOnly":
              await executeQuery.mutateAsync({
                query: `GRANT${clusterClause} SELECT ON ${dbTarget} TO '${username}'`,
              });
              break;
          }
        }

        // Grant access to view own query logs (system.query_log)
        if (allowQueryLogs) {
          await executeQuery.mutateAsync({
            query: `GRANT${clusterClause} SELECT ON system.query_log TO '${username}'`,
          });
        }
      }

      const clusterMsg = clusterClause ? ` on cluster ${selectedCluster}` : "";
      const dbMsg = role !== "admin" ? ` for ${selectedDatabases.length} database(s)` : "";
      toast.success(`Applied ${ROLE_TEMPLATES[role].name} role to ${username}${dbMsg}${clusterMsg}`);
      
      // Refresh grants
      const result = await executeQuery.mutateAsync({
        query: `SELECT access_type FROM system.grants WHERE user_name = '${username}'`,
      });
      const grants = (result.data as { access_type: string }[]).map(g => g.access_type);
      setCurrentGrants(grants);
    } catch (error) {
      console.error("Failed to apply role:", error);
      toast.error(`Failed to apply role: ${(error as Error).message}`);
    } finally {
      setIsApplyingRole(false);
    }
  };

  if (loadingDetails) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
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
              <p className="text-gray-400 text-sm">{username}</p>
            </div>
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="gap-2">
              <Trash2 className="h-4 w-4" />
              Delete User
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                Delete User
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete user <strong>{username}</strong>? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
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
                  "Delete"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="p-3 rounded-lg bg-white/5">
              <div className="text-xs text-gray-400 mb-1">Username</div>
              <div className="text-white font-medium">{username}</div>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <div className="text-xs text-gray-400 mb-1">Host Restriction</div>
              <div className="text-white font-medium">{userDetails?.host_ip || userDetails?.host_names || "Any"}</div>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <div className="text-xs text-gray-400 mb-1">Current Grants</div>
              <div className="text-white font-medium">{currentGrants.length} permissions</div>
            </div>
          </div>

          {/* Current permissions */}
          <div className="mt-4">
            <div className="text-sm text-gray-400 mb-2">Current Permissions:</div>
            <div className="flex flex-wrap gap-2">
              {currentGrants.length === 0 ? (
                <span className="text-gray-500 text-sm italic">No permissions granted</span>
              ) : (
                currentGrants.slice(0, 10).map((grant, i) => (
                  <span
                    key={i}
                    className="px-2 py-1 rounded text-xs bg-white/10 text-gray-300 border border-white/10"
                  >
                    {grant}
                  </span>
                ))
              )}
              {currentGrants.length > 10 && (
                <span className="px-2 py-1 rounded text-xs bg-white/10 text-gray-400">
                  +{currentGrants.length - 10} more
                </span>
              )}
            </div>
          </div>
        </GlassCardContent>
      </GlassCard>

      {/* Cluster Option */}
      {clusters.length > 0 && (
        <GlassCard>
          <GlassCardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/20">
                  <Server className="h-5 w-5 text-orange-400" />
                </div>
                <div>
                  <Label className="text-white font-medium">Apply Changes on Cluster</Label>
                  <p className="text-xs text-gray-400">Sync changes across all cluster nodes</p>
                </div>
              </div>
              <Switch checked={useCluster} onCheckedChange={setUseCluster} />
            </div>
            <AnimatePresence>
              {useCluster && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4"
                >
                  <Select value={selectedCluster} onValueChange={setSelectedCluster}>
                    <SelectTrigger className="bg-white/5 border-white/10">
                      <SelectValue placeholder="Select cluster" />
                    </SelectTrigger>
                    <SelectContent>
                      {clusters.map((cluster) => (
                        <SelectItem key={cluster} value={cluster}>
                          {cluster}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </motion.div>
              )}
            </AnimatePresence>
          </GlassCardContent>
        </GlassCard>
      )}

      {/* Tabs */}
      <Tabs defaultValue="role" className="space-y-4">
        <TabsList className="bg-white/5 border border-white/10 p-1">
          <TabsTrigger value="role" className="data-[state=active]:bg-purple-500/20">
            <Shield className="h-4 w-4 mr-2" />
            Change Role
          </TabsTrigger>
          <TabsTrigger value="host" className="data-[state=active]:bg-orange-500/20">
            <Globe className="h-4 w-4 mr-2" />
            Host Restriction
          </TabsTrigger>
          <TabsTrigger value="password" className="data-[state=active]:bg-blue-500/20">
            <Key className="h-4 w-4 mr-2" />
            Change Password
          </TabsTrigger>
        </TabsList>

        <TabsContent value="role">
          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-purple-400" />
                Apply Role Template
              </GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent className="space-y-6">
              {/* Database Selection */}
              <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <div className="flex items-center gap-2 mb-3">
                  <Database className="h-4 w-4 text-blue-400" />
                  <Label className="text-white font-medium">Database Access (Required for non-Admin roles)</Label>
                </div>
                <p className="text-xs text-gray-400 mb-3">
                  Select which databases this user can access. Admin role gets access to all databases.
                </p>
                <Select
                  onValueChange={(value: string) => {
                    if (!selectedDatabases.includes(value)) {
                      setSelectedDatabases([...selectedDatabases, value]);
                    }
                  }}
                >
                  <SelectTrigger className="bg-white/5 border-white/10">
                    <SelectValue placeholder="Add database..." />
                  </SelectTrigger>
                  <SelectContent>
                    {databases.map((db) => (
                      <SelectItem key={db} value={db} disabled={selectedDatabases.includes(db)}>
                        {db}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap gap-2 mt-3">
                  {selectedDatabases.length === 0 ? (
                    <p className="text-sm text-amber-400 italic">
                      ⚠️ No databases selected. Select databases before applying a non-admin role.
                    </p>
                  ) : (
                    selectedDatabases.map((db) => (
                      <Badge
                        key={db}
                        variant="secondary"
                        className="bg-blue-500/20 text-blue-200 hover:bg-red-500/20 hover:text-red-200 cursor-pointer border border-blue-500/30"
                        onClick={() => setSelectedDatabases(selectedDatabases.filter((d) => d !== db))}
                      >
                        {db}
                        <X className="ml-1 h-3 w-3" />
                      </Badge>
                    ))
                  )}
                </div>
              </div>

              {/* Query Logs Access Toggle */}
              <div className="p-4 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-cyan-500/20">
                      <FileText className="h-4 w-4 text-cyan-400" />
                    </div>
                    <div>
                      <Label className="text-white font-medium">Query Logs Access</Label>
                      <p className="text-xs text-gray-400">
                        Allow user to view their own query history in the Logs tab
                      </p>
                    </div>
                  </div>
                  <Switch checked={allowQueryLogs} onCheckedChange={setAllowQueryLogs} />
                </div>
                <p className="text-xs text-gray-500 mt-3 pl-11">
                  Grants SELECT on <code className="text-cyan-400">system.query_log</code> - users can only see queries they executed
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-400 mb-4">
                  Select a role template to apply. This will revoke existing permissions and apply new ones.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {(Object.entries(ROLE_TEMPLATES) as [RoleTemplate, typeof ROLE_TEMPLATES.admin][]).map(
                    ([key, role]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleApplyRole(key)}
                        disabled={isApplyingRole}
                        className={`p-4 rounded-lg border-2 transition-all text-left hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed ${role.bgColor} ${role.borderColor}`}
                      >
                        <div className="text-2xl mb-2">{role.icon}</div>
                        <div className={`font-semibold ${role.color}`}>{role.name}</div>
                        <div className="text-xs text-gray-400 mt-1">{role.description}</div>
                        {key !== "admin" && selectedDatabases.length > 0 && (
                          <div className="text-[10px] text-gray-500 mt-2">
                            → {selectedDatabases.length} database(s)
                          </div>
                        )}
                        {key === "admin" && (
                          <div className="text-[10px] text-gray-500 mt-2">
                            → All databases
                          </div>
                        )}
                      </button>
                    )
                  )}
                </div>
              </div>
            </GlassCardContent>
          </GlassCard>
        </TabsContent>

        <TabsContent value="host">
          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-orange-400" />
                Host Restriction
              </GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent className="space-y-6">
              <p className="text-sm text-gray-400">
                Control which hosts this user can connect from. This adds an extra layer of security.
              </p>

              <RadioGroup
                value={hostRestriction}
                onValueChange={(value) => setHostRestriction(value as HostRestrictionType)}
                className="space-y-3"
              >
                <div className="flex items-center space-x-3 p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                  <RadioGroupItem value="any" id="host-any" />
                  <Label htmlFor="host-any" className="flex-1 cursor-pointer">
                    <div className="font-medium text-white">Any Host</div>
                    <div className="text-xs text-gray-400">User can connect from any IP address</div>
                  </Label>
                </div>

                <div className="flex items-center space-x-3 p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                  <RadioGroupItem value="local" id="host-local" />
                  <Label htmlFor="host-local" className="flex-1 cursor-pointer">
                    <div className="font-medium text-white">Local Only</div>
                    <div className="text-xs text-gray-400">User can only connect from localhost</div>
                  </Label>
                </div>

                <div className="flex items-center space-x-3 p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                  <RadioGroupItem value="ip" id="host-ip" />
                  <Label htmlFor="host-ip" className="flex-1 cursor-pointer">
                    <div className="font-medium text-white">Specific IP Addresses</div>
                    <div className="text-xs text-gray-400">Restrict to specific IP addresses or CIDR ranges</div>
                  </Label>
                </div>

                <div className="flex items-center space-x-3 p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                  <RadioGroupItem value="name" id="host-name" />
                  <Label htmlFor="host-name" className="flex-1 cursor-pointer">
                    <div className="font-medium text-white">Specific Hostnames</div>
                    <div className="text-xs text-gray-400">Restrict to specific hostnames (DNS resolved)</div>
                  </Label>
                </div>
              </RadioGroup>

              {/* Host input for IP or Name restriction */}
              {(hostRestriction === "ip" || hostRestriction === "name") && (
                <div className="space-y-3 pt-4 border-t border-white/10">
                  <Label className="text-white">
                    {hostRestriction === "ip" ? "Allowed IP Addresses" : "Allowed Hostnames"}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={newHost}
                      onChange={(e) => setNewHost(e.target.value)}
                      placeholder={hostRestriction === "ip" ? "e.g., 192.168.1.0/24" : "e.g., myserver.local"}
                      className="bg-white/5 border-white/10"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addHost();
                        }
                      }}
                    />
                    <Button type="button" onClick={addHost} variant="outline">
                      Add
                    </Button>
                  </div>

                  {/* Display added hosts */}
                  <div className="flex flex-wrap gap-2">
                    {allowedHosts.length === 0 && (
                      <p className="text-sm text-yellow-500/80 italic">
                        No hosts added. User won't be able to connect until at least one is added.
                      </p>
                    )}
                    {allowedHosts.map((host) => (
                      <Badge
                        key={host}
                        variant="secondary"
                        className="bg-orange-500/20 text-orange-200 border border-orange-500/30 cursor-pointer hover:bg-red-500/20 hover:text-red-200"
                        onClick={() => removeHost(host)}
                      >
                        {host}
                        <X className="ml-1 h-3 w-3" />
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <Button 
                onClick={handleUpdateHost} 
                disabled={isUpdatingHost || ((hostRestriction === "ip" || hostRestriction === "name") && allowedHosts.length === 0)}
                className="gap-2"
              >
                {isUpdatingHost ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  "Update Host Restriction"
                )}
              </Button>
            </GlassCardContent>
          </GlassCard>
        </TabsContent>

        <TabsContent value="password">
          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-yellow-400" />
                Change Password
              </GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent>
              <form onSubmit={handleUpdatePassword} className="space-y-6 max-w-md">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <div className="flex gap-2">
                    <Input
                      id="new-password"
                      type={showPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                      className="bg-white/5 border-white/10 font-mono"
                    />
                    <Button type="button" variant="outline" onClick={generatePassword} className="shrink-0">
                      Generate
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm New Password</Label>
                  <Input
                    id="confirm-password"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="bg-white/5 border-white/10 font-mono"
                  />
                  {confirmPassword && newPassword !== confirmPassword && (
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

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="show-password"
                    checked={showPassword}
                    onChange={(e) => setShowPassword(e.target.checked)}
                    className="rounded"
                  />
                  <Label htmlFor="show-password" className="text-sm text-gray-400 cursor-pointer">
                    Show password
                  </Label>
                </div>

                <Button 
                  type="submit" 
                  disabled={isUpdatingPassword || !isPasswordValid || newPassword !== confirmPassword}
                >
                  {isUpdatingPassword ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    "Update Password"
                  )}
                </Button>
              </form>
            </GlassCardContent>
          </GlassCard>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
};

export default EditUser;
