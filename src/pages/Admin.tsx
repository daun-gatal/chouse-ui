import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import UserTable from "@/features/admin/components/UserManagement/index";
import { InfoIcon, ShieldCheck, Users, Shield, FileText, Server, UserCog } from "lucide-react";
import InfoDialog from "@/components/common/InfoDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GlassCard, GlassCardContent } from "@/components/ui/glass-card";
import { motion, AnimatePresence } from "framer-motion";
import { RbacRolesTable, RbacAuditLogs } from "@/features/rbac/components";
import ConnectionManagement from "@/features/admin/components/ConnectionManagement";
import ClickHouseUsersManagement from "@/features/admin/components/ClickHouseUsers";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { cn } from "@/lib/utils";

// Tab configuration for Admin
const ADMIN_TAB_CONFIG = {
  "users": {
    icon: Users,
    label: "Users",
    description: "Manage system user accounts",
    color: "purple",
    gradient: "from-purple-500 to-pink-600",
    bgGlow: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    textColor: "text-purple-300",
  },
  "roles": {
    icon: Shield,
    label: "Roles",
    description: "System roles & permissions",
    color: "blue",
    gradient: "from-blue-500 to-indigo-600",
    bgGlow: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    textColor: "text-blue-300",
  },
  "connections": {
    icon: Server,
    label: "Connections",
    description: "ClickHouse server settings",
    color: "cyan",
    gradient: "from-cyan-500 to-blue-600",
    bgGlow: "bg-cyan-500/10",
    borderColor: "border-cyan-500/30",
    textColor: "text-cyan-300",
  },
  "clickhouse-users": {
    icon: UserCog,
    label: "ClickHouse Users",
    description: "Database level accounts",
    color: "indigo",
    gradient: "from-indigo-500 to-purple-600",
    bgGlow: "bg-indigo-500/10",
    borderColor: "border-indigo-500/30",
    textColor: "text-indigo-300",
  },
  "audit": {
    icon: FileText,
    label: "Audit Logs",
    description: "System activity history",
    color: "green",
    gradient: "from-green-500 to-emerald-600",
    bgGlow: "bg-green-500/10",
    borderColor: "border-green-500/30",
    textColor: "text-green-300",
  },
} as const;

type AdminTabKey = keyof typeof ADMIN_TAB_CONFIG;

function TabCard({
  tabKey,
  isActive,
  onClick,
  disabled = false,
}: {
  tabKey: AdminTabKey;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const config = ADMIN_TAB_CONFIG[tabKey];
  const Icon = config.icon;

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      className={cn(
        "relative flex flex-col items-start p-4 rounded-xl border transition-all duration-300 text-left min-w-[180px]",
        isActive ? [
          config.bgGlow,
          config.borderColor,
          "shadow-lg",
        ] : [
          "bg-white/5",
          "border-white/10",
          "hover:bg-white/10",
          "hover:border-white/20",
        ],
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {/* Active indicator glow */}
      {isActive && (
        <motion.div
          layoutId="activeTabGlowAdmin"
          className={cn(
            "absolute inset-0 rounded-xl",
            config.bgGlow,
            "opacity-50 blur-sm"
          )}
          transition={{ type: "spring", duration: 0.4 }}
        />
      )}

      <div className="relative z-10 flex items-center gap-3 w-full">
        <div className={cn(
          "p-2 rounded-lg",
          isActive ? `bg-gradient-to-br ${config.gradient}` : "bg-white/10"
        )}>
          <Icon className={cn(
            "w-5 h-5",
            isActive ? "text-white" : "text-gray-400"
          )} />
        </div>

        <div className="flex-1 min-w-0">
          <span className={cn(
            "font-semibold text-sm block truncate",
            isActive ? "text-white" : "text-gray-300"
          )}>
            {config.label}
          </span>
          <p className={cn(
            "text-xs truncate mt-0.5",
            isActive ? config.textColor : "text-gray-500"
          )}>
            {config.description}
          </p>
        </div>
      </div>

      {/* Active indicator line */}
      {isActive && (
        <motion.div
          layoutId="activeTabLineAdmin"
          className={cn(
            "absolute bottom-0 left-4 right-4 h-0.5 rounded-full",
            `bg-gradient-to-r ${config.gradient}`
          )}
          transition={{ type: "spring", duration: 0.4 }}
        />
      )}
    </motion.button>
  );
}

export default function Admin() {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const { hasPermission } = useRbacStore();

  // Permission checks for tabs
  const canViewUsers = hasPermission(RBAC_PERMISSIONS.USERS_VIEW);
  const canViewRoles = hasPermission(RBAC_PERMISSIONS.ROLES_VIEW);
  const canViewAudit = hasPermission(RBAC_PERMISSIONS.AUDIT_VIEW);
  const canViewConnections = hasPermission(RBAC_PERMISSIONS.CONNECTIONS_VIEW);
  const canViewClickHouseUsers = hasPermission(RBAC_PERMISSIONS.CH_USERS_VIEW);

  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();

  const availableTabs: AdminTabKey[] = [
    ...(canViewUsers ? ["users" as const] : []),
    ...(canViewRoles ? ["roles" as const] : []),
    ...(canViewConnections ? ["connections" as const] : []),
    ...(canViewClickHouseUsers ? ["clickhouse-users" as const] : []),
    ...(canViewAudit ? ["audit" as const] : []),
  ];

  const getInitialTab = (): AdminTabKey => {
    if (tab && availableTabs.includes(tab as AdminTabKey)) {
      return tab as AdminTabKey;
    }
    return availableTabs[0] || "users";
  };

  const activeTab = getInitialTab();

  useEffect(() => {
    // If there's no tab in the URL, or it's invalid, redirect to the first available tab
    if (!tab || !availableTabs.includes(tab as AdminTabKey)) {
      if (availableTabs.length > 0) {
        navigate(`/admin/${availableTabs[0]}`, { replace: true });
      }
    }
  }, [tab, availableTabs, navigate]);

  const currentTabConfig = ADMIN_TAB_CONFIG[activeTab];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="h-full w-full flex flex-col overflow-hidden"
    >
      {/* Sticky Header & Tabs Area */}
      <div className="flex-none z-10 backdrop-blur-md bg-black/10">
        <div className="px-6 pt-6 pb-4 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className={cn(
                  "p-3 rounded-2xl shadow-lg ring-1 ring-white/10",
                  `bg-gradient-to-br ${currentTabConfig.gradient}`,
                )}>
                  <ShieldCheck className="w-7 h-7 text-white" />
                </div>
                <div className={cn(
                  "absolute inset-0 rounded-2xl animate-ping opacity-20",
                  `bg-${currentTabConfig.color}-500`
                )} style={{ animationDuration: "2s" }} />
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-white">Administration</h1>
                <p className="text-gray-400 text-sm mt-0.5">Manage users, roles, and system configurations</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsInfoOpen(true)}
              className="text-gray-400 hover:text-white hover:bg-white/10"
            >
              <InfoIcon className="w-5 h-5" />
            </Button>
          </div>

          {/* Tab Navigation Cards */}
          <div className="flex gap-3 overflow-x-auto px-1 pt-2 pb-2 scrollbar-hide">
            {availableTabs.map((tabKey) => (
              <TabCard
                key={tabKey}
                tabKey={tabKey}
                isActive={activeTab === tabKey}
                onClick={() => navigate(`/admin/${tabKey}`)}
              />
            ))}
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => navigate(`/admin/${v}`)} className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar px-6 py-6 pb-24">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              {activeTab === "users" && canViewUsers && (
                <TabsContent value="users" className="h-full mt-0 outline-none">
                  <div className="rounded-xl overflow-hidden bg-white/5 border border-white/10 glass-effect">
                    <UserTable />
                  </div>
                </TabsContent>
              )}

              {activeTab === "roles" && canViewRoles && (
                <TabsContent value="roles" className="h-full mt-0 outline-none">
                  <div className="rounded-xl overflow-hidden bg-white/5 border border-white/10 glass-effect">
                    <RbacRolesTable
                      onCreateRole={() => { }}
                      onEditRole={() => { }}
                    />
                  </div>
                </TabsContent>
              )}

              {activeTab === "connections" && canViewConnections && (
                <TabsContent value="connections" className="h-full mt-0 outline-none">
                  <div className="rounded-xl overflow-hidden bg-white/5 border border-white/10 glass-effect">
                    <ConnectionManagement />
                  </div>
                </TabsContent>
              )}

              {activeTab === "clickhouse-users" && canViewClickHouseUsers && (
                <TabsContent value="clickhouse-users" className="h-full mt-0 outline-none">
                  <div className="rounded-xl overflow-hidden bg-white/5 border border-white/10 glass-effect">
                    <ClickHouseUsersManagement />
                  </div>
                </TabsContent>
              )}

              {activeTab === "audit" && canViewAudit && (
                <TabsContent value="audit" className="h-full mt-0 outline-none">
                  <div className="rounded-xl overflow-hidden bg-white/5 border border-white/10 glass-effect">
                    <RbacAuditLogs />
                  </div>
                </TabsContent>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </Tabs>

      <InfoDialog
        title="Administration"
        isOpen={isInfoOpen}
        onClose={() => setIsInfoOpen(false)}
        variant="info"
      >
        <div className="flex flex-col gap-3">
          <p className="text-gray-300">
            Manage system users, roles, and permissions using role-based access control (RBAC).
          </p>
          <ul className="text-sm text-gray-400 space-y-1">
            <li>• <strong>Users</strong> - Create, edit, and manage RBAC user accounts</li>
            <li>• <strong>Roles</strong> - View roles and their associated permissions</li>
            <li>• <strong>Connections</strong> - Manage ClickHouse server connections</li>
            <li>• <strong>ClickHouse Users</strong> - Create and manage ClickHouse database users</li>
            <li>• <strong>Audit Logs</strong> - Track all system actions for compliance</li>
          </ul>
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <p className="text-sm text-blue-200">
              User management is now handled through RBAC. Users authenticate against the Studio's
              internal database, not directly to ClickHouse.
            </p>
          </div>
        </div>
      </InfoDialog>
    </motion.div>
  );
}

