import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UserCog, ArrowLeft, Loader2, Shield, Key, Trash2, AlertTriangle, Server, Database, X, FileText, Check, Globe, Table2, ChevronDown, ChevronRight, Layers, Code, Play, Copy, RefreshCw } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle } from "@/components/ui/glass-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { cn } from "@/lib/utils";

// Database table access structure
interface DatabaseTableAccess {
  database: string;
  allTables: boolean;
  tables: string[];
}

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

  // Form state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [currentGrants, setCurrentGrants] = useState<string[]>([]);
  const [useCluster, setUseCluster] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState("");
  const [selectedDatabases, setSelectedDatabases] = useState<string[]>([]);
  const [databaseAccess, setDatabaseAccess] = useState<DatabaseTableAccess[]>([]);
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(new Set());
  const [selectedRole, setSelectedRole] = useState<RoleTemplate | null>(null);
  const [allowQueryLogs, setAllowQueryLogs] = useState(true);
  const [hostRestriction, setHostRestriction] = useState<HostRestrictionType>("any");
  const [allowedHosts, setAllowedHosts] = useState<string[]>([]);
  const [newHost, setNewHost] = useState("");
  
  // DDL state
  const [isApplying, setIsApplying] = useState(false);
  const [ddlStatements, setDdlStatements] = useState<string[]>([]);
  const [customDdl, setCustomDdl] = useState("");
  const [useCustomDdl, setUseCustomDdl] = useState(false);
  
  // Track what changes are pending
  const [pendingChanges, setPendingChanges] = useState({
    password: false,
    host: false,
    role: false,
  });

  const databases = databasesData.map((db) => db.name);
  
  // Build cluster clause helper
  const getClusterClause = () => useCluster && selectedCluster ? ` ON CLUSTER '${selectedCluster}'` : "";

  // Generate DDL statements based on pending changes
  const generatedDdl = useMemo(() => {
    const statements: string[] = [];
    const clusterClause = getClusterClause();
    
    // Password change DDL
    if (pendingChanges.password && newPassword) {
      const escapedPassword = newPassword.replace(/'/g, "''");
      statements.push(`-- Change password for user '${username}'`);
      statements.push(`ALTER USER '${username}'${clusterClause} IDENTIFIED WITH sha256_password BY '${escapedPassword}';`);
      statements.push('');
    }
    
    // Host restriction DDL
    if (pendingChanges.host) {
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
      statements.push(`-- Update host restriction for user '${username}'`);
      statements.push(`ALTER USER '${username}'${clusterClause} ${hostClause};`);
      statements.push('');
    }
    
    // Role/Permissions DDL
    if (pendingChanges.role && selectedRole) {
      statements.push(`-- Update permissions for user '${username}'`);
      statements.push(`-- First revoke all existing grants`);
      statements.push(`REVOKE${clusterClause} ALL ON *.* FROM '${username}';`);
      statements.push('');
      
      if (selectedRole === "admin") {
        statements.push(`-- Grant admin privileges`);
        statements.push(`GRANT${clusterClause} ALL ON *.* TO '${username}' WITH GRANT OPTION;`);
      } else {
        statements.push(`-- Grant ${ROLE_TEMPLATES[selectedRole].name} privileges`);
        
        for (const access of databaseAccess) {
          const { database, allTables, tables } = access;
          const targets: string[] = allTables 
            ? [`\`${database}\`.*`]
            : tables.map(t => `\`${database}\`.\`${t}\``);
          
          if (!allTables && tables.length === 0) continue;
          
          for (const target of targets) {
            switch (selectedRole) {
              case "developer":
                if (allTables) {
                  statements.push(`GRANT${clusterClause} SELECT, INSERT, CREATE TABLE, DROP TABLE, ALTER TABLE ON ${target} TO '${username}';`);
                } else {
                  statements.push(`GRANT${clusterClause} SELECT, INSERT, ALTER TABLE ON ${target} TO '${username}';`);
                }
                break;
              case "readWrite":
                statements.push(`GRANT${clusterClause} SELECT, INSERT ON ${target} TO '${username}';`);
                break;
              case "readOnly":
                statements.push(`GRANT${clusterClause} SELECT ON ${target} TO '${username}';`);
                break;
            }
          }
        }
        
        if (allowQueryLogs) {
          statements.push('');
          statements.push(`-- Grant query log access`);
          statements.push(`GRANT${clusterClause} SELECT ON system.query_log TO '${username}';`);
        }
      }
    }
    
    return statements;
  }, [pendingChanges, newPassword, hostRestriction, allowedHosts, selectedRole, databaseAccess, allowQueryLogs, useCluster, selectedCluster, username]);

  // Update DDL statements when generated DDL changes
  useEffect(() => {
    if (!useCustomDdl) {
      setDdlStatements(generatedDdl);
    }
  }, [generatedDdl, useCustomDdl]);

  // Check if there are any pending changes
  const hasPendingChanges = pendingChanges.password || pendingChanges.host || pendingChanges.role;

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

  // Fetch current grants for the user and detect current role
  useEffect(() => {
    if (username) {
      executeQuery.mutateAsync({
        query: `SELECT access_type, database, table FROM system.grants WHERE user_name = '${username}'`,
      }).then((result) => {
        const data = result.data as { access_type: string; database: string; table: string }[];
        const grants = data.map(g => g.access_type);
        const grantSet = new Set(grants.map(g => g.toUpperCase()));
        setCurrentGrants(grants);
        
        // Build database access structure with table-level detail
        const dbAccessMap = new Map<string, DatabaseTableAccess>();
        
        data.forEach(grant => {
          const db = grant.database;
          const table = grant.table;
          
          // Skip system databases and empty entries
          if (!db || db === '' || db.startsWith('system')) return;
          
          if (!dbAccessMap.has(db)) {
            dbAccessMap.set(db, { database: db, allTables: false, tables: [] });
          }
          
          const access = dbAccessMap.get(db)!;
          
          // If table is empty or *, it means all tables
          if (!table || table === '' || table === '*') {
            access.allTables = true;
          } else if (!access.allTables && !access.tables.includes(table)) {
            access.tables.push(table);
          }
        });
        
        const accessArray = Array.from(dbAccessMap.values());
        if (accessArray.length > 0) {
          setDatabaseAccess(accessArray);
          setSelectedDatabases(accessArray.map(a => a.database));
          // Auto-expand databases with specific table selections
          const toExpand = accessArray.filter(a => !a.allTables && a.tables.length > 0).map(a => a.database);
          setExpandedDatabases(new Set(toExpand));
        }
        
        // Detect current role based on grants
        const adminIndicators = ["ALL", "GRANT OPTION", "ACCESS MANAGEMENT", "ROLE ADMIN", "CREATE USER", "DROP USER", "SYSTEM"];
        const hasAdminPrivileges = adminIndicators.some(ind => grantSet.has(ind)) || grants.length > 20;
        
        if (hasAdminPrivileges) {
          setSelectedRole("admin");
        } else {
          const hasSelect = grantSet.has("SELECT");
          const hasInsert = grantSet.has("INSERT");
          const hasDDL = grantSet.has("CREATE TABLE") || grantSet.has("DROP TABLE") || grantSet.has("ALTER TABLE");
          
          if (hasSelect && hasInsert && hasDDL) {
            setSelectedRole("developer");
          } else if (hasSelect && hasInsert) {
            setSelectedRole("readWrite");
          } else if (hasSelect) {
            setSelectedRole("readOnly");
          }
        }
      }).catch(() => {
        // Ignore errors
      });
    }
  }, [username]);

  // Host management functions
  const addHost = () => {
    if (newHost.trim() && !allowedHosts.includes(newHost.trim())) {
      setAllowedHosts([...allowedHosts, newHost.trim()]);
      setNewHost("");
      setPendingChanges(prev => ({ ...prev, host: true }));
    }
  };

  const removeHost = (host: string) => {
    setAllowedHosts(allowedHosts.filter((h) => h !== host));
    setPendingChanges(prev => ({ ...prev, host: true }));
  };

  // Mark host change as pending when restriction type changes
  const handleHostRestrictionChange = (value: HostRestrictionType) => {
    setHostRestriction(value);
    setPendingChanges(prev => ({ ...prev, host: true }));
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

  // Mark password as pending when it changes
  const handlePasswordChange = (password: string) => {
    setNewPassword(password);
    if (password.trim()) {
      setPendingChanges(prev => ({ ...prev, password: true }));
    } else {
      setPendingChanges(prev => ({ ...prev, password: false }));
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
    handlePasswordChange(password);
    setConfirmPassword(password);
  };

  // Mark role as pending when it changes
  const handleRoleChange = (role: RoleTemplate) => {
    setSelectedRole(role);
    setPendingChanges(prev => ({ ...prev, role: true }));
  };

  // Apply all DDL statements
  const handleApplyDdl = async () => {
    const statementsToExecute = useCustomDdl 
      ? customDdl.split(';').map(s => s.trim()).filter(s => s && !s.startsWith('--'))
      : ddlStatements.filter(s => s && !s.startsWith('--') && s.trim());
    
    if (statementsToExecute.length === 0) {
      toast.error("No DDL statements to execute");
      return;
    }

    setIsApplying(true);
    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    for (const statement of statementsToExecute) {
      if (!statement.trim()) continue;
      
      try {
        await executeQuery.mutateAsync({ query: statement });
        successCount++;
      } catch (error) {
        failCount++;
        errors.push(`${statement.substring(0, 50)}...: ${(error as Error).message}`);
      }
    }

    setIsApplying(false);

    if (failCount === 0) {
      toast.success(`Successfully executed ${successCount} statement(s)`);
      // Reset pending changes
      setPendingChanges({ password: false, host: false, role: false });
      setNewPassword("");
      setConfirmPassword("");
      setSelectedRole(null);
      // Refresh user data
      refetch();
    } else {
      toast.error(`${failCount} statement(s) failed. ${successCount} succeeded.`);
      console.error("DDL Errors:", errors);
    }
  };

  // Copy DDL to clipboard
  const copyDdlToClipboard = () => {
    const ddl = useCustomDdl ? customDdl : ddlStatements.join('\n');
    navigator.clipboard.writeText(ddl);
    toast.success("DDL copied to clipboard");
  };

  // Reset all pending changes
  const resetChanges = () => {
    setPendingChanges({ password: false, host: false, role: false });
    setNewPassword("");
    setConfirmPassword("");
    setSelectedRole(null);
    setUseCustomDdl(false);
    setCustomDdl("");
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
              {/* Database & Table Selection */}
              <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <div className="flex items-center gap-2 mb-3">
                  <Database className="h-4 w-4 text-blue-400" />
                  <Label className="text-white font-medium">Database & Table Access (Required for non-Admin roles)</Label>
                </div>
                <p className="text-xs text-gray-400 mb-3">
                  Select databases and optionally restrict access to specific tables. Admin role gets access to all databases.
                </p>
                
                {/* Database selector */}
                <Select
                  onValueChange={(dbName: string) => {
                    if (!databaseAccess.some(d => d.database === dbName)) {
                      setDatabaseAccess([...databaseAccess, { database: dbName, allTables: true, tables: [] }]);
                      setSelectedDatabases([...selectedDatabases, dbName]);
                      setExpandedDatabases(prev => new Set([...prev, dbName]));
                      setPendingChanges(prev => ({ ...prev, role: true }));
                    }
                  }}
                >
                  <SelectTrigger className="bg-white/5 border-white/10">
                    <SelectValue placeholder="Add database access..." />
                  </SelectTrigger>
                  <SelectContent>
                    {databasesData.map((db) => (
                      <SelectItem 
                        key={db.name} 
                        value={db.name} 
                        disabled={databaseAccess.some(d => d.database === db.name)}
                      >
                        <div className="flex items-center gap-2">
                          <Database className="h-3 w-3" />
                          {db.name}
                          <span className="text-xs text-gray-400">({db.children.length} tables)</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Selected databases with table selection */}
                <div className="space-y-3 mt-4">
                  {databaseAccess.length === 0 ? (
                    <p className="text-sm text-amber-400 italic">
                      ⚠️ No databases selected. Select databases before applying a non-admin role.
                    </p>
                  ) : (
                    databaseAccess.map((access) => {
                      const dbInfo = databasesData.find(d => d.name === access.database);
                      const tables = dbInfo?.children || [];
                      const isExpanded = expandedDatabases.has(access.database);
                      
                      const getSelectionSummary = () => {
                        if (access.allTables) return "All tables";
                        if (access.tables.length === 0) return "No tables selected";
                        return `${access.tables.length} table${access.tables.length > 1 ? 's' : ''}`;
                      };

                      return (
                        <div 
                          key={access.database}
                          className="rounded-lg border border-white/10 bg-white/5 overflow-hidden"
                        >
                          {/* Database header */}
                          <div className="flex items-center justify-between p-3 bg-white/5">
                            <div className="flex items-center gap-2 flex-1">
                              <button
                                type="button"
                                onClick={() => {
                                  const newExpanded = new Set(expandedDatabases);
                                  if (newExpanded.has(access.database)) {
                                    newExpanded.delete(access.database);
                                  } else {
                                    newExpanded.add(access.database);
                                  }
                                  setExpandedDatabases(newExpanded);
                                }}
                                className="p-1 hover:bg-white/10 rounded transition-colors"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-gray-400" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-gray-400" />
                                )}
                              </button>
                              <Database className="h-4 w-4 text-blue-400" />
                              <span className="font-medium text-white">{access.database}</span>
                              <Badge variant="outline" className="text-xs bg-white/5">
                                {getSelectionSummary()}
                              </Badge>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setDatabaseAccess(databaseAccess.filter(d => d.database !== access.database));
                                setSelectedDatabases(selectedDatabases.filter(d => d !== access.database));
                                setPendingChanges(prev => ({ ...prev, role: true }));
                              }}
                              className="h-7 w-7 p-0 text-gray-400 hover:text-red-400 hover:bg-red-500/10"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>

                          {/* Expanded content - table selection */}
                          {isExpanded && (
                            <div className="p-3 border-t border-white/10 space-y-3">
                              {/* All tables toggle */}
                                <div className="flex items-center justify-between p-2 rounded bg-white/5">
                                <div className="flex items-center gap-2">
                                  <Checkbox
                                    id={`all-${access.database}`}
                                    checked={access.allTables}
                                    onCheckedChange={(checked) => {
                                      setDatabaseAccess(databaseAccess.map(d => 
                                        d.database === access.database 
                                          ? { ...d, allTables: !!checked, tables: checked ? [] : d.tables }
                                          : d
                                      ));
                                      setPendingChanges(prev => ({ ...prev, role: true }));
                                    }}
                                  />
                                  <label 
                                    htmlFor={`all-${access.database}`}
                                    className="text-sm font-medium text-white cursor-pointer flex items-center gap-2"
                                  >
                                    <Layers className="h-4 w-4 text-purple-400" />
                                    All Tables (*.*)
                                  </label>
                                </div>
                                <span className="text-xs text-gray-400">
                                  Grants access to all current and future tables
                                </span>
                              </div>

                              {/* Specific tables selection */}
                              {!access.allTables && (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-gray-400">Or select specific tables:</span>
                                    <div className="flex gap-2">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          setDatabaseAccess(databaseAccess.map(d => 
                                            d.database === access.database 
                                              ? { ...d, tables: tables.map(t => t.name) }
                                              : d
                                          ));
                                          setPendingChanges(prev => ({ ...prev, role: true }));
                                        }}
                                        className="h-6 text-xs"
                                      >
                                        Select All
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          setDatabaseAccess(databaseAccess.map(d => 
                                            d.database === access.database 
                                              ? { ...d, tables: [] }
                                              : d
                                          ));
                                          setPendingChanges(prev => ({ ...prev, role: true }));
                                        }}
                                        className="h-6 text-xs"
                                      >
                                        Clear
                                      </Button>
                                    </div>
                                  </div>
                                  
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-2 rounded bg-black/20">
                                    {tables.length === 0 ? (
                                      <span className="text-xs text-gray-500 col-span-full">No tables in this database</span>
                                    ) : (
                                      tables.map((table) => (
                                        <div 
                                          key={table.name}
                                          className={cn(
                                            "flex items-center gap-2 p-2 rounded cursor-pointer transition-colors",
                                            access.tables.includes(table.name)
                                              ? "bg-blue-500/20 border border-blue-500/30"
                                              : "bg-white/5 border border-transparent hover:bg-white/10"
                                          )}
                                          onClick={() => {
                                            const hasTable = access.tables.includes(table.name);
                                            setDatabaseAccess(databaseAccess.map(d => 
                                              d.database === access.database 
                                                ? { 
                                                    ...d, 
                                                    tables: hasTable 
                                                      ? d.tables.filter(t => t !== table.name)
                                                      : [...d.tables, table.name]
                                                  }
                                                : d
                                            ));
                                            setPendingChanges(prev => ({ ...prev, role: true }));
                                          }}
                                        >
                                          <Checkbox checked={access.tables.includes(table.name)} />
                                          <Table2 className="h-3 w-3 text-gray-400" />
                                          <span className="text-xs text-white truncate">{table.name}</span>
                                        </div>
                                      ))
                                    )}
                                  </div>

                                  {access.tables.length === 0 && !access.allTables && (
                                    <p className="text-xs text-amber-400">
                                      ⚠️ No tables selected. Select tables or enable "All Tables".
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
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
                  Select a role template, then click "Apply Role" to save changes. This will revoke existing permissions and apply new ones.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {(Object.entries(ROLE_TEMPLATES) as [RoleTemplate, typeof ROLE_TEMPLATES.admin][]).map(
                    ([key, role]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handleRoleChange(key)}
                        disabled={isApplying}
                        className={`p-4 rounded-lg border-2 transition-all text-left hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed ${
                          selectedRole === key 
                            ? `${role.bgColor} ${role.borderColor} ring-2 ring-offset-2 ring-offset-gray-900 ring-white/50` 
                            : 'bg-white/5 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        <div className="text-2xl mb-2">{role.icon}</div>
                        <div className={`font-semibold ${selectedRole === key ? role.color : 'text-gray-300'}`}>{role.name}</div>
                        <div className="text-xs text-gray-400 mt-1">{role.description}</div>
                        {key !== "admin" && databaseAccess.length > 0 && (
                          <div className="text-[10px] text-gray-500 mt-2">
                            → {databaseAccess.length} database(s)
                            {databaseAccess.some(a => !a.allTables && a.tables.length > 0) && (
                              <span> ({databaseAccess.reduce((acc, a) => acc + (a.allTables ? 0 : a.tables.length), 0)} tables)</span>
                            )}
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

                {/* Role Selection Info */}
                {selectedRole && (
                  <div className="flex items-center gap-2 mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <Check className="h-4 w-4 text-green-400" />
                    <p className="text-sm text-green-300">
                      {ROLE_TEMPLATES[selectedRole].name} role selected. See DDL preview below to apply.
                    </p>
                  </div>
                )}
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
                onValueChange={(value) => handleHostRestrictionChange(value as HostRestrictionType)}
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

              {/* Pending indicator */}
              {pendingChanges.host && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <Check className="h-4 w-4 text-green-400" />
                  <p className="text-sm text-green-300">
                    Host restriction changes pending. See DDL preview below to apply.
                  </p>
                </div>
              )}
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
              <div className="space-y-6 max-w-md">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <div className="flex gap-2">
                    <Input
                      id="new-password"
                      type={showPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => handlePasswordChange(e.target.value)}
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

                {/* Pending indicator */}
                {pendingChanges.password && isPasswordValid && newPassword === confirmPassword && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <Check className="h-4 w-4 text-green-400" />
                    <p className="text-sm text-green-300">
                      Password change pending. See DDL preview below to apply.
                    </p>
                  </div>
                )}
              </div>
            </GlassCardContent>
          </GlassCard>
        </TabsContent>
      </Tabs>

      {/* DDL Preview Section */}
      <GlassCard>
        <GlassCardHeader>
          <div className="flex items-center justify-between w-full">
            <GlassCardTitle className="flex items-center gap-2">
              <Code className="h-5 w-5 text-cyan-400" />
              DDL Preview
              {hasPendingChanges && (
                <Badge variant="secondary" className="bg-amber-500/20 text-amber-300 border-amber-500/30 ml-2">
                  {Object.values(pendingChanges).filter(Boolean).length} pending change(s)
                </Badge>
              )}
            </GlassCardTitle>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="custom-ddl"
                  checked={useCustomDdl}
                  onCheckedChange={(checked) => {
                    setUseCustomDdl(!!checked);
                    if (checked) {
                      setCustomDdl(ddlStatements.join('\n'));
                    }
                  }}
                />
                <Label htmlFor="custom-ddl" className="text-sm text-gray-400 cursor-pointer">
                  Edit manually
                </Label>
              </div>
              <Button variant="ghost" size="sm" onClick={copyDdlToClipboard} className="gap-1">
                <Copy className="h-3 w-3" />
                Copy
              </Button>
            </div>
          </div>
        </GlassCardHeader>
        <GlassCardContent>
          {useCustomDdl ? (
            <Textarea
              value={customDdl}
              onChange={(e) => setCustomDdl(e.target.value)}
              placeholder="Enter custom DDL statements..."
              className="bg-black/30 border-white/10 font-mono text-sm min-h-[200px]"
            />
          ) : (
            <ScrollArea className="h-[200px] rounded-lg bg-black/30 border border-white/10">
              <pre className="p-4 font-mono text-sm text-gray-300 whitespace-pre-wrap">
                {ddlStatements.length > 0 
                  ? ddlStatements.join('\n')
                  : '-- No changes pending\n-- Make changes above and they will appear here'}
              </pre>
            </ScrollArea>
          )}
          
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/10">
            <p className="text-xs text-gray-500">
              Review the DDL statements above before applying. Changes will be executed in order.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={resetChanges}
                disabled={!hasPendingChanges || isApplying}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Reset
              </Button>
              <Button
                onClick={handleApplyDdl}
                disabled={!hasPendingChanges || isApplying}
                className="gap-2 bg-green-600 hover:bg-green-700"
              >
                {isApplying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Applying...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Apply DDL
                  </>
                )}
              </Button>
            </div>
          </div>
        </GlassCardContent>
      </GlassCard>

      {/* Footer Actions */}
      <div className="flex items-center justify-end gap-3 pt-6 border-t border-white/10">
        <Button
          variant="outline"
          onClick={() => navigate("/admin")}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Users
        </Button>
      </div>
    </motion.div>
  );
};

export default EditUser;
