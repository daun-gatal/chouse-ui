import React, { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UserPlus, ArrowLeft, Loader2, Shield, Database, Key, Globe, X, Server, FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useForm, FormProvider } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import AuthenticationSection from "./AuthenticationSection";
import DatabaseRolesSection from "./DatabaseRolesSection";

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

interface FormData {
  username: string;
  password: string;
  roleTemplate: RoleTemplate;
  grantDatabases: string[];
  hostRestriction: HostRestrictionType;
  allowedHosts: string[];
  privileges: {
    isAdmin: boolean;
    allowSelect: boolean;
    allowInsert: boolean;
    allowDDL: boolean;
    allowSystem: boolean;
  };
}

const CreateUser: React.FC = () => {
  const navigate = useNavigate();
  const executeQuery = useExecuteQuery();
  const { data: databasesData = [] } = useDatabases();
  const { data: clusters = [] } = useClusterNames();
  const [selectedRole, setSelectedRole] = useState<RoleTemplate>("readOnly");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hostRestriction, setHostRestriction] = useState<HostRestrictionType>("any");
  const [newHost, setNewHost] = useState("");
  const [allowedHosts, setAllowedHosts] = useState<string[]>([]);
  const [useCluster, setUseCluster] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState("");
  const [allowQueryLogs, setAllowQueryLogs] = useState(true); // Allow viewing own query logs

  const databases = databasesData.map((db) => db.name);
  const roles: string[] = [];

  const form = useForm<FormData>({
    defaultValues: {
      username: "",
      password: "",
      roleTemplate: "readOnly",
      grantDatabases: [],
      hostRestriction: "any",
      allowedHosts: [],
      privileges: ROLE_TEMPLATES.readOnly.privileges,
    },
  });

  const handleRoleSelect = (role: RoleTemplate) => {
    setSelectedRole(role);
    form.setValue("roleTemplate", role);
    form.setValue("privileges", ROLE_TEMPLATES[role].privileges);
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

  const generatePassword = useCallback(() => {
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
    form.setValue("password", password);
  }, [form]);

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);

    try {
      const { username, password, privileges, grantDatabases } = data;

      // Build cluster clause
      const clusterClause = useCluster && selectedCluster ? ` ON CLUSTER '${selectedCluster}'` : "";

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

      // 1. Create user with host restriction and optional cluster
      const escapedPassword = password.replace(/'/g, "\\'");
      await executeQuery.mutateAsync({
        query: `CREATE USER '${username}'${clusterClause} ${hostClause} IDENTIFIED BY '${escapedPassword}'`,
      });

      // 2. Grant privileges based on role
      if (privileges.isAdmin) {
        await executeQuery.mutateAsync({
          query: `GRANT${clusterClause} ALL ON *.* TO '${username}' WITH GRANT OPTION`,
        });
      } else {
        // If no databases selected, user won't have access to any database
        // This is intentional - they must explicitly select databases
        if (grantDatabases.length === 0) {
          toast.warning("User created without database access. Add database permissions in Edit User.");
        }

        for (const db of grantDatabases) {
          const dbTarget = `\`${db}\`.*`;

          if (privileges.allowSelect) {
            await executeQuery.mutateAsync({
              query: `GRANT${clusterClause} SELECT ON ${dbTarget} TO '${username}'`,
            });
          }

          if (privileges.allowInsert) {
            await executeQuery.mutateAsync({
              query: `GRANT${clusterClause} INSERT ON ${dbTarget} TO '${username}'`,
            });
          }

          if (privileges.allowDDL) {
            await executeQuery.mutateAsync({
              query: `GRANT${clusterClause} CREATE TABLE, DROP TABLE, ALTER TABLE ON ${dbTarget} TO '${username}'`,
            });
          }
        }

        if (privileges.allowSystem) {
          await executeQuery.mutateAsync({
            query: `GRANT${clusterClause} SYSTEM ON *.* TO '${username}'`,
          });
        }

        // Grant access to view own query logs (system.query_log)
        if (allowQueryLogs) {
          await executeQuery.mutateAsync({
            query: `GRANT${clusterClause} SELECT ON system.query_log TO '${username}'`,
          });
        }
      }

      const clusterMsg = useCluster && selectedCluster ? ` on cluster ${selectedCluster}` : "";
      toast.success(`User "${username}" created successfully with ${ROLE_TEMPLATES[selectedRole].name} role${clusterMsg}`);
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

      <FormProvider {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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

          {/* Tabs for detailed configuration */}
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
            </TabsList>

            <TabsContent value="auth">
              <GlassCard>
                <GlassCardHeader>
                  <GlassCardTitle className="flex items-center gap-2">
                    <Key className="h-5 w-5 text-yellow-400" />
                    User Credentials
                  </GlassCardTitle>
                </GlassCardHeader>
                <GlassCardContent>
                  <AuthenticationSection form={form} handleGeneratePassword={generatePassword} />
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
                </GlassCardContent>
              </GlassCard>
            </TabsContent>

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
                    <DatabaseRolesSection form={form} roles={roles} databases={databases} />
                    
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
                  </GlassCardContent>
                </GlassCard>
              </TabsContent>
            )}
          </Tabs>

          {/* Submit buttons */}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => navigate("/admin")}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="gap-2">
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
        </form>
      </FormProvider>
    </motion.div>
  );
};

export default CreateUser;
