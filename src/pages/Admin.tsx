import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import UserTable from "@/features/admin/components/UserManagement/index";
import InfoDialog from "@/components/common/InfoDialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { RbacRolesTable, RbacAuditLogs } from "@/features/rbac/components";
import ConnectionManagement from "@/features/admin/components/ConnectionManagement";
import ClickHouseUsersManagement from "@/features/admin/components/ClickHouseUsers";
import AiModelsManagement from "@/features/admin/components/AiModels";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { cn } from "@/lib/utils";
import {
  Bot,
  InfoIcon,
  ShieldCheck,
  Users,
  Shield,
  FileText,
  Server,
  UserCog,
  type LucideIcon,
} from "lucide-react";

interface AdminTabConfig {
  icon: LucideIcon;
  label: string;
  description: string;
}

type AdminTabKey =
  | "users"
  | "roles"
  | "connections"
  | "clickhouse-users"
  | "audit"
  | "ai-models";

const ADMIN_TAB_CONFIG: Record<AdminTabKey, AdminTabConfig> = {
  users: {
    icon: Users,
    label: "Users",
    description: "Manage system user accounts",
  },
  roles: {
    icon: Shield,
    label: "Roles",
    description: "System roles & permissions",
  },
  connections: {
    icon: Server,
    label: "Connections",
    description: "ClickHouse server settings",
  },
  "clickhouse-users": {
    icon: UserCog,
    label: "ClickHouse users",
    description: "Database-level accounts",
  },
  audit: {
    icon: FileText,
    label: "Audit logs",
    description: "System activity history",
  },
  "ai-models": {
    icon: Bot,
    label: "AI models",
    description: "Configure LLMs",
  },
};

interface TabCardProps {
  tabKey: AdminTabKey;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function TabCard({ tabKey, isActive, onClick, disabled }: TabCardProps) {
  const config = ADMIN_TAB_CONFIG[tabKey];
  const Icon = config.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isActive}
      className={cn(
        "group relative flex min-w-[200px] items-start gap-3 border border-ink-500 px-4 py-3 text-left transition-colors",
        "rounded-xs",
        isActive
          ? "border-ink-700 bg-ink-200 text-paper"
          : "bg-ink-100 text-paper-muted hover:border-ink-700 hover:bg-ink-200 hover:text-paper",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-xs border transition-colors",
          isActive
            ? "border-brand bg-ink-100 text-brand"
            : "border-ink-500 bg-ink-200 text-paper-muted group-hover:border-ink-700"
        )}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "truncate text-[13px] font-semibold",
            isActive ? "text-paper" : "text-paper-muted group-hover:text-paper"
          )}
        >
          {config.label}
        </span>
        <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
          {config.description}
        </span>
      </div>
    </button>
  );
}

export default function Admin() {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const { hasPermission } = useRbacStore();

  const canViewUsers = hasPermission(RBAC_PERMISSIONS.USERS_VIEW);
  const canViewRoles = hasPermission(RBAC_PERMISSIONS.ROLES_VIEW);
  const canViewAudit = hasPermission(RBAC_PERMISSIONS.AUDIT_VIEW);
  const canViewConnections = hasPermission(RBAC_PERMISSIONS.CONNECTIONS_VIEW);
  const canViewClickHouseUsers = hasPermission(RBAC_PERMISSIONS.CH_USERS_VIEW);
  const canViewAiModels = hasPermission(RBAC_PERMISSIONS.AI_MODELS_VIEW);

  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();

  const availableTabs: AdminTabKey[] = [
    ...(canViewUsers ? (["users"] as AdminTabKey[]) : []),
    ...(canViewRoles ? (["roles"] as AdminTabKey[]) : []),
    ...(canViewConnections ? (["connections"] as AdminTabKey[]) : []),
    ...(canViewClickHouseUsers ? (["clickhouse-users"] as AdminTabKey[]) : []),
    ...(canViewAiModels ? (["ai-models"] as AdminTabKey[]) : []),
    ...(canViewAudit ? (["audit"] as AdminTabKey[]) : []),
  ];

  const getInitialTab = (): AdminTabKey => {
    if (tab && availableTabs.includes(tab as AdminTabKey)) {
      return tab as AdminTabKey;
    }
    return availableTabs[0] || "users";
  };

  const activeTab = getInitialTab();

  useEffect(() => {
    if (!tab || !availableTabs.includes(tab as AdminTabKey)) {
      if (availableTabs.length > 0) {
        navigate(`/admin/${availableTabs[0]}`, { replace: true });
      }
    }
  }, [tab, availableTabs, navigate]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ink-50">
      {/* ─── Header ─── */}
      <header className="flex-none border-b border-ink-500 px-6 pb-4 pt-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
              <ShieldCheck className="h-4 w-4" aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                <span className="h-px w-6 bg-ink-700" aria-hidden />
                <span>Administration</span>
              </span>
              <h1 className="text-2xl font-semibold tracking-tight text-paper">
                Manage users, roles & access
              </h1>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsInfoOpen(true)}
            className="h-9 w-9 rounded-xs text-paper-dim hover:bg-ink-200 hover:text-paper"
            aria-label="About administration"
          >
            <InfoIcon className="h-4 w-4" />
          </Button>
        </div>

        {/* Tab cards */}
        <div className="scrollbar-hide flex gap-2 overflow-x-auto pb-0.5">
          {availableTabs.map((tabKey) => (
            <TabCard
              key={tabKey}
              tabKey={tabKey}
              isActive={activeTab === tabKey}
              onClick={() => navigate(`/admin/${tabKey}`)}
            />
          ))}
        </div>
      </header>

      {/* ─── Content ─── */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => navigate(`/admin/${v}`)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {activeTab === "users" && canViewUsers && (
            <TabsContent value="users" className="mt-0 h-full outline-none">
              <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
                <UserTable />
              </div>
            </TabsContent>
          )}

          {activeTab === "roles" && canViewRoles && (
            <TabsContent value="roles" className="mt-0 h-full outline-none">
              <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
                <RbacRolesTable onCreateRole={() => {}} onEditRole={() => {}} />
              </div>
            </TabsContent>
          )}

          {activeTab === "connections" && canViewConnections && (
            <TabsContent value="connections" className="mt-0 h-full outline-none">
              <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
                <ConnectionManagement />
              </div>
            </TabsContent>
          )}

          {activeTab === "clickhouse-users" && canViewClickHouseUsers && (
            <TabsContent value="clickhouse-users" className="mt-0 h-full outline-none">
              <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
                <ClickHouseUsersManagement />
              </div>
            </TabsContent>
          )}

          {activeTab === "ai-models" && canViewAiModels && (
            <TabsContent value="ai-models" className="mt-0 h-full outline-none">
              <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
                <AiModelsManagement />
              </div>
            </TabsContent>
          )}

          {activeTab === "audit" && canViewAudit && (
            <TabsContent value="audit" className="mt-0 h-full outline-none">
              <div className="h-full overflow-hidden rounded-md border border-ink-500 bg-ink-100">
                <RbacAuditLogs />
              </div>
            </TabsContent>
          )}
        </div>
      </Tabs>

      {/* Info dialog */}
      <InfoDialog
        title="Administration"
        isOpen={isInfoOpen}
        onClose={() => setIsInfoOpen(false)}
        variant="info"
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-paper-muted">
            Manage system users, roles, and permissions using role-based access control (RBAC).
          </p>

          <ul className="flex flex-col gap-2 text-[13px] text-paper-muted">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-paper-dim" aria-hidden />
              <span><strong className="text-paper">Users</strong> — create, edit, and manage RBAC user accounts</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-paper-dim" aria-hidden />
              <span><strong className="text-paper">Roles</strong> — view roles and their associated permissions</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-paper-dim" aria-hidden />
              <span><strong className="text-paper">Connections</strong> — manage ClickHouse server connections</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-paper-dim" aria-hidden />
              <span><strong className="text-paper">ClickHouse users</strong> — create and manage database-level users</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-paper-dim" aria-hidden />
              <span><strong className="text-paper">AI models</strong> — configure LLMs for the Assistant</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-paper-dim" aria-hidden />
              <span><strong className="text-paper">Audit logs</strong> — track all system actions for compliance</span>
            </li>
          </ul>

          <div className="rounded-xs border border-brand/30 bg-brand/[0.04] p-3">
            <p className="text-[12px] text-paper-muted">
              User management is handled through RBAC. Users authenticate against the app's internal
              database, not directly to ClickHouse.
            </p>
          </div>
        </div>
      </InfoDialog>
    </div>
  );
}
