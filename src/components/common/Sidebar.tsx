import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Server,
  Settings,
  Activity,
  LogOut,
  Database,
  FileText,
  Shield,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { withBasePath } from "@/lib/basePath";
import ConnectionSelector from "./ConnectionSelector";
import { rbacConnectionsApi, rbacUserPreferencesApi } from "@/api/rbac";
import { getSessionId, clearSession } from "@/api/client";

// Persist sidebar state in localStorage
const SIDEBAR_COLLAPSED_KEY = "chouseui-sidebar-collapsed";

interface SidebarItemProps {
  icon: React.ElementType;
  label: string;
  to: string;
  isActive?: boolean;
  isCollapsed: boolean;
}

const SidebarItem = ({ icon: Icon, label, to, isActive, isCollapsed }: SidebarItemProps) => {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={to}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all duration-300 group relative",
              isActive
                ? "bg-white/10 text-white shadow-lg shadow-purple-500/10 ring-1 ring-white/10"
                : "text-gray-400 hover:text-white hover:bg-white/5",
              isCollapsed && "justify-center px-2"
            )}
          >
            {isActive && (
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/10 to-blue-500/10 opacity-50 rounded-lg" />
            )}
            <Icon className={cn("h-5 w-5 shrink-0 transition-transform group-hover:scale-110 z-10", isActive && "text-purple-400")} />
            {!isCollapsed && (
              <span className={cn("font-medium z-10", isActive && "text-white")}>{label}</span>
            )}

            {/* Active Indicator Line */}
            {isActive && !isCollapsed && (
              <motion.div
                layoutId="sidebar-active"
                className="absolute left-0 top-0 bottom-0 w-1 bg-purple-500 rounded-r-full"
              />
            )}
          </Link>
        </TooltipTrigger>
        {isCollapsed && (
          <TooltipContent side="right" className="bg-black/80 text-white border-white/10 backdrop-blur-md">
            {label}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
};

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Use RBAC store for all authentication
  const { 
    user, 
    logout, 
    isAdmin, 
    hasPermission,
    hasAnyPermission,
  } = useRbacStore();
  
  // Check permissions for various sections
  const canViewMetrics = hasAnyPermission([
    RBAC_PERMISSIONS.METRICS_VIEW,
    RBAC_PERMISSIONS.METRICS_VIEW_ADVANCED,
  ]);
  
  const canViewAdmin = hasAnyPermission([
    RBAC_PERMISSIONS.USERS_VIEW,
    RBAC_PERMISSIONS.USERS_CREATE,
    RBAC_PERMISSIONS.ROLES_VIEW,
    RBAC_PERMISSIONS.AUDIT_VIEW,
  ]);
  
  const canViewOverview = isAdmin();
  
  const { isAuthenticated } = useRbacStore();
  const [hasFetchedPreference, setHasFetchedPreference] = useState(false);
  
  // Load initial state from localStorage (fallback for non-authenticated users)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      return saved === "true";
    } catch {
      return false;
    }
  });

  // Fetch sidebar preference from database when authenticated
  useEffect(() => {
    if (!isAuthenticated || hasFetchedPreference) {
      return;
    }

    const fetchSidebarPreference = async (): Promise<void> => {
      try {
        const preferences = await rbacUserPreferencesApi.getPreferences();
        const savedCollapsed = preferences.workspacePreferences?.sidebarCollapsed as boolean | undefined;
        
        if (typeof savedCollapsed === 'boolean') {
          setIsCollapsed(savedCollapsed);
          // Also update localStorage for fallback
          localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(savedCollapsed));
        }
        setHasFetchedPreference(true);
      } catch (error) {
        console.error('[Sidebar] Failed to fetch sidebar preference:', error);
        // Fallback to localStorage if API fails
        try {
          const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
          if (saved !== null) {
            setIsCollapsed(saved === "true");
          }
        } catch {
          // Ignore localStorage errors
        }
        setHasFetchedPreference(true);
      }
    };

    fetchSidebarPreference().catch((error) => {
      console.error('[Sidebar] Error fetching sidebar preference:', error);
      setHasFetchedPreference(true);
    });
  }, [isAuthenticated, hasFetchedPreference]);

  // Sync sidebar state to database when it changes (debounced)
  useEffect(() => {
    // Don't sync on initial load or if not authenticated
    if (!isAuthenticated || !hasFetchedPreference) {
      return;
    }

    // Persist to localStorage immediately (fallback)
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isCollapsed));
    } catch {
      // Ignore localStorage errors
    }

    // Debounce database sync to avoid excessive API calls
    const timeoutId = setTimeout(async () => {
      try {
        // Get current preferences and merge sidebarCollapsed
        const currentPreferences = await rbacUserPreferencesApi.getPreferences();
        await rbacUserPreferencesApi.updatePreferences({
          workspacePreferences: {
            ...currentPreferences.workspacePreferences,
            sidebarCollapsed: isCollapsed,
          },
        });
      } catch (error) {
        console.error('[Sidebar] Failed to sync sidebar preference:', error);
        // Continue anyway - state is already set locally
      }
    }, 500); // Debounce by 500ms

    return () => {
      clearTimeout(timeoutId);
    };
  }, [isCollapsed, isAuthenticated, hasFetchedPreference]);

  const Logo = withBasePath("logo.svg");

  const sidebarItems = [
    ...(canViewOverview ? [{ icon: LayoutDashboard, label: "Overview", to: "/overview" }] : []),
    { icon: Database, label: "Explorer", to: "/explorer" },
    ...(canViewMetrics ? [{ icon: Activity, label: "Metrics", to: "/metrics" }] : []),
    { icon: FileText, label: "Logs", to: "/logs" },
    ...(canViewAdmin ? [{ icon: Shield, label: "Administration", to: "/admin" }] : []),
    { icon: Settings, label: "Settings", to: "/settings" },
  ];

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
      await logout();
      
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

  // Get display name
  const displayName = user?.displayName || user?.username || "User";
  const userInitials = displayName.slice(0, 2).toUpperCase();

  return (
    <motion.div
      animate={{ width: isCollapsed ? 80 : 280 }}
      className="relative z-20 flex flex-col border-r border-white/10 bg-black/20 backdrop-blur-xl h-full"
      transition={{ duration: 0.3, ease: "easeInOut" }}
    >
      {/* Toggle Button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute -right-3 top-6 z-30 h-6 w-6 rounded-full border border-white/10 bg-[#1a1a1a] text-gray-400 hover:text-white shadow-md hover:bg-purple-500/20"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
      </Button>

      <div className={cn("flex items-center gap-3 p-6", isCollapsed && "justify-center p-4")}>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center">
          <img src={Logo} alt="Logo" className="w-8 h-8 object-contain drop-shadow-[0_0_10px_rgba(255,200,0,0.2)]" />
        </div>
        {!isCollapsed && (
          <motion.div 
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col"
          >
            <span className="font-bold text-lg bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              CHouse UI
            </span>
            <span className="text-xs text-gray-500 font-medium">
              Database Management
            </span>
          </motion.div>
        )}
      </div>

      {/* Connection Selector */}
      <div className={cn("px-4 pb-4", isCollapsed && "px-2")}>
        <TooltipProvider>
          <ConnectionSelector isCollapsed={isCollapsed} />
        </TooltipProvider>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 scrollbar-hide">
        <nav className="flex flex-col gap-2">
          {!isCollapsed && <div className="px-2 mb-2 text-xs font-semibold text-gray-600 uppercase tracking-wider">Menu</div>}

          {sidebarItems.map((item) => (
            <SidebarItem
              key={item.to + item.label}
              icon={item.icon}
              label={item.label}
              to={item.to}
              isActive={location.pathname.startsWith(item.to)}
              isCollapsed={isCollapsed}
            />
          ))}
        </nav>
      </div>

      <div className="p-4 mt-auto border-t border-white/5 bg-black/20">
        {!isCollapsed && <div className="px-2 mb-2 text-xs font-semibold text-gray-600 uppercase tracking-wider">Account</div>}

        <div className={cn("flex items-center gap-3 rounded-xl bg-white/5 p-3 mb-3 border border-white/5", isCollapsed && "justify-center bg-transparent border-0 p-0 mb-4")}>
          {!isCollapsed ? (
            <>
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center ring-1 ring-white/10 font-semibold text-sm text-white">
                {userInitials}
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="text-sm font-medium text-white truncate w-32" title={displayName}>
                  {displayName}
                </span>
                <span className="text-xs text-gray-400 truncate w-32">
                  @{user?.username}
                </span>
              </div>
            </>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center ring-1 ring-white/10 font-semibold text-sm text-white relative">
                    {userInitials}
                    <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-green-400 border border-black" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">{displayName}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        <Button
          variant="ghost"
          className={cn(
            "w-full gap-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors",
            isCollapsed && "justify-center px-0"
          )}
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" />
          {!isCollapsed && "Log Out"}
        </Button>
      </div>
    </motion.div>
  );
}
