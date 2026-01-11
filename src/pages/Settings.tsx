import React from "react";
import { motion } from "framer-motion";
import {
  Settings as SettingsIcon,
  Moon,
  Server,
  Database,
  CheckCircle2,
  ExternalLink,
  Palette,
  Link2,
  Info,
  Heart,
  LogOut,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuthStore, useRbacStore } from "@/stores";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { rbacConnectionsApi } from "@/api/rbac";
import { getSessionId, clearSession } from "@/api/client";

interface SettingCardProps {
  title: string;
  description?: string;
  icon: React.ElementType;
  color: string;
  children: React.ReactNode;
}

const SettingCard: React.FC<SettingCardProps> = ({
  title,
  description,
  icon: Icon,
  color,
  children,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="rounded-2xl bg-white/5 border border-white/10 overflow-hidden"
  >
    <div className="flex items-center gap-3 p-4 border-b border-white/10">
      <div className={cn("p-2 rounded-lg", color)}>
        <Icon className="h-4 w-4 text-white" />
      </div>
      <div>
        <h3 className="font-semibold text-white">{title}</h3>
        {description && <p className="text-xs text-gray-500">{description}</p>}
      </div>
    </div>
    <div className="p-4">{children}</div>
  </motion.div>
);

interface InfoRowProps {
  label: string;
  value: string | React.ReactNode;
  icon?: React.ElementType;
}

const InfoRow: React.FC<InfoRowProps> = ({ label, value, icon: Icon }) => (
  <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
    <div className="flex items-center gap-2">
      {Icon && <Icon className="h-3.5 w-3.5 text-gray-500" />}
      <span className="text-sm text-gray-400">{label}</span>
    </div>
    <span className="text-sm text-white font-medium">{value}</span>
  </div>
);

export default function Settings() {
  const navigate = useNavigate();
  // Get connection info from auth store (populated by ConnectionSelector)
  const { username, url, version, isAdmin } = useAuthStore();
  // Get RBAC logout function
  const { logout: rbacLogout } = useRbacStore();

  const handleLogout = async () => {
    try {
      // Disconnect from ClickHouse connection if there's an active session
      const sessionId = getSessionId();
      if (sessionId) {
        try {
          await rbacConnectionsApi.disconnect(sessionId);
        } catch (error) {
          console.error('Failed to disconnect ClickHouse connection:', error);
          // Continue with logout even if disconnect fails
        }
      }
      
      // Logout from RBAC
      await rbacLogout();
      
      // Clear ClickHouse session
      clearSession();
    } catch (error) {
      console.error('Logout error:', error);
      // Clear local state anyway
      clearSession();
    } finally {
      navigate("/login");
    }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="container mx-auto p-6 space-y-6 max-w-4xl">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-4"
        >
          <div className="p-3 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-600 shadow-lg shadow-purple-500/20">
            <SettingsIcon className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Settings</h1>
            <p className="text-gray-400 text-sm">Manage your application preferences</p>
          </div>
        </motion.div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Connection Info */}
          <SettingCard
            title="Connection"
            description="Current server connection details"
            icon={Link2}
            color="bg-blue-500"
          >
            <div className="space-y-2">
              <InfoRow
                label="Server URL"
                icon={Server}
                value={
                  url ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs truncate max-w-[200px]" title={url}>
                        {url}
                      </span>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-500 hover:text-white transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ) : (
                    <span className="text-gray-500 text-xs">Re-login to see URL</span>
                  )
                }
              />
              <InfoRow
                label="ClickHouse Version"
                icon={Database}
                value={version || "N/A"}
              />
              <InfoRow
                label="Status"
                icon={CheckCircle2}
                value={
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-green-400">Connected</span>
                  </div>
                }
              />
            </div>
          </SettingCard>

          {/* Appearance */}
          <SettingCard
            title="Appearance"
            description="Application theme settings"
            icon={Palette}
            color="bg-purple-500"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/20">
                    <Moon className="h-5 w-5 text-purple-400" />
                  </div>
                  <div>
                    <p className="font-medium text-white">Dark Mode</p>
                    <p className="text-xs text-gray-500">Optimized for low-light environments</p>
                  </div>
                </div>
                <Badge className="bg-purple-500/20 text-purple-400">Active</Badge>
              </div>
              <p className="text-xs text-gray-500 text-center">
                ClickStudio is designed with a dark theme for optimal visibility of data and reduced eye strain.
              </p>
            </div>
          </SettingCard>
        </div>

        {/* About Section */}
        <SettingCard
          title="About"
          description="Application information"
          icon={Info}
          color="bg-emerald-500"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-white/10">
              <div>
                <h4 className="font-semibold text-white">ClickStudio</h4>
                <p className="text-sm text-gray-400">
                  A modern web interface for ClickHouse databases
                </p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-white/5 text-center">
                <p className="text-xs text-gray-500 mb-1">Built with</p>
                <p className="text-sm text-gray-300">React + TypeScript</p>
              </div>
              <div className="p-3 rounded-lg bg-white/5 text-center">
                <p className="text-xs text-gray-500 mb-1">UI Framework</p>
                <p className="text-sm text-gray-300">Tailwind CSS</p>
              </div>
            </div>

            <p className="text-center text-gray-500 text-sm flex items-center justify-center gap-1">
              Made with <Heart className="h-4 w-4 text-red-400" /> for the ClickHouse community
            </p>
          </div>
        </SettingCard>

        {/* Session Actions */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex justify-center pt-4"
        >
          <Button
            variant="outline"
            onClick={handleLogout}
            className="gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <LogOut className="h-4 w-4" />
            Log Out
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
