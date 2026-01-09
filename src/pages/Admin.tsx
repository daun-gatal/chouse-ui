import { useState } from "react";
import { Button } from "@/components/ui/button";
import UserTable from "@/features/admin/components/UserManagement/index";
import { InfoIcon, ShieldCheck, Users, Database, Shield, FileText, Server } from "lucide-react";
import InfoDialog from "@/components/common/InfoDialog";
import ActivateSavedQueries from "@/features/admin/components/ActivateSavedQueries";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GlassCard, GlassCardContent } from "@/components/ui/glass-card";
import { motion } from "framer-motion";
import { RbacRolesTable, RbacAuditLogs } from "@/features/rbac/components";
import ConnectionManagement from "@/features/admin/components/ConnectionManagement";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";

export default function Admin() {
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const { hasPermission, hasAnyPermission } = useRbacStore();

  // Permission checks for tabs
  const canViewUsers = hasPermission(RBAC_PERMISSIONS.USERS_VIEW);
  const canViewRoles = hasPermission(RBAC_PERMISSIONS.ROLES_VIEW);
  const canViewAudit = hasPermission(RBAC_PERMISSIONS.AUDIT_VIEW);
  const canViewSettings = hasPermission(RBAC_PERMISSIONS.SETTINGS_VIEW);
  const canManageSavedQueries = hasAnyPermission([
    RBAC_PERMISSIONS.SAVED_QUERIES_CREATE,
    RBAC_PERMISSIONS.SAVED_QUERIES_UPDATE,
  ]);

  // Determine default tab based on permissions
  const getDefaultTab = () => {
    if (canViewUsers) return "users";
    if (canViewRoles) return "roles";
    if (canViewSettings) return "connections";
    if (canViewAudit) return "audit";
    if (canManageSavedQueries) return "queries";
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
            {canViewSettings && (
              <TabsTrigger value="connections" className="data-[state=active]:bg-cyan-500/20 data-[state=active]:text-cyan-300">
                <Server className="w-4 h-4 mr-2" /> Connections
              </TabsTrigger>
            )}
            {canViewAudit && (
              <TabsTrigger value="audit" className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-300">
                <FileText className="w-4 h-4 mr-2" /> Audit Logs
              </TabsTrigger>
            )}
            {canManageSavedQueries && (
              <TabsTrigger value="queries" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-300">
                <Database className="w-4 h-4 mr-2" /> Saved Queries
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
                  <RbacRolesTable />
                </GlassCardContent>
              </GlassCard>
            </TabsContent>
          )}

          {canViewSettings && (
            <TabsContent value="connections">
              <GlassCard>
                <GlassCardContent className="p-0">
                  <ConnectionManagement />
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

          {canManageSavedQueries && (
            <TabsContent value="queries">
              <GlassCard>
                <GlassCardContent className="p-6">
                  <h2 className="text-xl font-semibold text-white mb-2">Saved Queries Management</h2>
                  <p className="text-gray-400 mb-6">Enable or disable the saved queries feature for this ClickHouse cluster.</p>
                  <ActivateSavedQueries />
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
              <li>• <strong>Users</strong> - Create, edit, and manage user accounts</li>
              <li>• <strong>Roles</strong> - View roles and their associated permissions</li>
              <li>• <strong>Connections</strong> - Manage ClickHouse server connections</li>
              <li>• <strong>Audit Logs</strong> - Track all system actions for compliance</li>
              <li>• <strong>Saved Queries</strong> - Configure the saved queries feature</li>
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
