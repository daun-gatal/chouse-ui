import { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Outlet, Navigate } from "react-router-dom";
import FloatingDock from "@/components/common/FloatingDock";
import AiChatBubble from "@/components/common/AiChatBubble";
import CommandPalette from "@/components/common/CommandPalette";
import HomePage from "@/pages/Home";
import FleetPage from "@/pages/Fleet";
import DoctorPage from "@/pages/Doctor";
import MonitoringPage from "@/pages/Monitoring";
import PreferencesPage from "@/pages/Preferences";
import { DefaultRedirect } from "@/components/common/DefaultRedirect";
import { ThemeProvider } from "@/components/common/theme-provider";
import AppInitializer from "@/components/common/AppInit";
import NotFound from "./pages/NotFound";
import { PrivateRoute } from "@/components/common/privateRoute";
import Admin from "@/pages/Admin";
import Login from "@/pages/Login";
import SsoCallback from "@/pages/SsoCallback";
import ExplorerPage from "@/pages/Explorer";
import ExplainPopout from "@/pages/ExplainPopout";
import { AdminRoute } from "@/features/admin/routes/adminRoute";
import CreateUser from "@/features/admin/components/CreateUser";
import EditUser from "@/features/admin/components/EditUser";
import { RBAC_PERMISSIONS } from "@/stores/rbac";
import { PageTitleUpdater } from "@/components/common/PageTitleUpdater";
import { api, rbacConnectionsApi } from "@/api";
import { useAuthStore } from "@/stores/auth";
import { toast } from "sonner";
import { log } from "@/lib/log";
import { useAppPreferences } from "@/hooks/useAppPreferences";

// Storage key for dock mode (to sync with FloatingDock).
const DOCK_MODE_KEY = "chouseui-dock-mode";

// Layout for the main application (authenticated routes) - Floating Dock Design
const MainLayout = () => {
  // Sync server-backed preferences (theme, maxResultRows) on every authenticated mount
  useAppPreferences();

  const [isSidebarMode, setIsSidebarMode] = useState(() => {
    try {
      return localStorage.getItem(DOCK_MODE_KEY) === "sidebar";
    } catch {
      return false;
    }
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  useEffect(() => {
    const handleModeChange = (event: CustomEvent<{ mode: string }>) => {
      setIsSidebarMode(event.detail.mode === "sidebar");
    };

    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    // Cmd/Ctrl+K — toggle the global command palette.
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        // Skip when a modifier-K combo means something else (e.g. inside a
        // contenteditable rich editor) — but Monaco doesn't use ⌘K by default,
        // so this is safe across the app.
        e.preventDefault();
        setIsPaletteOpen((open) => !open);
      }
    };

    window.addEventListener("dock:mode-change", handleModeChange as EventListener);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("dock:mode-change", handleModeChange as EventListener);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-ink-50">
      {/* Spacer for sidebar mode (hidden during fullscreen) */}
      {isSidebarMode && !isFullscreen && <div className="w-14 flex-shrink-0" />}

      {/* Main Content - Adjusts for sidebar mode */}
      <main className="h-full flex-1 overflow-auto z-10 relative transition-all duration-300">
        <Outlet />
      </main>

      {/* Floating Dock / Sidebar Navigation */}
      <FloatingDock />

      {/* AI Chat Assistant Bubble */}
      <AiChatBubble />

      {/* Global Cmd/Ctrl+K command palette */}
      <CommandPalette open={isPaletteOpen} onOpenChange={setIsPaletteOpen} />
    </div>
  );
};

export default function App() {
  // Session Recovery Logic
  useEffect(() => {
    api.setOnSessionExpired(async () => {
      const activeConnectionId = useAuthStore.getState().activeConnectionId;
      log.warn("[App] ClickHouse session expired. Attempting to reconnect.", { activeConnectionId });

      if (activeConnectionId) {
        try {
          const result = await rbacConnectionsApi.connect(activeConnectionId);
          if (result && result.sessionId) {
            useAuthStore.getState().setConnectionInfo({
              sessionId: result.sessionId,
              username: result.username,
              url: `${result.host}:${result.port}`,
              version: result.version,
              isAdmin: result.isAdmin,
              permissions: result.permissions,
              activeConnectionId: activeConnectionId,
              activeConnectionName: result.connectionName,
            });
            log.info("[App] Session recovered successfully.");
            toast.success("Session recovered");
          }
        } catch (e) {
          log.error("[App] Failed to recover session.", { err: e instanceof Error ? e.message : String(e) });
          toast.error("Session expired. Please reconnect.");
        }
      } else {
        toast.error("Session expired. Please select a connection.");
      }
    });

    return () => {
      api.setOnSessionExpired(() => { }); // Cleanup
    };
  }, []);

  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <Router basename={import.meta.env.BASE_URL}>
        <AppInitializer>
          <PageTitleUpdater />
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/auth/sso/callback" element={<SsoCallback />} />
            <Route path="/explain-popout" element={<ExplainPopout />} />

            {/* Authenticated Application Routes */}
            <Route element={<MainLayout />}>
              {/* Default redirect based on user role */}
              <Route path="/" element={<DefaultRedirect />} />

              {/* Fleet - Multi-cluster monitor; primary landing page for chouse-fleet */}
              <Route
                path="/fleet"
                element={
                  <AdminRoute requiredPermission={RBAC_PERMISSIONS.FLEET_VIEW}>
                    <FleetPage />
                  </AdminRoute>
                }
              />

              {/* Doctor - ChouseD AI fleet health checks + report history */}
              <Route
                path="/doctor/:reportId?"
                element={
                  <AdminRoute requiredPermission={RBAC_PERMISSIONS.DOCTOR_VIEW}>
                    <DoctorPage />
                  </AdminRoute>
                }
              />

              {/* Overview - Per-cluster home, reached by drilling into a fleet card */}
              <Route
                path="/overview"
                element={
                  <PrivateRoute>
                    <HomePage />
                  </PrivateRoute>
                }
              />

              {/* Monitoring - Live Queries, Logs, Metrics */}
              <Route
                path="/monitoring/:tab?"
                element={
                  <AdminRoute
                    requiredPermission={[
                      RBAC_PERMISSIONS.LIVE_QUERIES_VIEW,
                      RBAC_PERMISSIONS.METRICS_VIEW,
                      RBAC_PERMISSIONS.METRICS_VIEW_ADVANCED,
                      RBAC_PERMISSIONS.LOGS_VIEW,
                      RBAC_PERMISSIONS.PARTS_VIEW,
                      RBAC_PERMISSIONS.SCHEMA_ADVISOR_VIEW,
                      RBAC_PERMISSIONS.CLUSTER_VIEW,
                      RBAC_PERMISSIONS.ERRORS_VIEW,
                    ]}
                  >
                    <MonitoringPage />
                  </AdminRoute>
                }
              />

              {/* Backward compatibility redirects for old routes */}
              <Route path="/logs" element={<Navigate to="/monitoring" replace />} />
              <Route path="/metrics" element={<Navigate to="/monitoring" replace />} />

              {/* Explorer */}
              <Route
                path="/explorer"
                element={
                  <AdminRoute
                    requiredPermission={[
                      RBAC_PERMISSIONS.DB_VIEW,
                      RBAC_PERMISSIONS.TABLE_VIEW,
                    ]}
                  >
                    <ExplorerPage />
                  </AdminRoute>
                }
              />

              {/* Administration - RBAC User Management */}
              <Route
                path="/admin/:tab?"
                element={
                  <AdminRoute
                    requiredPermission={[
                      RBAC_PERMISSIONS.USERS_VIEW,
                      RBAC_PERMISSIONS.USERS_CREATE,
                      RBAC_PERMISSIONS.ROLES_VIEW,
                      RBAC_PERMISSIONS.AUDIT_VIEW,
                    ]}
                  >
                    <Admin />
                  </AdminRoute>
                }
              />

              {/* Create User */}
              <Route
                path="/admin/users/create"
                element={
                  <AdminRoute requiredPermission={RBAC_PERMISSIONS.USERS_CREATE}>
                    <CreateUser />
                  </AdminRoute>
                }
              />

              {/* Edit User - using userId */}
              <Route
                path="/admin/users/edit/:userId"
                element={
                  <AdminRoute requiredPermission={RBAC_PERMISSIONS.USERS_UPDATE}>
                    <EditUser />
                  </AdminRoute>
                }
              />

              {/* Preferences */}
              <Route
                path="/preferences"
                element={
                  <PrivateRoute>
                    <PreferencesPage />
                  </PrivateRoute>
                }
              />

              {/* Backward compatibility redirects */}
              <Route path="/settings" element={<Navigate to="/preferences" replace />} />

              {/* 404 */}
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AppInitializer>
      </Router>
    </ThemeProvider>
  );
}

// Dummy changes for rebuild at 2026-06-11 at 15.30 UTC
