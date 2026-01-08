import React from "react";
import { motion } from "framer-motion";
import { Settings as SettingsIcon, Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "@/components/common/theme-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { GlassCard, GlassCardContent, GlassCardHeader, GlassCardTitle } from "@/components/ui/glass-card";
import { useAuthStore } from "@/stores";

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const { username, url } = useAuthStore();

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  };

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="container mx-auto p-6 space-y-6"
    >
      <motion.div variants={item} className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white/90 flex items-center gap-3">
          <SettingsIcon className="h-8 w-8 text-purple-400" />
          Settings
        </h1>
        <p className="text-gray-400">Manage your application preferences.</p>
      </motion.div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Connection Info */}
        <motion.div variants={item}>
          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle>Connection</GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-gray-400">Connected As</Label>
                <p className="text-white font-medium">{username || "N/A"}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-gray-400">Server URL</Label>
                <p className="text-white font-medium font-mono text-sm break-all">
                  {url || "N/A"}
                </p>
              </div>
            </GlassCardContent>
          </GlassCard>
        </motion.div>

        {/* Theme Settings */}
        <motion.div variants={item}>
          <GlassCard>
            <GlassCardHeader>
              <GlassCardTitle>Appearance</GlassCardTitle>
            </GlassCardHeader>
            <GlassCardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-gray-400">Theme</Label>
                <div className="flex gap-2">
                  <Button
                    variant={theme === "light" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTheme("light")}
                    className="gap-2"
                  >
                    <Sun className="h-4 w-4" />
                    Light
                  </Button>
                  <Button
                    variant={theme === "dark" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTheme("dark")}
                    className="gap-2"
                  >
                    <Moon className="h-4 w-4" />
                    Dark
                  </Button>
                  <Button
                    variant={theme === "system" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTheme("system")}
                    className="gap-2"
                  >
                    <Monitor className="h-4 w-4" />
                    System
                  </Button>
                </div>
              </div>
            </GlassCardContent>
          </GlassCard>
        </motion.div>
      </div>

      {/* About */}
      <motion.div variants={item}>
        <GlassCard>
          <GlassCardHeader>
            <GlassCardTitle>About</GlassCardTitle>
          </GlassCardHeader>
          <GlassCardContent>
            <div className="space-y-2">
              <p className="text-gray-400 text-sm">
                ClickHouse Studio - A modern web interface for ClickHouse databases.
              </p>
              <p className="text-gray-500 text-xs">
                Built with React, TypeScript, and love ❤️
              </p>
            </div>
          </GlassCardContent>
        </GlassCard>
      </motion.div>
    </motion.div>
  );
}
