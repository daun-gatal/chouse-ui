import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Server,
  Database,
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
import { Button } from "@/components/ui/button";
import { useAuthStore, useRbacStore } from "@/stores";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { rbacAuthApi, rbacConnectionsApi } from "@/api/rbac";
import { getSessionId } from "@/api/client";
import ConfirmationDialog from "@/components/common/ConfirmationDialog";
import { log } from "@/lib/log";

// ============================================
// Recipes
// ============================================

const EYEBROW = "inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim";
const MONO_LABEL = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim";
const MONO_FAINT = "font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint";

// ============================================
// Types & Components
// ============================================

interface SettingCardProps {
  title: string;
  description?: string;
  icon: React.ElementType;
  children: React.ReactNode;
  delay?: number;
  className?: string;
}

const SettingCard: React.FC<SettingCardProps> = ({
  title,
  description,
  icon: Icon,
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
    <div className="flex h-full flex-col overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
      <div className="flex flex-none items-center gap-3 border-b border-ink-500 px-4 py-3">
        <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <h3 className="text-[13px] font-semibold tracking-tight text-paper">{title}</h3>
          {description && <p className={MONO_FAINT}>{description}</p>}
        </div>
      </div>
      <div className="flex-1 overflow-hidden p-4">{children}</div>
    </div>
  </motion.div>
);

interface InfoRowProps {
  label: string;
  value: string | React.ReactNode;
  icon?: React.ElementType;
}

const InfoRow: React.FC<InfoRowProps> = ({ label, value, icon: Icon }) => (
  <div className="flex items-center justify-between rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5">
    <div className="flex items-center gap-2">
      {Icon && <Icon className="h-3.5 w-3.5 text-paper-dim" aria-hidden />}
      <span className={MONO_LABEL}>{label}</span>
    </div>
    <div className="text-[13px] font-medium tracking-tight text-paper">{value}</div>
  </div>
);

// ============================================
// Status footer (uniform editorial pill for card bottom)
// ============================================

const StatusFooter: React.FC<{
  label: string;
  meta: string;
  tone?: "brand" | "emerald";
}> = ({ label, meta, tone = "brand" }) => {
  const dot = tone === "emerald" ? "bg-emerald-400" : "bg-brand";
  return (
    <div className="flex items-center justify-between rounded-xs border border-ink-500 bg-ink-200 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
        <span className={MONO_LABEL}>{label}</span>
      </div>
      <span className={MONO_FAINT}>{meta}</span>
    </div>
  );
};

// ============================================
// Identity Card
// ============================================

const IdentityCard: React.FC = () => {
  const { user } = useRbacStore();

  return (
    <SettingCard
      title="Identity & access"
      description="Your personal RBAC profile"
      icon={Fingerprint}
      delay={0.1}
      className="md:col-span-1"
    >
      <div className="space-y-2">
        <InfoRow label="Username" icon={User} value={user?.username || "N/A"} />
        <InfoRow
          label="RBAC ID"
          icon={Shield}
          value={
            <span className="font-mono text-[11px] text-paper-muted">
              {user?.id?.slice(0, 12)}…
            </span>
          }
        />
        <StatusFooter label="Session active" meta="Secure" tone="emerald" />
      </div>
    </SettingCard>
  );
};

// ============================================
// Connection Card
// ============================================

const ConnectionDetailsCard: React.FC<{ url: string | null; version: string | null }> = ({
  url,
  version,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <SettingCard
      title="ClickHouse node"
      description="Current connection details"
      icon={Database}
      delay={0.2}
      className="md:col-span-2"
    >
      <div className="space-y-2">
        <InfoRow
          label="Endpoint"
          icon={Server}
          value={
            url ? (
              <div className="flex items-center gap-1.5">
                <span className="max-w-[200px] truncate font-mono text-[12px] text-paper" title={url}>
                  {url.split("://")[1] || url}
                </span>
                <button
                  onClick={handleCopy}
                  className="rounded-xs p-1 text-paper-dim transition-colors hover:bg-ink-100 hover:text-paper"
                  title="Copy to clipboard"
                  aria-label="Copy endpoint"
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </button>
              </div>
            ) : (
              <span className={MONO_FAINT}>Disconnected</span>
            )
          }
        />
        <InfoRow label="Version" icon={Cpu} value={version || "N/A"} />
        <StatusFooter label="Node operational" meta="Online" tone="emerald" />
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

  const [expandedConnections, setExpandedConnections] = useState<Record<string, boolean>>({});
  const [expandedDatabases, setExpandedDatabases] = useState<Record<string, boolean>>({});

  const toggleConnection = (id: string) => {
    setExpandedConnections((prev) => ({
      ...prev,
      [id]: prev[id] === false ? true : false,
    }));
  };

  const toggleDatabase = (connId: string, db: string) => {
    const key = `${connId}:${db}`;
    setExpandedDatabases((prev) => ({
      ...prev,
      [key]: prev[key] === false ? true : false,
    }));
  };

  const isConnectionExpanded = (id: string) => expandedConnections[id] !== false;
  const isDatabaseExpanded = (connId: string, db: string) =>
    expandedDatabases[`${connId}:${db}`] !== false;

  const groupedByConnection = useMemo(() => {
    const connMap: Record<string, Record<string, typeof allRules>> = {};
    allRules.forEach((rule) => {
      const connId = rule.connectionId || "all";
      if (!connMap[connId]) connMap[connId] = {};
      const dbPattern = rule.databasePattern || "*";
      if (!connMap[connId][dbPattern]) connMap[connId][dbPattern] = [];
      connMap[connId][dbPattern].push(rule);
    });
    return connMap;
  }, [allRules]);

  const getConnectionName = (id: string) => {
    if (id === "all") return "All connections";
    const conn = connections.find((c) => c.id === id);
    return conn?.name || `Conn: ${id.substring(0, 8)}`;
  };

  return (
    <SettingCard
      title="Data access"
      description="Database & table permissions"
      icon={Shield}
      delay={0.3}
      className="md:col-span-2 h-[450px]"
    >
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1">
          {admin || allRules.length === 0 ? (
            <div className="rounded-xs border border-ink-500 bg-ink-200 px-4 py-8 text-center">
              {admin ? (
                <>
                  <span className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-xs border border-brand/40 bg-brand/5 text-brand">
                    <Shield className="h-4 w-4" aria-hidden />
                  </span>
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-brand">
                    Full global access
                  </p>
                  <p className={cn("mt-1", MONO_FAINT)}>Admin access active</p>
                </>
              ) : (
                <p className={cn(MONO_LABEL, "tracking-[0.18em]")}>No matching rules</p>
              )}
            </div>
          ) : (
            <div className="custom-scrollbar h-full space-y-5 overflow-y-auto pr-1">
              {Object.entries(groupedByConnection).map(([connId, dbGroups]) => (
                <div key={connId} className="space-y-3">
                  {/* Connection Header */}
                  <button
                    type="button"
                    className="group/conn flex w-full items-center gap-3 text-left"
                    onClick={() => toggleConnection(connId)}
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted transition-colors group-hover/conn:border-ink-700 group-hover/conn:text-paper">
                      <Server className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper group-hover/conn:text-paper">
                      {getConnectionName(connId)}
                    </span>
                    <div className="h-px flex-1 bg-ink-500" />
                    {isConnectionExpanded(connId) ? (
                      <ChevronDown className="h-3.5 w-3.5 text-paper-faint" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-paper-faint" />
                    )}
                  </button>

                  <AnimatePresence initial={false}>
                    {isConnectionExpanded(connId) && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        className="space-y-3 overflow-hidden pl-3"
                      >
                        {Object.entries(dbGroups).map(([db, rules]) => (
                          <div key={db} className="space-y-2">
                            <button
                              type="button"
                              className="group/db flex w-fit items-center gap-2"
                              onClick={() => toggleDatabase(connId, db)}
                            >
                              <Database className="h-3 w-3 text-paper-faint transition-colors group-hover/db:text-paper-dim" />
                              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted transition-colors group-hover/db:text-paper">
                                {db === "*" ? "All databases" : db}
                              </span>
                              {isDatabaseExpanded(connId, db) ? (
                                <ChevronDown className="h-2.5 w-2.5 text-paper-faint" />
                              ) : (
                                <ChevronRight className="h-2.5 w-2.5 text-paper-faint" />
                              )}
                            </button>

                            <AnimatePresence initial={false}>
                              {isDatabaseExpanded(connId, db) && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.15, ease: "easeInOut" }}
                                  className="ml-5 grid grid-cols-1 gap-1 overflow-hidden"
                                >
                                  {rules.map((rule, i) => (
                                    <div
                                      key={i}
                                      className="flex items-center justify-between rounded-xs border border-ink-500 bg-ink-200 px-3 py-2"
                                    >
                                      <div className="flex items-center gap-2">
                                        <span
                                          className={cn(
                                            "h-1.5 w-1.5 rounded-full",
                                            rule.isAllowed ? "bg-emerald-400" : "bg-red-400",
                                          )}
                                        />
                                        <span className="font-mono text-[12px] text-paper-muted">
                                          {rule.tablePattern === "*" ? "All tables" : rule.tablePattern}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        {rule.accessType !== "read" && (
                                          <span className="rounded-xs border border-ink-500 bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
                                            {rule.accessType}
                                          </span>
                                        )}
                                        <span
                                          className={cn(
                                            "inline-flex items-center rounded-xs px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
                                            rule.isAllowed
                                              ? "border border-emerald-900/60 bg-emerald-950/40 text-emerald-300"
                                              : "border border-red-900/60 bg-red-950/40 text-red-300",
                                          )}
                                        >
                                          {rule.isAllowed ? "Allow" : "Deny"}
                                        </span>
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
        <div className="flex-none pt-3">
          <StatusFooter
            label="Active policy engine"
            meta={`${allRules.length} ${allRules.length === 1 ? "rule" : "rules"} applied`}
          />
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
    permissions.forEach((p) => {
      const [category] = p.split(":");
      if (!cats[category]) cats[category] = [];
      cats[category].push(p.split(":").slice(1).join(" "));
    });
    return cats;
  }, [permissions]);

  return (
    <SettingCard
      title="Functional access"
      description="Application capabilities"
      icon={Fingerprint}
      delay={0.4}
      className="md:col-span-1 h-[450px]"
    >
      <div className="flex h-full flex-col">
        <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto pr-1">
          {Object.entries(categories).map(([cat, perms]) => (
            <div key={cat} className="rounded-xs border border-ink-500 bg-ink-200 p-2.5">
              <p className={cn("mb-2 block", MONO_LABEL)}>{cat}</p>
              <div className="flex flex-wrap gap-1.5">
                {perms.map((p) => (
                  <span
                    key={p}
                    className="rounded-xs border border-ink-500 bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {Object.keys(categories).length === 0 && (
            <div className="rounded-xs border border-ink-500 bg-ink-200 px-4 py-8 text-center">
              <p className={cn(MONO_LABEL, "tracking-[0.18em]")}>No permissions assigned</p>
            </div>
          )}
        </div>
        <div className="flex-none pt-3">
          <StatusFooter label="Permissions visualized" meta={`${permissions.length} total`} />
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
  const { logout: rbacLogout, user: storeUser, isAdmin } = useRbacStore();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["rbac-profile"],
    queryFn: () => rbacAuthApi.getProfile(),
  });

  const user = profile?.user || storeUser;
  const connections = profile?.connections || [];
  const allRules = profile?.dataAccessRules || [];
  const rolesMetadata = user?.rolesMetadata || [];

  const getRoleDisplayName = (roleName: string) => {
    const meta = rolesMetadata.find((m) => m.name === roleName);
    if (meta?.displayName) return meta.displayName;
    return roleName
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  // Initials chip from displayName/username
  const initials = useMemo(() => {
    const name = user?.displayName || user?.username || "";
    return (
      name
        .split(/[\s._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((s: string) => s[0]?.toUpperCase() || "")
        .join("") || "U"
    );
  }, [user?.displayName, user?.username]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const sessionId = getSessionId();
      if (sessionId) {
        try {
          await rbacConnectionsApi.disconnect(sessionId);
        } catch (error) {
          log.error("Failed to disconnect ClickHouse connection:", error);
        }
      }
      await rbacLogout();
      useAuthStore.getState().clearConnectionInfo();
    } catch (error) {
      log.error("Logout error:", error);
      useAuthStore.getState().clearConnectionInfo();
    } finally {
      setIsLoggingOut(false);
      navigate("/login");
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
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
      <div className="flex-none border-b border-ink-500 bg-ink-50">
        <div className="px-6 pb-4 pt-6">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-center justify-between gap-6"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                <UserCog className="h-4 w-4" aria-hidden />
              </span>
              <div className="flex flex-col gap-0.5">
                <h1 className="text-[18px] font-semibold tracking-tight text-paper">Preferences</h1>
                <p className={MONO_FAINT}>Manage your identity and workspace environment</p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLogoutConfirm(true)}
              className="h-9 gap-2 rounded-xs border-ink-500 bg-ink-100 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted transition-colors hover:border-red-900/60 hover:bg-red-950/40 hover:text-red-300"
            >
              <LogOut className="h-3.5 w-3.5" />
              Log out
            </Button>
          </motion.div>
        </div>
      </div>

      {/* Content Area */}
      <div className="custom-scrollbar flex-1 overflow-y-auto px-6 py-6 pb-24">
        <div className="mx-auto max-w-6xl space-y-6">
          {/* Profile Hero Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100"
          >
            <div className="flex flex-col items-start gap-6 p-6 md:flex-row md:items-center md:p-8">
              <div className="relative">
                <span className="grid h-20 w-20 place-items-center rounded-xs border border-ink-500 bg-ink-200 font-mono text-[28px] font-semibold tracking-tight text-paper">
                  {initials}
                </span>
                <span
                  className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full border border-ink-100 bg-ink-200"
                  aria-label="Online"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                </span>
              </div>

              <div className="flex-1 space-y-3">
                <div className="space-y-1">
                  <span className={EYEBROW}>
                    <span className="h-px w-6 bg-ink-700" />
                    <span>Profile</span>
                  </span>
                  <h2 className="text-[28px] font-semibold tracking-tight text-paper">
                    {user?.displayName || user?.username || "Commander"}
                  </h2>
                  <div className="flex flex-wrap items-center gap-3 text-[13px] text-paper-muted">
                    <div className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
                      <span className="font-mono">{user?.email || "no-email@clickhouse.ui"}</span>
                    </div>
                    <span className="h-1 w-1 rounded-full bg-paper-faint" aria-hidden />
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
                      <span className={MONO_FAINT}>
                        Joined{" "}
                        {user?.createdAt
                          ? new Date(user.createdAt).toLocaleDateString(undefined, {
                              month: "long",
                              year: "numeric",
                            })
                          : "Recently"}
                      </span>
                    </div>
                  </div>
                </div>

                {user?.roles && user.roles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {user.roles.map((role) => (
                      <span
                        key={role}
                        className="inline-flex items-center gap-1.5 rounded-xs border border-brand/40 bg-brand/5 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-brand"
                      >
                        <Shield className="h-3 w-3" aria-hidden />
                        {getRoleDisplayName(role)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {/* Preferences Grid */}
          <div className="grid items-start gap-6 md:grid-cols-3">
            <IdentityCard />
            <ConnectionDetailsCard url={url} version={version} />
            <DataAccessCard rules={allRules} connections={connections} isAdmin={isAdmin()} />
            <EffectivePermissionsCard permissions={user?.permissions || []} />
          </div>
        </div>
      </div>
    </div>
  );
}
