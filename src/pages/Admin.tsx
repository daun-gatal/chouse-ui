import { useState } from "react";
import { Button } from "@/components/ui/button";
import UserTable from "@/features/admin/components/UserManagement/index";
import { InfoIcon, ShieldCheck, Users, Database, AlertTriangle } from "lucide-react";
import InfoDialog from "@/components/common/InfoDialog";
import ActivateSavedQueries from "@/features/admin/components/ActivateSavedQueries";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GlassCard, GlassCardContent } from "@/components/ui/glass-card";
import { motion } from "framer-motion";

export default function Admin() {
  const [isInfoOpen, setIsInfoOpen] = useState(false);

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
              <p className="text-gray-400 text-sm">Manage users, access controls, and system configurations</p>
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

        <Tabs defaultValue="users" className="space-y-6">
          <TabsList className="bg-white/5 border border-white/10 p-1">
            <TabsTrigger value="users" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-300">
              <Users className="w-4 h-4 mr-2" /> Users & Roles
            </TabsTrigger>
            <TabsTrigger value="queries" className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-300">
              <Database className="w-4 h-4 mr-2" /> Saved Queries
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <GlassCard>
              <GlassCardContent className="p-0">
                <UserTable />
              </GlassCardContent>
            </GlassCard>
          </TabsContent>

          <TabsContent value="queries">
            <GlassCard>
              <GlassCardContent className="p-6">
                <h2 className="text-xl font-semibold text-white mb-2">Saved Queries Management</h2>
                <p className="text-gray-400 mb-6">Enable or disable the saved queries feature for this ClickHouse cluster.</p>
                <ActivateSavedQueries />
              </GlassCardContent>
            </GlassCard>
          </TabsContent>
        </Tabs>

        <InfoDialog
          title="Administration"
          isOpen={isInfoOpen}
          onClose={() => setIsInfoOpen(false)}
          variant="info"
        >
          <div className="flex flex-col gap-3">
            <p className="text-gray-300">
              Manage ClickHouse users, roles, and system settings from this page.
            </p>
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-200">
                Actions run directly on ClickHouse system tables. Some operations like deleting users are <strong>irreversible</strong>.
              </p>
            </div>
            <ul className="text-sm text-gray-400 space-y-1">
              <li>• Create, edit, and delete users</li>
              <li>• Manage user permissions and roles</li>
              <li>• Configure saved queries feature</li>
            </ul>
          </div>
        </InfoDialog>
      </div>
    </motion.div>
  );
}
