import { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, Outlet, Navigate } from "react-router-dom";
import FloatingDock from "@/components/common/FloatingDock";
import HomePage from "@/pages/Home";
import MonitoringPage from "@/pages/Monitoring";
import PreferencesPage from "@/pages/Preferences";
import { DefaultRedirect } from "@/components/common/DefaultRedirect";
import { ThemeProvider } from "@/components/common/theme-provider";
import AppInitializer from "@/components/common/AppInit";
import NotFound from "./pages/NotFound";
import { PrivateRoute } from "@/components/common/privateRoute";
import Admin from "@/pages/Admin";
import Login from "@/pages/Login";
import ExplorerPage from "@/pages/Explorer";
import ExplainPopout from "@/pages/ExplainPopout";
import { AdminRoute } from "@/features/admin/routes/adminRoute";
import CreateUser from "@/features/admin/components/CreateUser";
import EditUser from "@/features/admin/components/EditUser";
import { RBAC_PERMISSIONS } from "@/stores/rbac";
import { PageTitleUpdater } from "@/components/common/PageTitleUpdater";

// Storage key for dock mode (to sync with FloatingDock).
const DOCK_MODE_KEY = "chouseui-dock-mode";

// Layout for the main application (authenticated routes) - Floating Dock Design
const MainLayout = () => {
  const [isSidebarMode, setIsSidebarMode] = useState(() => {
    try {
      return localStorage.getItem(DOCK_MODE_KEY) === "sidebar";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handleModeChange = (event: CustomEvent<{ mode: string }>) => {
      setIsSidebarMode(event.detail.mode === "sidebar");
    };

    window.addEventListener("dock:mode-change", handleModeChange as EventListener);
    return () => {
      window.removeEventListener("dock:mode-change", handleModeChange as EventListener);
    };
  }, []);

  return (
    <div className="h-screen w-full overflow-hidden bg-[#0a0a0a] bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.3),rgba(255,255,255,0))] relative flex">
      {/* Background Decor */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl opacity-50" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl opacity-50" />
      </div>

      {/* Spacer for sidebar mode */}
      {isSidebarMode && <div className="w-14 flex-shrink-0" />}

      {/* Main Content - Adjusts for sidebar mode */}
      <main className="h-full flex-1 overflow-auto z-10 relative transition-all duration-300">
        <Outlet />
      </main>

      {/* Floating Dock / Sidebar Navigation */}
      <FloatingDock />
    </div>
  );
};

export default function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <Router basename={import.meta.env.BASE_URL}>
        <AppInitializer>
          <PageTitleUpdater />
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/explain-popout" element={<ExplainPopout />} />

            {/* Authenticated Application Routes */}
            <Route element={<MainLayout />}>
              {/* Default redirect based on user role */}
              <Route path="/" element={<DefaultRedirect />} />

              {/* Overview - Default landing page for all authenticated users */}
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
                path="/monitoring"
                element={
                  <AdminRoute
                    requiredPermission={[
                      RBAC_PERMISSIONS.LIVE_QUERIES_VIEW,
                      RBAC_PERMISSIONS.METRICS_VIEW,
                      RBAC_PERMISSIONS.METRICS_VIEW_ADVANCED,
                      RBAC_PERMISSIONS.QUERY_HISTORY_VIEW,
                      RBAC_PERMISSIONS.QUERY_HISTORY_VIEW_ALL,
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
                path="/admin"
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
