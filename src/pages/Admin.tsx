import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import UserTable from "@/features/admin/components/UserManagement/index";
import InfoDialog from "@/components/common/InfoDialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { RbacRolesTable, RbacAuditLogs } from "@/features/rbac/components";
import ConnectionManagement from "@/features/admin/components/ConnectionManagement";
import { DataAccessPolicies } from "@/features/admin/components/DataAccessPolicies";
import ClickHouseUsersManagement from "@/features/admin/components/ClickHouseUsers";
import ClickHouseRolesManagement from "@/features/admin/components/ClickHouseRoles";
import AiModelsManagement from "@/features/admin/components/AiModels";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { cn } from "@/lib/utils";
import {
  Bot,
  InfoIcon,
  ShieldCheck,
  Users,
  Shield,
  Database,
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
  | "data-access"
  | "connections"
  | "clickhouse-users"
  | "clickhouse-roles"
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
  "data-access": {
    icon: Database,
    label: "Data access",
    description: "Database & table policies",
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
  "clickhouse-roles": {
    icon: Shield,
    label: "ClickHouse roles",
    description: "Native role privileges",
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

// Two-tier navigation. Sections are clustered into labelled groups; the group
// row is the top level, and the active group's sections appear below as a
// sub-tab strip (mirroring Monitoring's top-pill → in-page sub-tab pattern).
// The top row stays at a handful of groups no matter how many sections exist —
// a new feature slots into an existing group (or a new one) instead of crowding
// a flat row.
interface AdminTabGroup {
  label: string;
  icon: LucideIcon;
  tabs: AdminTabKey[];
}

const ADMIN_TAB_GROUPS: AdminTabGroup[] = [
  { label: "Access control", icon: Shield, tabs: ["users", "roles", "data-access"] },
  { label: "CH Management", icon: Server, tabs: ["connections", "clickhouse-users", "clickhouse-roles"] },
  { label: "Intelligence", icon: Bot, tabs: ["ai-models"] },
  { label: "Security", icon: FileText, tabs: ["audit"] },
];

// Top-level group selector — segmented chip (icon + label), active one filled.
interface GroupChipProps {
  group: AdminTabGroup;
  isActive: boolean;
  onClick: () => void;
}

function GroupChip({ group, isActive, onClick }: GroupChipProps) {
  const Icon = group.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-2 rounded-xs border px-3 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
        isActive
          ? "border-ink-500 bg-ink-200 text-paper"
          : "border-transparent text-paper-muted hover:bg-ink-100 hover:text-paper"
      )}
    >
      <Icon
        className={cn("h-3.5 w-3.5", isActive ? "text-brand" : "text-paper-dim")}
        aria-hidden
      />
      <span>{group.label}</span>
    </button>
  );
}

// Second-level section selector — Monitoring's in-page sub-tab style: label +
// hint, brand underline on the active one.
interface SectionTabProps {
  tabKey: AdminTabKey;
  isActive: boolean;
  onClick: () => void;
}

function SectionTab({ tabKey, isActive, onClick }: SectionTabProps) {
  const config = ADMIN_TAB_CONFIG[tabKey];

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group relative flex shrink-0 items-center gap-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
        isActive ? "text-paper" : "text-paper-muted hover:text-paper"
      )}
    >
      <span>{config.label}</span>
      <span className="hidden font-mono text-[9px] tracking-[0.14em] text-paper-faint sm:inline">
        · {config.description}
      </span>
      {isActive && (
        <span
          className="absolute -bottom-px left-0 right-0 h-px bg-brand"
          aria-hidden
        />
      )}
    </button>
  );
}

export default function Admin() {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const { hasPermission } = useRbacStore();

  const canViewUsers = hasPermission(RBAC_PERMISSIONS.USERS_VIEW);
  const canViewRoles = hasPermission(RBAC_PERMISSIONS.ROLES_VIEW);
  const canViewDataAccess = hasPermission(RBAC_PERMISSIONS.DATA_ACCESS_VIEW);
  const canViewAudit = hasPermission(RBAC_PERMISSIONS.AUDIT_VIEW);
  const canViewConnections = hasPermission(RBAC_PERMISSIONS.CONNECTIONS_VIEW);
  const canViewClickHouseUsers = hasPermission(RBAC_PERMISSIONS.CH_USERS_VIEW);
  const canViewClickHouseRoles = hasPermission(RBAC_PERMISSIONS.CH_ROLES_VIEW);
  const canViewAiModels = hasPermission(RBAC_PERMISSIONS.AI_MODELS_VIEW);

  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();

  const availableTabs: AdminTabKey[] = [
    ...(canViewUsers ? (["users"] as AdminTabKey[]) : []),
    ...(canViewRoles ? (["roles"] as AdminTabKey[]) : []),
    ...(canViewDataAccess ? (["data-access"] as AdminTabKey[]) : []),
    ...(canViewConnections ? (["connections"] as AdminTabKey[]) : []),
    ...(canViewClickHouseUsers ? (["clickhouse-users"] as AdminTabKey[]) : []),
    ...(canViewClickHouseRoles ? (["clickhouse-roles"] as AdminTabKey[]) : []),
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

  // Resolve groups against the user's permissions: drop sections they can't see,
  // then drop any group left empty. The active group is derived from the active
  // section so the URL stays section-based (/admin/<section>).
  const visibleGroups = ADMIN_TAB_GROUPS.map((group) => ({
    ...group,
    tabs: group.tabs.filter((tabKey) => availableTabs.includes(tabKey)),
  })).filter((group) => group.tabs.length > 0);

  const activeGroup =
    visibleGroups.find((group) => group.tabs.includes(activeTab)) ?? visibleGroups[0];

  useEffect(() => {
    if (!tab || !availableTabs.includes(tab as AdminTabKey)) {
      if (availableTabs.length > 0) {
        navigate(`/admin/${availableTabs[0]}`, { replace: true });
      }
    }
  }, [tab, availableTabs, navigate]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-ink-50">
      {/* ─── Header — two tiers: group selector on top, section sub-tabs below ─── */}
      <header className="flex-none border-b border-ink-500 px-6 pt-4">
        {/* Tier 1 — title + group selector + controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            </span>
            <div className="flex flex-col gap-0">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">
                Administration
              </span>
              <h1 className="text-[18px] font-semibold leading-tight tracking-tight text-paper">
                Who can do what, where.
              </h1>
            </div>
          </div>

          {/* Group selector — segmented chips */}
          <nav
            aria-label="Admin groups"
            className="scrollbar-hide flex items-center gap-1 overflow-x-auto"
          >
            {visibleGroups.map((group) => (
              <GroupChip
                key={group.label}
                group={group}
                isActive={group === activeGroup}
                onClick={() => {
                  if (group !== activeGroup) {
                    navigate(`/admin/${group.tabs[0]}`);
                  }
                }}
              />
            ))}
          </nav>

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

        {/* Tier 2 — sections of the active group, flush to the header's bottom border */}
        {activeGroup && (
          <nav
            aria-label={`${activeGroup.label} sections`}
            className="scrollbar-hide -mb-px flex items-center gap-1 overflow-x-auto"
          >
            {activeGroup.tabs.map((tabKey) => (
              <SectionTab
                key={tabKey}
                tabKey={tabKey}
                isActive={activeTab === tabKey}
                onClick={() => navigate(`/admin/${tabKey}`)}
              />
            ))}
          </nav>
        )}
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
              <div className="rounded-md border border-ink-500 bg-ink-100">
                <UserTable />
              </div>
            </TabsContent>
          )}

          {activeTab === "roles" && canViewRoles && (
            <TabsContent value="roles" className="mt-0 h-full outline-none">
              <div className="rounded-md border border-ink-500 bg-ink-100">
                <RbacRolesTable onCreateRole={() => {}} onEditRole={() => {}} />
              </div>
            </TabsContent>
          )}

          {activeTab === "data-access" && canViewDataAccess && (
            <TabsContent value="data-access" className="mt-0 h-full outline-none">
              <div className="rounded-md border border-ink-500 bg-ink-100">
                <DataAccessPolicies />
              </div>
            </TabsContent>
          )}

          {activeTab === "connections" && canViewConnections && (
            <TabsContent value="connections" className="mt-0 h-full outline-none">
              <div className="rounded-md border border-ink-500 bg-ink-100">
                <ConnectionManagement />
              </div>
            </TabsContent>
          )}

          {activeTab === "clickhouse-users" && canViewClickHouseUsers && (
            <TabsContent value="clickhouse-users" className="mt-0 h-full outline-none">
              <div className="rounded-md border border-ink-500 bg-ink-100">
                <ClickHouseUsersManagement />
              </div>
            </TabsContent>
          )}

          {activeTab === "clickhouse-roles" && canViewClickHouseRoles && (
            <TabsContent value="clickhouse-roles" className="mt-0 h-full outline-none">
              <div className="rounded-md border border-ink-500 bg-ink-100">
                <ClickHouseRolesManagement />
              </div>
            </TabsContent>
          )}

          {activeTab === "ai-models" && canViewAiModels && (
            <TabsContent value="ai-models" className="mt-0 h-full outline-none">
              <div className="rounded-md border border-ink-500 bg-ink-100">
                <AiModelsManagement />
              </div>
            </TabsContent>
          )}

          {activeTab === "audit" && canViewAudit && (
            <TabsContent value="audit" className="mt-0 h-full outline-none">
              <div className="rounded-md border border-ink-500 bg-ink-100">
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
            Identity, roles, permissions. RBAC at the seams so you can stop hand-rolling access checks.
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
              <span><strong className="text-paper">ClickHouse users</strong> — create native database users and assign them roles</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-paper-dim" aria-hidden />
              <span><strong className="text-paper">ClickHouse roles</strong> — define native role privileges from the live server hierarchy</span>
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
