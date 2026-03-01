import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Server,
  Database,
  ExternalLink,
  Keyboard,
  LogOut,
  User,
  Mail,
  Shield,
  Calendar,
  UserCog,
  Fingerprint,
  Cpu,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuthStore, useRbacStore } from "@/stores";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { rbacAuthApi, rbacConnectionsApi } from "@/api/rbac";
import { getSessionId } from "@/api/client";
import ConfirmationDialog from "@/components/common/ConfirmationDialog";
import { GlassCard } from "@/components/ui/glass-card";
import { log } from "@/lib/log";

// ============================================
// Types & Components
// ============================================

interface SettingCardProps {
  title: string;
  description?: string;
  icon: React.ElementType;
  color: string;
  children: React.ReactNode;
  delay?: number;
  className?: string;
}

const SettingCard: React.FC<SettingCardProps> = ({
  title,
  description,
  icon: Icon,
  color,
  children,
  delay = 0,
  className,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay }}
    className={cn("h-full", className)}
  >
    <GlassCard className="h-full overflow-hidden group hover:border-white/10 transition-all duration-300 bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl flex flex-col">
      <div className="flex-none flex items-center gap-3 p-4 border-b border-white/5 bg-white/[0.02]">
        <div className={cn("p-2 rounded-lg ring-1 ring-white/10 shadow-lg", color)}>
          <Icon className="h-4 w-4 text-white" />
        </div>
        <div>
          <h3 className="font-bold text-white group-hover:text-purple-300 transition-colors text-sm">{title}</h3>
          {description && <p className="text-xs text-gray-500 font-medium">{description}</p>}
        </div>
      </div>
      <div className="flex-1 p-4 overflow-hidden">{children}</div>
    </GlassCard>
  </motion.div>
);

interface InfoRowProps {
  label: string;
  value: string | React.ReactNode;
  icon?: React.ElementType;
}

const InfoRow: React.FC<InfoRowProps> = ({ label, value, icon: Icon }) => (
  <div className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] transition-all duration-200 border border-white/5">
    <div className="flex items-center gap-2.5">
      {Icon && <Icon className="h-4 w-4 text-gray-400" />}
      <span className="text-sm text-gray-400 font-semibold">{label}</span>
    </div>
    <div className="text-sm text-white font-bold tracking-tight">{value}</div>
  </div>
);

// ============================================
// Identity Card
// ============================================

const IdentityCard: React.FC = () => {
  const { user } = useRbacStore();

  return (
    <SettingCard
      title="Identity & Access"
      description="Your personal RBAC profile"
      icon={Fingerprint}
      color="bg-indigo-600"
      delay={0.1}
      className="md:col-span-1"
    >
      <div className="space-y-3">
        <InfoRow
          label="Username"
          icon={User}
          value={user?.username || "N/A"}
        />
        <InfoRow
          label="RBAC ID"
          icon={Shield}
          value={<span className="font-mono text-xs">{user?.id?.slice(0, 12)}...</span>}
        />
        <div className="p-3 rounded-xl bg-indigo-500/5 border border-indigo-500/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
            <span className="text-xs font-bold text-indigo-500">Session Active</span>
          </div>
          <span className="text-xs text-gray-500 font-mono font-medium">Secure</span>
        </div>
      </div>
    </SettingCard>
  );
};

// ============================================
// Connection Card
// ============================================

const ConnectionDetailsCard: React.FC<{ url: string | null; version: string | null }> = ({ url, version }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <SettingCard
      title="ClickHouse Node"
      description="Current connection details"
      icon={Database}
      color="bg-blue-600"
      delay={0.2}
      className="md:col-span-2"
    >
      <div className="space-y-3">
        <InfoRow
          label="Endpoint"
          icon={Server}
          value={
            url ? (
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-sm truncate max-w-[150px]" title={url}>
                  {url.split('://')[1] || url}
                </span>
                <button
                  onClick={handleCopy}
                  className="text-indigo-400 hover:text-white transition-colors p-1 hover:bg-white/5 rounded-md"
                  title="Copy to clipboard"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            ) : "Disconnected"
          }
        />
        <InfoRow
          label="Version"
          icon={Cpu}
          value={version || "N/A"}
        />
        <div className="p-3 rounded-xl bg-green-500/5 border border-green-500/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
            <span className="text-xs font-bold text-green-500">Node Operational</span>
          </div>
          <span className="text-xs text-gray-500 font-mono font-medium">Online</span>
        </div>
      </div>
    </SettingCard>
  );
};

// ============================================
// Data Access Card
// ============================================

const DataAccessCard: React.FC<{
  rules: any[];
  connections: any[];
  isAdmin: boolean;
}> = ({ rules: allRules, connections, isAdmin }) => {
  const admin = isAdmin;

  // State for expanded sections - default to all expanded
  const [expandedConnections, setExpandedConnections] = useState<Record<string, boolean>>({});
  const [expandedDatabases, setExpandedDatabases] = useState<Record<string, boolean>>({});

  const toggleConnection = (id: string) => {
    setExpandedConnections(prev => ({
      ...prev,
      [id]: prev[id] === false ? true : false // default is true if undefined
    }));
  };

  const toggleDatabase = (connId: string, db: string) => {
    const key = `${connId}:${db}`;
    setExpandedDatabases(prev => ({
      ...prev,
      [key]: prev[key] === false ? true : false // default is true if undefined
    }));
  };

  const isConnectionExpanded = (id: string) => expandedConnections[id] !== false;
  const isDatabaseExpanded = (connId: string, db: string) => expandedDatabases[`${connId}:${db}`] !== false;

  // Group by Connection ID -> then by Database Pattern
  const groupedByConnection = useMemo(() => {
    const connMap: Record<string, Record<string, typeof allRules>> = {};

    allRules.forEach(rule => {
      const connId = rule.connectionId || "all";
      if (!connMap[connId]) connMap[connId] = {};

      const dbPattern = rule.databasePattern || "*";
      if (!connMap[connId][dbPattern]) connMap[connId][dbPattern] = [];

      connMap[connId][dbPattern].push(rule);
    });

    return connMap;
  }, [allRules]);

  const getConnectionName = (id: string) => {
    if (id === "all") return "All Connections";
    const conn = connections.find(c => c.id === id);
    return conn?.name || `Conn: ${id.substring(0, 8)}`;
  };

  return (
    <SettingCard
      title="Data Access"
      description="Database & Table Permissions"
      icon={Shield}
      color="bg-purple-600"
      delay={0.3}
      className="md:col-span-2 h-[450px]"
    >
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">
          {admin || allRules.length === 0 ? (
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5 text-center">
              {admin ? (
                <>
                  <div className="flex justify-center mb-2">
                    <div className="p-2 rounded-full bg-indigo-500/20 ring-1 ring-indigo-500/40">
                      <Shield className="h-5 w-5 text-indigo-400" />
                    </div>
                  </div>
                  <p className="text-xs text-indigo-400 font-black tracking-wider">Full Global Access</p>
                  <p className="text-[10px] text-gray-500 mt-1 font-bold">Admin Access Active</p>
                </>
              ) : (
                <p className="text-xs text-gray-500 font-bold tracking-wide">No matching rules</p>
              )}
            </div>
          ) : (
            <div className="h-full overflow-y-auto custom-scrollbar pr-1 space-y-6">
              {Object.entries(groupedByConnection).map(([connId, dbGroups]) => (
                <div key={connId} className="space-y-4">
                  {/* Connection Header */}
                  <div
                    className="flex items-center gap-3 cursor-pointer group/conn"
                    onClick={() => toggleConnection(connId)}
                  >
                    {/* ... existing content ... */}
                    <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 group-hover/conn:bg-indigo-500/20 transition-colors">
                      <Server className="h-3.5 w-3.5 text-indigo-400" />
                    </div>
                    <span className="text-xs font-black text-indigo-300 tracking-wider group-hover/conn:text-indigo-200 transition-colors">
                      {getConnectionName(connId)}
                    </span>
                    <div className="h-px flex-1 bg-gradient-to-r from-indigo-500/30 to-transparent" />
                    {isConnectionExpanded(connId) ? (
                      <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
                    )}
                  </div>

                  {/* Databases under this connection */}
                  <AnimatePresence initial={false}>
                    {isConnectionExpanded(connId) && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className="overflow-hidden pl-4 space-y-4"
                      >
                        {Object.entries(dbGroups).map(([db, rules]) => (
                          <div key={db} className="space-y-2">
                            <div
                              className="flex items-center gap-2 cursor-pointer group/db w-fit"
                              onClick={() => toggleDatabase(connId, db)}
                            >
                              <Database className="h-3 w-3 text-purple-400/60 group-hover/db:text-purple-400 transition-colors" />
                              <span className="text-[10px] text-purple-400 font-bold group-hover/db:text-purple-300 transition-colors">
                                {db === "*" ? "All Databases" : db}
                              </span>
                              {isDatabaseExpanded(connId, db) ? (
                                <ChevronDown className="h-2.5 w-2.5 text-gray-600" />
                              ) : (
                                <ChevronRight className="h-2.5 w-2.5 text-gray-600" />
                              )}
                            </div>

                            <AnimatePresence initial={false}>
                              {isDatabaseExpanded(connId, db) && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2, ease: "easeInOut" }}
                                  className="overflow-hidden grid grid-cols-1 gap-1.5 ml-5"
                                >
                                  {rules.map((rule, i) => (
                                    <div key={i} className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.02] border border-white/5 group hover:border-white/10 transition-colors">
                                      <div className="flex items-center gap-3">
                                        <div className={cn(
                                          "w-1.5 h-1.5 rounded-full",
                                          rule.isAllowed ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]"
                                        )} />
                                        <span className="text-xs text-gray-300 font-medium">
                                          {rule.tablePattern === "*" ? "All Tables" : rule.tablePattern}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {rule.accessType !== 'read' && (
                                          <Badge className="px-1.5 py-0 rounded text-[9px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                            {rule.accessType}
                                          </Badge>
                                        )}
                                        <Badge className={cn(
                                          "px-1.5 py-0 rounded text-[9px] font-bold",
                                          rule.isAllowed
                                            ? "bg-green-500/10 text-green-400 border border-green-500/20"
                                            : "bg-red-500/10 text-red-400 border border-red-500/20"
                                        )}>
                                          {rule.isAllowed ? "Allow" : "Deny"}
                                        </Badge>
                                      </div>
                                    </div>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex-none pt-4">
          <div className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]" />
              <span className="text-xs font-bold text-purple-500">Active Policy Engine</span>
            </div>
            <span className="text-xs text-gray-500 font-mono font-medium">{allRules.length} Rules Applied</span>
          </div>
        </div>
      </div>
    </SettingCard>
  );
};

// ============================================
// Functional Permissions Card
// ============================================

const EffectivePermissionsCard: React.FC<{ permissions: string[] }> = ({ permissions = [] }) => {

  const categories = useMemo(() => {
    const cats: Record<string, string[]> = {};
    permissions.forEach(p => {
      const [category] = p.split(':');
      if (!cats[category]) cats[category] = [];
      cats[category].push(p.split(':').slice(1).join(' '));
    });
    return cats;
  }, [permissions]);

  return (
    <SettingCard
      title="Functional Access"
      description="Application Capabilities"
      icon={Fingerprint}
      color="bg-emerald-600"
      delay={0.4}
      className="md:col-span-1 h-[450px]"
    >
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-3">
          <div className="flex flex-wrap gap-2">
            {Object.entries(categories).map(([cat, perms]) => (
              <div key={cat} className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-white/[0.03] border border-white/5 w-full">
                <span className="w-full text-[10px] text-emerald-500 font-black tracking-wider mb-1">
                  {cat}
                </span>
                {perms.map(p => (
                  <Badge key={p} variant="outline" className="text-[10px] bg-white/5 border-white/10 text-gray-300 font-bold">
                    {p}
                  </Badge>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex-none pt-4">
          <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
              <span className="text-xs font-bold text-emerald-500">Permissions Visualized</span>
            </div>
            <span className="text-xs text-gray-500 font-mono font-medium">{permissions.length} Total</span>
          </div>
        </div>
      </div>
    </SettingCard>
  );
};

// ============================================
// Main Component
// ============================================

export default function Preferences() {
  const navigate = useNavigate();
  const { url, version } = useAuthStore();
  const { logout: rbacLogout, user: storeUser, isSuperAdmin, isAdmin } = useRbacStore();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["rbac-profile"],
    queryFn: () => rbacAuthApi.getProfile(),
  });

  const user = profile?.user || storeUser;
  const connections = profile?.connections || [];
  const allRules = profile?.dataAccessRules || [];
  const rolesMetadata = user?.rolesMetadata || [];

  const getRoleDisplayName = (roleName: string) => {
    const meta = rolesMetadata.find(m => m.name === roleName);
    if (meta?.displayName) return meta.displayName;

    // Minimal fallback
    return roleName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const sessionId = getSessionId();
      if (sessionId) {
        try {
          await rbacConnectionsApi.disconnect(sessionId);
        } catch (error) {
          log.error('Failed to disconnect ClickHouse connection:', error);
        }
      }
      await rbacLogout();
      useAuthStore.getState().clearConnectionInfo();
    } catch (error) {
      log.error('Logout error:', error);
      useAuthStore.getState().clearConnectionInfo();
    } finally {
      setIsLoggingOut(false);
      navigate("/login");
    }
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden relative">
      <ConfirmationDialog
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
        title="Log out"
        description="Are you sure you want to log out?"
        confirmText={isLoggingOut ? "Logging out..." : "Log out"}
        cancelText="Cancel"
        variant="danger"
      />

      {/* Header */}
      <div className="flex-none z-20 backdrop-blur-md bg-black/10">
        <div className="px-6 pt-6 pb-4">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex items-center justify-between gap-6 mb-2"
          >
            <div className="flex-1 flex items-center gap-4">
              <div className="relative">
                <div className={cn(
                  "p-3 rounded-2xl shadow-lg ring-1 ring-white/20",
                  "bg-gradient-to-br from-indigo-500 to-purple-600",
                  "shadow-indigo-500/20"
                )}>
                  <UserCog className="w-7 h-7 text-white" />
                </div>
                <div className={cn(
                  "absolute inset-0 rounded-2xl animate-ping opacity-20 bg-indigo-500"
                )} style={{ animationDuration: "2s" }} />
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-white">
                  Preferences
                </h1>
                <p className="text-gray-400 text-sm mt-0.5 font-medium">
                  Manage your identity and workspace environment
                </p>
              </div>
            </div>

            <div className="flex-none">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowLogoutConfirm(true)}
                className="gap-2 border-white/5 bg-white/[0.03] text-gray-500 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all duration-300 rounded-xl group backdrop-blur-sm"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="font-bold text-[10px]">Log out</span>
              </Button>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-6 pb-24 relative z-10">
        <div className="max-w-6xl mx-auto space-y-6">

          {/* Profile Hero Section */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <GlassCard className="border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl relative overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />

              <div className="p-8 flex flex-col md:flex-row items-start md:items-center gap-8 relative z-10">
                <div className="relative">
                  <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-2xl ring-4 ring-white/10 group-hover:scale-105 transition-transform duration-500">
                    <User className="w-12 h-12 text-white" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 p-1.5 rounded-full bg-[#0a0a0a] ring-1 ring-white/10">
                    <div className="w-4 h-4 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)] animate-pulse" />
                  </div>
                </div>

                <div className="flex-1 space-y-4">
                  <div className="space-y-1">
                    <h2 className="text-4xl font-extrabold text-white tracking-tight">
                      {user?.displayName || user?.username || "Commander"}
                    </h2>
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2 text-gray-400 text-base font-medium">
                        <Mail className="w-4 h-4" />
                        {user?.email || "no-email@clickhouse.ui"}
                      </div>
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-700" />
                      <div className="flex items-center gap-2 text-gray-400 text-base font-medium">
                        <Calendar className="w-4 h-4" />
                        Joined {user?.createdAt ? new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : "Recently"}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    {user?.roles?.map((role) => (
                      <Badge key={role} className="bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 px-4 py-1.5 rounded-full text-xs font-bold backdrop-blur-sm">
                        <Shield className="w-3.5 h-3.5 mr-2" />
                        {getRoleDisplayName(role)}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>

          {/* Preferences Grid */}
          <div className="grid gap-6 md:grid-cols-3 items-start relative">
            <div className="absolute top-1/2 left-1/4 w-[400px] h-[400px] bg-indigo-500/5 blur-[120px] rounded-full pointer-events-none -translate-x-1/2 -translate-y-1/2" />
            <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] bg-purple-500/5 blur-[100px] rounded-full pointer-events-none translate-x-1/2 translate-y-1/2" />

            <IdentityCard />
            <ConnectionDetailsCard url={url} version={version} />
            <DataAccessCard
              rules={allRules}
              connections={connections}
              isAdmin={isAdmin()}
            />
            <EffectivePermissionsCard permissions={user?.permissions || []} />
          </div>

        </div>
      </div>
    </div>
  );
}
