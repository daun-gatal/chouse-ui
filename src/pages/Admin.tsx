import { useState } from "react";
import { Button } from "@/components/ui/button";
import UserTable from "@/features/admin/components/UserManagement/index";
import { InfoIcon, ShieldCheck, Users, Shield, FileText, Server, UserCog } from "lucide-react";
import InfoDialog from "@/components/common/InfoDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GlassCard, GlassCardContent } from "@/components/ui/glass-card";
import { motion } from "framer-motion";
import { RbacRolesTable, RbacAuditLogs } from "@/features/rbac/components";
import ConnectionManagement from "@/features/admin/components/ConnectionManagement";
import ClickHouseUsersManagement from "@/features/admin/components/ClickHouseUsers";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";

export default function Admin() {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const { hasPermission, hasAnyPermission, isSuperAdmin } = useRbacStore();

  // Permission checks for tabs
  const canViewUsers = hasPermission(RBAC_PERMISSIONS.USERS_VIEW);
  const canViewRoles = hasPermission(RBAC_PERMISSIONS.ROLES_VIEW);
  const canViewAudit = hasPermission(RBAC_PERMISSIONS.AUDIT_VIEW);
  // Connections tab is restricted to super admins only
  const canViewConnections = isSuperAdmin();
  const canViewClickHouseUsers = hasPermission(RBAC_PERMISSIONS.CH_USERS_VIEW);

  // Determine default tab based on permissions
  const getDefaultTab = () => {
    if (canViewUsers) return "users";
    if (canViewRoles) return "roles";
    if (canViewConnections) return "connections";
    if (canViewClickHouseUsers) return "clickhouse-users";
    if (canViewAudit) return "audit";
    return "users";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="h-full w-full overflow-y-auto"
    >
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-600 shadow-lg shadow-purple-500/20">
              <ShieldCheck className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white">Administration</h1>
              <p className="text-gray-400 text-sm">Manage users, roles, and system configurations</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsInfoOpen(true)}
            className="text-gray-400 hover:text-white"
          >
            <InfoIcon className="w-5 h-5" />
          </Button>
        </div>

        <Tabs defaultValue={getDefaultTab()} className="space-y-6">
          <TabsList className="bg-white/5 border border-white/10 p-1">
            {canViewUsers && (
              <TabsTrigger value="users" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-300">
                <Users className="w-4 h-4 mr-2" /> Users
              </TabsTrigger>
            )}
            {canViewRoles && (
              <TabsTrigger value="roles" className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-300">
                <Shield className="w-4 h-4 mr-2" /> Roles
              </TabsTrigger>
            )}
            {canViewConnections && (
              <TabsTrigger value="connections" className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-300">
                <Server className="w-4 h-4 mr-2" /> Connections
              </TabsTrigger>
            )}
            {canViewClickHouseUsers && (
              <TabsTrigger value="clickhouse-users" className="data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-300">
                <UserCog className="w-4 h-4 mr-2" /> ClickHouse Users
              </TabsTrigger>
            )}
            {canViewAudit && (
              <TabsTrigger value="audit" className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-300">
                <FileText className="w-4 h-4 mr-2" /> Audit Logs
              </TabsTrigger>
            )}
          </TabsList>

          {canViewUsers && (
            <TabsContent value="users">
              <GlassCard>
                <GlassCardContent className="p-0">
                  <UserTable />
                </GlassCardContent>
              </GlassCard>
            </TabsContent>
          )}

          {canViewRoles && (
            <TabsContent value="roles">
              <GlassCard>
                <GlassCardContent className="p-0">
                  <RbacRolesTable
                    onCreateRole={() => {
                      // Optional: Add any additional logic after role creation
                    }}
                    onEditRole={() => {
                      // Optional: Add any additional logic after role update
                    }}
                  />
                </GlassCardContent>
              </GlassCard>
            </TabsContent>
          )}

          {canViewConnections && (
            <TabsContent value="connections">
              <GlassCard>
                <GlassCardContent className="p-0">
                  <ConnectionManagement />
                </GlassCardContent>
              </GlassCard>
            </TabsContent>
          )}

          {canViewClickHouseUsers && (
            <TabsContent value="clickhouse-users">
              <GlassCard>
                <GlassCardContent className="p-0">
                  <ClickHouseUsersManagement />
                </GlassCardContent>
              </GlassCard>
            </TabsContent>
          )}

          {canViewAudit && (
            <TabsContent value="audit">
              <GlassCard>
                <GlassCardContent className="p-0">
                  <RbacAuditLogs />
                </GlassCardContent>
              </GlassCard>
            </TabsContent>
          )}
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
      </div>
    </motion.div>
  );
}
