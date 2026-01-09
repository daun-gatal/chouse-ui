import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UserPlus, ArrowLeft, Loader2, Shield, Database, Key, Globe, X, Server, FileText, Code, Copy, ChevronDown, ChevronRight, Table2, Layers } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle } from "@/components/ui/glass-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useExecuteQuery, useDatabases, useClusterNames } from "@/hooks";
import { cn } from "@/lib/utils";

// Database-table access structure
interface DatabaseTableAccess {
  database: string;
  allTables: boolean;
  tables: string[];
}

// Predefined role templates
const ROLE_TEMPLATES = {
  admin: {
    name: "Admin",
    description: "Full access to all databases and system operations",
    icon: "🛡️",
    color: "text-red-400",
    bgColor: "bg-red-500/20",
    borderColor: "border-red-500/50",
    privileges: {
      isAdmin: true,
      allowSelect: true,
      allowInsert: true,
      allowDDL: true,
      allowSystem: true,
    },
  },
  developer: {
    name: "Developer",
    description: "Read/write access with DDL capabilities",
    icon: "👨‍💻",
    color: "text-blue-400",
    bgColor: "bg-blue-500/20",
    borderColor: "border-blue-500/50",
    privileges: {
      isAdmin: false,
      allowSelect: true,
      allowInsert: true,
      allowDDL: true,
      allowSystem: false,
    },
  },
  readWrite: {
    name: "Read-Write",
    description: "Read and write data, no schema changes",
    icon: "📝",
    color: "text-green-400",
    bgColor: "bg-green-500/20",
    borderColor: "border-green-500/50",
    privileges: {
      isAdmin: false,
      allowSelect: true,
      allowInsert: true,
      allowDDL: false,
      allowSystem: false,
    },
  },
  readOnly: {
    name: "Read Only",
    description: "Query data only, no modifications",
    icon: "👁️",
    color: "text-purple-400",
    bgColor: "bg-purple-500/20",
    borderColor: "border-purple-500/50",
    privileges: {
      isAdmin: false,
      allowSelect: true,
      allowInsert: false,
      allowDDL: false,
      allowSystem: false,
    },
  },
};

type RoleTemplate = keyof typeof ROLE_TEMPLATES;
type HostRestrictionType = "any" | "ip" | "name" | "local";

const CreateUser: React.FC = () => {
  const navigate = useNavigate();
  const executeQuery = useExecuteQuery();
  const { data: databasesData = [] } = useDatabases();
  const { data: clusters = [] } = useClusterNames();
  
  // Form state - using regular React state like EditUser
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState<RoleTemplate>("readOnly");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hostRestriction, setHostRestriction] = useState<HostRestrictionType>("any");
  const [newHost, setNewHost] = useState("");
  const [allowedHosts, setAllowedHosts] = useState<string[]>([]);
  const [useCluster, setUseCluster] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState("");
  const [allowQueryLogs, setAllowQueryLogs] = useState(true);
  
  // Database access state
  const [databaseAccess, setDatabaseAccess] = useState<DatabaseTableAccess[]>([]);
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(new Set());
  
  // DDL state
  const [useCustomDdl, setUseCustomDdl] = useState(false);
  const [customDdl, setCustomDdl] = useState("");

  // Build cluster clause helper
  const getClusterClause = () => useCluster && selectedCluster ? ` ON CLUSTER '${selectedCluster}'` : "";

  // Generate DDL statements
  const generatedDdl = useMemo(() => {
    const statements: string[] = [];
    const clusterClause = getClusterClause();
    const privileges = ROLE_TEMPLATES[selectedRole].privileges;
    
    if (!username.trim()) {
      return ["-- Enter a username to see DDL preview"];
    }

    const escapedUsername = username.trim();
    
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
    
    // CREATE USER statement
    statements.push(`-- Create user '${escapedUsername}'`);
    if (password) {
      const escapedPassword = password.replace(/'/g, "''");
      statements.push(`CREATE USER '${escapedUsername}'${clusterClause} ${hostClause} IDENTIFIED WITH sha256_password BY '${escapedPassword}';`);
    } else {
      statements.push(`-- (Password not set yet)`);
      statements.push(`CREATE USER '${escapedUsername}'${clusterClause} ${hostClause} IDENTIFIED WITH sha256_password BY '<PASSWORD>';`);
    }
    statements.push('');
    
    // GRANT statements
    if (privileges.isAdmin) {
      statements.push(`-- Grant admin privileges`);
      statements.push(`GRANT${clusterClause} ALL ON *.* TO '${escapedUsername}' WITH GRANT OPTION;`);
    } else {
      statements.push(`-- Grant ${ROLE_TEMPLATES[selectedRole].name} privileges`);
      
      if (databaseAccess.length === 0) {
        statements.push(`-- (No databases selected - user will have no data access)`);
      } else {
        for (const access of databaseAccess) {
          const { database, allTables, tables } = access;
          const targets: string[] = allTables 
            ? [`\`${database}\`.*`]
            : tables.map(t => `\`${database}\`.\`${t}\``);
          
          if (!allTables && tables.length === 0) continue;
          
          for (const target of targets) {
            if (privileges.allowSelect) {
              statements.push(`GRANT${clusterClause} SELECT ON ${target} TO '${escapedUsername}';`);
            }
            if (privileges.allowInsert) {
              statements.push(`GRANT${clusterClause} INSERT ON ${target} TO '${escapedUsername}';`);
            }
            if (privileges.allowDDL) {
              if (allTables) {
                statements.push(`GRANT${clusterClause} CREATE TABLE, DROP TABLE, ALTER TABLE ON ${target} TO '${escapedUsername}';`);
              } else {
                statements.push(`GRANT${clusterClause} ALTER TABLE ON ${target} TO '${escapedUsername}';`);
              }
            }
          }
        }
      }
      
      if (privileges.allowSystem) {
        statements.push('');
        statements.push(`GRANT${clusterClause} SYSTEM ON *.* TO '${escapedUsername}';`);
      }
      
      if (allowQueryLogs) {
        statements.push('');
        statements.push(`-- Grant query log access`);
        statements.push(`GRANT${clusterClause} SELECT ON system.query_log TO '${escapedUsername}';`);
      }
    }
    
    return statements;
  }, [username, password, databaseAccess, selectedRole, hostRestriction, allowedHosts, useCluster, selectedCluster, allowQueryLogs]);

  const ddlText = useCustomDdl ? customDdl : generatedDdl.join('\n');

  const copyDdlToClipboard = () => {
    navigator.clipboard.writeText(ddlText);
    toast.success("DDL copied to clipboard");
  };

  const handleRoleSelect = (role: RoleTemplate) => {
    setSelectedRole(role);
  };

  const addHost = () => {
    if (newHost.trim() && !allowedHosts.includes(newHost.trim())) {
      setAllowedHosts([...allowedHosts, newHost.trim()]);
      setNewHost("");
    }
  };

  const removeHost = (host: string) => {
    setAllowedHosts(allowedHosts.filter((h) => h !== host));
  };

  const generatePassword = () => {
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
  };

  const onSubmit = async () => {
    if (!username.trim()) {
      toast.error("Username is required");
      return;
    }
    if (!password) {
      toast.error("Password is required");
      return;
    }

    setIsSubmitting(true);

    try {
      const privileges = ROLE_TEMPLATES[selectedRole].privileges;
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

      // Create user
      const escapedPassword = password.replace(/'/g, "''");
      await executeQuery.mutateAsync({
        query: `CREATE USER '${username}'${clusterClause} ${hostClause} IDENTIFIED WITH sha256_password BY '${escapedPassword}'`,
      });

      // Grant privileges
      if (privileges.isAdmin) {
        await executeQuery.mutateAsync({
          query: `GRANT${clusterClause} ALL ON *.* TO '${username}' WITH GRANT OPTION`,
        });
      } else {
        if (databaseAccess.length === 0) {
          toast.warning("User created without database access. Add database permissions in Edit User.");
        }

        for (const access of databaseAccess) {
          const { database, allTables, tables } = access;
          const targets: string[] = allTables 
            ? [`\`${database}\`.*`]
            : tables.map(t => `\`${database}\`.\`${t}\``);
          
          if (!allTables && tables.length === 0) continue;

          for (const target of targets) {
            if (privileges.allowSelect) {
              await executeQuery.mutateAsync({
                query: `GRANT${clusterClause} SELECT ON ${target} TO '${username}'`,
              });
            }
            if (privileges.allowInsert) {
              await executeQuery.mutateAsync({
                query: `GRANT${clusterClause} INSERT ON ${target} TO '${username}'`,
              });
            }
            if (privileges.allowDDL) {
              if (allTables) {
                await executeQuery.mutateAsync({
                  query: `GRANT${clusterClause} CREATE TABLE, DROP TABLE, ALTER TABLE ON ${target} TO '${username}'`,
                });
              } else {
                await executeQuery.mutateAsync({
                  query: `GRANT${clusterClause} ALTER TABLE ON ${target} TO '${username}'`,
                });
              }
            }
          }
        }

        if (privileges.allowSystem) {
          await executeQuery.mutateAsync({
            query: `GRANT${clusterClause} SYSTEM ON *.* TO '${username}'`,
          });
        }

        if (allowQueryLogs) {
          await executeQuery.mutateAsync({
            query: `GRANT${clusterClause} SELECT ON system.query_log TO '${username}'`,
          });
        }
      }

      toast.success(`User "${username}" created successfully with ${ROLE_TEMPLATES[selectedRole].name} role`);
      navigate("/admin");
    } catch (error) {
      console.error("Failed to create user:", error);
      toast.error(`Failed to create user: ${(error as Error).message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

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

      <div className="space-y-6">
        {/* Role Selection */}
        <GlassCard>
          <GlassCardHeader>
            <GlassCardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-purple-400" />
              Select Role Template
            </GlassCardTitle>
          </GlassCardHeader>
          <GlassCardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {(Object.entries(ROLE_TEMPLATES) as [RoleTemplate, typeof ROLE_TEMPLATES.admin][]).map(
                ([key, role]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleRoleSelect(key)}
                    className={`p-4 rounded-lg border-2 transition-all text-left ${
                      selectedRole === key
                        ? `${role.bgColor} ${role.borderColor}`
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    }`}
                  >
                    <div className="text-2xl mb-2">{role.icon}</div>
                    <div className={`font-semibold ${selectedRole === key ? role.color : "text-white"}`}>
                      {role.name}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">{role.description}</div>
                  </button>
                )
              )}
            </div>

            {/* Show selected role privileges */}
            <div className="mt-6 p-4 rounded-lg bg-white/5 border border-white/10">
              <div className="text-sm font-medium text-gray-300 mb-2">
                Permissions for {ROLE_TEMPLATES[selectedRole].name}:
              </div>
              <div className="flex flex-wrap gap-2">
                {ROLE_TEMPLATES[selectedRole].privileges.isAdmin && (
                  <span className="px-2 py-1 rounded text-xs bg-red-500/20 text-red-300 border border-red-500/30">
                    Full Admin
                  </span>
                )}
                {ROLE_TEMPLATES[selectedRole].privileges.allowSelect && (
                  <span className="px-2 py-1 rounded text-xs bg-green-500/20 text-green-300 border border-green-500/30">
                    SELECT
                  </span>
                )}
                {ROLE_TEMPLATES[selectedRole].privileges.allowInsert && (
                  <span className="px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    INSERT
                  </span>
                )}
                {ROLE_TEMPLATES[selectedRole].privileges.allowDDL && (
                  <span className="px-2 py-1 rounded text-xs bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                    DDL
                  </span>
                )}
                {ROLE_TEMPLATES[selectedRole].privileges.allowSystem && (
                  <span className="px-2 py-1 rounded text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    SYSTEM
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
                    <Label className="text-white font-medium">Create on Cluster</Label>
                    <p className="text-xs text-gray-400">Replicate this user across all cluster nodes</p>
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
        <Tabs defaultValue="auth" className="space-y-4">
          <TabsList className="bg-white/5 border border-white/10 p-1">
            <TabsTrigger value="auth" className="data-[state=active]:bg-purple-500/20">
              <Key className="h-4 w-4 mr-2" />
              Authentication
            </TabsTrigger>
            <TabsTrigger value="host" className="data-[state=active]:bg-orange-500/20">
              <Globe className="h-4 w-4 mr-2" />
              Host Restriction
            </TabsTrigger>
            {!ROLE_TEMPLATES[selectedRole].privileges.isAdmin && (
              <TabsTrigger value="databases" className="data-[state=active]:bg-blue-500/20">
                <Database className="h-4 w-4 mr-2" />
                Database Access
              </TabsTrigger>
            )}
            <TabsTrigger value="ddl" className="data-[state=active]:bg-cyan-500/20">
              <Code className="h-4 w-4 mr-2" />
              DDL Preview
            </TabsTrigger>
          </TabsList>

          {/* Authentication Tab */}
          <TabsContent value="auth">
            <GlassCard>
              <GlassCardHeader>
                <GlassCardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5 text-yellow-400" />
                  User Credentials
                </GlassCardTitle>
              </GlassCardHeader>
              <GlassCardContent className="space-y-6">
                <div className="space-y-2">
                  <Label className="text-white">Username</Label>
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter username"
                    className="bg-white/5 border-white/10"
                  />
                </div>
                
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
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                    <Button type="button" variant="outline" onClick={generatePassword}>
                      Generate
                    </Button>
                  </div>
                </div>
              </GlassCardContent>
            </GlassCard>
          </TabsContent>

          {/* Host Restriction Tab */}
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
                  Control which hosts this user can connect from.
                </p>

                <RadioGroup
                  value={hostRestriction}
                  onValueChange={(value) => setHostRestriction(value as HostRestrictionType)}
                  className="space-y-3"
                >
                  <div className="flex items-center space-x-3 p-3 rounded-lg bg-white/5 border border-white/10">
                    <RadioGroupItem value="any" id="host-any" />
                    <Label htmlFor="host-any" className="flex-1 cursor-pointer">
                      <div className="font-medium text-white">Any Host</div>
                      <div className="text-xs text-gray-400">Connect from any IP</div>
                    </Label>
                  </div>

                  <div className="flex items-center space-x-3 p-3 rounded-lg bg-white/5 border border-white/10">
                    <RadioGroupItem value="local" id="host-local" />
                    <Label htmlFor="host-local" className="flex-1 cursor-pointer">
                      <div className="font-medium text-white">Local Only</div>
                      <div className="text-xs text-gray-400">Localhost only</div>
                    </Label>
                  </div>

                  <div className="flex items-center space-x-3 p-3 rounded-lg bg-white/5 border border-white/10">
                    <RadioGroupItem value="ip" id="host-ip" />
                    <Label htmlFor="host-ip" className="flex-1 cursor-pointer">
                      <div className="font-medium text-white">Specific IPs</div>
                      <div className="text-xs text-gray-400">Restrict to IPs/CIDR</div>
                    </Label>
                  </div>

                  <div className="flex items-center space-x-3 p-3 rounded-lg bg-white/5 border border-white/10">
                    <RadioGroupItem value="name" id="host-name" />
                    <Label htmlFor="host-name" className="flex-1 cursor-pointer">
                      <div className="font-medium text-white">Specific Hostnames</div>
                      <div className="text-xs text-gray-400">DNS resolved</div>
                    </Label>
                  </div>
                </RadioGroup>

                {(hostRestriction === "ip" || hostRestriction === "name") && (
                  <div className="space-y-3 pt-4 border-t border-white/10">
                    <Label className="text-white">
                      {hostRestriction === "ip" ? "Allowed IPs" : "Allowed Hostnames"}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        value={newHost}
                        onChange={(e) => setNewHost(e.target.value)}
                        placeholder={hostRestriction === "ip" ? "192.168.1.0/24" : "myserver.local"}
                        className="bg-white/5 border-white/10"
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addHost())}
                      />
                      <Button type="button" onClick={addHost} variant="outline">Add</Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {allowedHosts.map((host) => (
                        <Badge
                          key={host}
                          variant="secondary"
                          className="bg-orange-500/20 text-orange-200 cursor-pointer hover:bg-red-500/20"
                          onClick={() => removeHost(host)}
                        >
                          {host} <X className="ml-1 h-3 w-3" />
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </GlassCardContent>
            </GlassCard>
          </TabsContent>

          {/* Database Access Tab */}
          {!ROLE_TEMPLATES[selectedRole].privileges.isAdmin && (
            <TabsContent value="databases">
              <GlassCard>
                <GlassCardHeader>
                  <GlassCardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5 text-blue-400" />
                    Database Access Control
                  </GlassCardTitle>
                </GlassCardHeader>
                <GlassCardContent className="space-y-6">
                  <p className="text-sm text-gray-400">
                    Select databases and optionally restrict access to specific tables.
                  </p>

                  {/* Database selector */}
                  <Select
                    onValueChange={(dbName: string) => {
                      if (!databaseAccess.some(d => d.database === dbName)) {
                        setDatabaseAccess([...databaseAccess, { database: dbName, allTables: true, tables: [] }]);
                        setExpandedDatabases(prev => new Set([...prev, dbName]));
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

                  {/* Selected databases */}
                  <div className="space-y-3">
                    {databaseAccess.length === 0 && (
                      <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-400">
                        ⚠️ No databases selected. User will NOT have access to any data.
                      </div>
                    )}

                    {databaseAccess.map((access) => {
                      const dbInfo = databasesData.find(d => d.name === access.database);
                      const tables = dbInfo?.children || [];
                      const isExpanded = expandedDatabases.has(access.database);

                      return (
                        <div key={access.database} className="rounded-lg border border-white/10 bg-white/5 overflow-hidden">
                          {/* Database header */}
                          <div className="flex items-center justify-between p-3 bg-white/5">
                            <div className="flex items-center gap-2">
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
                                className="p-1 hover:bg-white/10 rounded"
                              >
                                {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                              </button>
                              <Database className="h-4 w-4 text-blue-400" />
                              <span className="font-medium text-white">{access.database}</span>
                              <Badge variant="outline" className="text-xs bg-white/5">
                                {access.allTables ? "All tables" : `${access.tables.length} tables`}
                              </Badge>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setDatabaseAccess(databaseAccess.filter(d => d.database !== access.database))}
                              className="h-7 w-7 p-0 text-gray-400 hover:text-red-400"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>

                          {/* Expanded content */}
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
                                    }}
                                  />
                                  <label htmlFor={`all-${access.database}`} className="text-sm font-medium text-white cursor-pointer flex items-center gap-2">
                                    <Layers className="h-4 w-4 text-purple-400" />
                                    All Tables (*.*)
                                  </label>
                                </div>
                              </div>

                              {/* Specific tables */}
                              {!access.allTables && (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-gray-400">Select tables:</span>
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
                                        }}
                                        className="h-6 text-xs"
                                      >
                                        Clear
                                      </Button>
                                    </div>
                                  </div>
                                  
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-2 rounded bg-black/20">
                                    {tables.map((table) => (
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
                                        }}
                                      >
                                        <Checkbox checked={access.tables.includes(table.name)} />
                                        <Table2 className="h-3 w-3 text-gray-400" />
                                        <span className="text-xs text-white truncate">{table.name}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Query Logs Access */}
                  <div className="p-4 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-cyan-500/20">
                          <FileText className="h-4 w-4 text-cyan-400" />
                        </div>
                        <div>
                          <Label className="text-white font-medium">Query Logs Access</Label>
                          <p className="text-xs text-gray-400">View own query history</p>
                        </div>
                      </div>
                      <Switch checked={allowQueryLogs} onCheckedChange={setAllowQueryLogs} />
                    </div>
                  </div>
                </GlassCardContent>
              </GlassCard>
            </TabsContent>
          )}

          {/* DDL Preview Tab */}
          <TabsContent value="ddl">
            <GlassCard>
              <GlassCardHeader>
                <GlassCardTitle className="flex items-center gap-2">
                  <Code className="h-5 w-5 text-cyan-400" />
                  DDL Preview
                </GlassCardTitle>
              </GlassCardHeader>
              <GlassCardContent className="space-y-4">
                <p className="text-sm text-gray-400">
                  Review the SQL statements that will be executed.
                </p>

                {/* Toggle for manual editing */}
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="custom-ddl"
                    checked={useCustomDdl}
                    onCheckedChange={(checked) => {
                      setUseCustomDdl(!!checked);
                      if (checked) {
                        setCustomDdl(generatedDdl.join('\n'));
                      }
                    }}
                  />
                  <Label htmlFor="custom-ddl" className="text-sm text-gray-400 cursor-pointer">
                    Edit manually
                  </Label>
                </div>

                {/* DDL Display */}
                {useCustomDdl ? (
                  <Textarea
                    value={customDdl}
                    onChange={(e) => setCustomDdl(e.target.value)}
                    className="min-h-[200px] font-mono text-sm bg-black/30 border-white/10 text-gray-300"
                  />
                ) : (
                  <ScrollArea className="h-[200px] rounded-lg bg-black/30 border border-white/10">
                    <pre className="p-4 font-mono text-sm text-gray-300 whitespace-pre-wrap">
                      {generatedDdl.join('\n')}
                    </pre>
                  </ScrollArea>
                )}

                {/* Action buttons */}
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={copyDdlToClipboard}
                    className="gap-2"
                  >
                    <Copy className="h-4 w-4" />
                    Copy DDL
                  </Button>
                </div>
              </GlassCardContent>
            </GlassCard>
          </TabsContent>
        </Tabs>

        {/* Submit buttons */}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => navigate("/admin")}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isSubmitting} className="gap-2">
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
    </motion.div>
  );
};

export default CreateUser;
