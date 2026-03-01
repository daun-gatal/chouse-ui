import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Database,
  Activity,
  Shield,
  Settings,
  GripVertical,
  RotateCcw,
  Columns,
  Rows,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  UserCog,
  PanelLeft,
  Dock,
  Maximize2,
  Minimize2,
  Pin,
  PinOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { log } from "@/lib/log";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { motion, useDragControls, PanInfo, AnimatePresence } from "framer-motion";
import { withBasePath } from "@/lib/basePath";
import ConnectionSelector from "./ConnectionSelector";
import UserMenu from "@/components/sidebar/UserMenu";
import { version } from "../../../package.json";
import { rbacUserPreferencesApi } from "@/api/rbac";
import { useDeviceType } from "@/hooks/useDeviceType";
import {
  getDockPrefsFromWorkspace,
  mergeDockPrefsIntoWorkspace,
  type DeviceType,
  type DockPreferences as DockPreferencesType,
  type WorkspacePreferencesMap,
} from "@/lib/devicePreferences";

// Storage keys for dock preferences (localStorage fallback)
const DOCK_PLACEMENT_KEY = "chouseui-dock-placement";
const DOCK_ORIENTATION_KEY = "chouseui-dock-orientation";
const DOCK_AUTOHIDE_KEY = "chouseui-dock-autohide";
const DOCK_MODE_KEY = "chouseui-dock-mode";

type DockPlacement = "bottom" | "top" | "left" | "right";
type DockOrientation = "horizontal" | "vertical";
type DockMode = "floating" | "sidebar";

type DockPreferences = DockPreferencesType;

// Load dock preferences from localStorage (fallback)
function loadDockPlacementFromLocal(): DockPlacement {
  try {
    const saved = localStorage.getItem(DOCK_PLACEMENT_KEY);
    if (saved === "bottom" || saved === "top" || saved === "left" || saved === "right") {
      return saved as DockPlacement;
    }
  } catch {
    // Ignore errors
  }
  return "bottom";
}

function saveDockPlacementToLocal(placement: DockPlacement): void {
  try {
    localStorage.setItem(DOCK_PLACEMENT_KEY, placement);
  } catch {
    // Ignore errors
  }
}

function loadDockOrientationFromLocal(): DockOrientation {
  try {
    const saved = localStorage.getItem(DOCK_ORIENTATION_KEY);
    if (saved === "vertical" || saved === "horizontal") {
      return saved;
    }
  } catch {
    // Ignore errors
  }
  return "horizontal";
}

function saveDockOrientationToLocal(orientation: DockOrientation): void {
  try {
    localStorage.setItem(DOCK_ORIENTATION_KEY, orientation);
  } catch {
    // Ignore errors
  }
}

function loadAutoHideFromLocal(): boolean {
  try {
    const saved = localStorage.getItem(DOCK_AUTOHIDE_KEY);
    return saved === "true";
  } catch {
    // Ignore errors
  }
  return true; // Default to auto-hide enabled
}

function saveAutoHideToLocal(autoHide: boolean): void {
  try {
    localStorage.setItem(DOCK_AUTOHIDE_KEY, String(autoHide));
  } catch {
    // Ignore errors
  }
}

function loadDockModeFromLocal(): DockMode {
  try {
    const saved = localStorage.getItem(DOCK_MODE_KEY);
    if (saved === "floating" || saved === "sidebar") {
      return saved;
    }
  } catch {
    // Ignore errors
  }
  return "sidebar";
}

function saveDockModeToLocal(mode: DockMode): void {
  try {
    localStorage.setItem(DOCK_MODE_KEY, mode);
  } catch {
    // Ignore errors
  }
}

// Database preference functions (device-aware: load/save per device type)
async function loadDockPreferencesFromDb(deviceType: DeviceType): Promise<DockPreferences> {
  try {
    const preferences = await rbacUserPreferencesApi.getPreferences();
    const workspace = preferences.workspacePreferences as WorkspacePreferencesMap | undefined;
    return getDockPrefsFromWorkspace(workspace, deviceType);
  } catch (error) {
    log.error("[FloatingDock] Failed to fetch dock preferences:", error);
    const { DOCK_DEFAULT_PREFERENCES_BY_DEVICE } = await import("@/lib/devicePreferences");
    return DOCK_DEFAULT_PREFERENCES_BY_DEVICE[deviceType];
  }
}

async function saveDockPreferencesToDb(deviceType: DeviceType, dockPrefs: DockPreferences): Promise<void> {
  try {
    const currentPreferences = await rbacUserPreferencesApi.getPreferences();
    const workspace = currentPreferences.workspacePreferences as WorkspacePreferencesMap | undefined;
    const merged = mergeDockPrefsIntoWorkspace(workspace, deviceType, dockPrefs);
    await rbacUserPreferencesApi.updatePreferences({ workspacePreferences: merged });
  } catch (error) {
    log.error("[FloatingDock] Failed to save dock preferences:", error);
  }
}

interface DockItemProps {
  icon: React.ElementType;
  label: string;
  to: string;
  isActive?: boolean;
  isVertical?: boolean;
}

const DockItem = ({ icon: Icon, label, to, isActive, isVertical }: DockItemProps) => {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={to}
            className={cn(
              "relative flex items-center justify-center rounded-lg transition-all duration-200 group",
              isVertical ? "w-10 h-10" : "w-10 h-10",
              isActive
                ? "bg-white/20 text-white"
                : "text-gray-400 hover:text-white hover:bg-white/10"
            )}
          >
            {/* Active indicator dot */}
            {isActive && (
              <motion.div
                layoutId="dock-active-dot"
                className={cn(
                  "absolute w-1 h-1 rounded-full bg-purple-400",
                  isVertical ? "-right-0.5" : "-bottom-0.5"
                )}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}

            <Icon className={cn(
              "w-[18px] h-[18px] z-10 transition-transform duration-200",
              isActive ? "text-white" : "group-hover:scale-110"
            )} />
          </Link>
        </TooltipTrigger>
        <TooltipContent
          side={isVertical ? "right" : "top"}
          sideOffset={8}
          className="z-[100] bg-black/90 text-white border-white/10 backdrop-blur-xl px-2.5 py-1.5 text-xs"
        >
          <div className="flex items-center gap-2">
            <span>{label}</span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

// Separator component
const DockSeparator = ({ isVertical }: { isVertical: boolean }) => (
  <div className={cn(
    "bg-white/10",
    isVertical ? "h-px w-6 my-0.5" : "w-px h-6 mx-0.5"
  )} />
);

export default function FloatingDock() {
  const location = useLocation();
  const Logo = withBasePath("logo.svg");
  const constraintsRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const dockRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dbSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastLoadedDeviceRef = useRef<DeviceType | null>(null);

  // Dock state - initialize from localStorage for quick render
  const [orientation, setOrientation] = useState<DockOrientation>(loadDockOrientationFromLocal);
  const [placement, setPlacement] = useState<DockPlacement>(loadDockPlacementFromLocal);
  const [isDragging, setIsDragging] = useState(false);
  const [autoHide, setAutoHide] = useState(loadAutoHideFromLocal);
  const [isVisible, setIsVisible] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [dockMode, setDockMode] = useState<DockMode>(loadDockModeFromLocal);
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  // Sync fullscreen state with browser
  useEffect(() => {
    const handleFullscreenChange = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        window.dispatchEvent(new CustomEvent("fullscreen:change", { detail: { active: true } }));
      } else {
        await document.exitFullscreen();
        window.dispatchEvent(new CustomEvent("fullscreen:change", { detail: { active: false } }));
      }
    } catch (err) {
      log.error("[FloatingDock] Fullscreen toggle failed:", err);
    }
  }, []);

  // Use RBAC store for all authentication
  const {
    hasPermission,
    hasAnyPermission,
    isAuthenticated,
  } = useRbacStore();

  const deviceType = useDeviceType();

  // Load preferences from database (authenticated users, per device type; re-load when device type changes)
  useEffect(() => {
    if (!isAuthenticated || lastLoadedDeviceRef.current === deviceType) return;

    const loadFromDb = async () => {
      try {
        const dbPrefs = await loadDockPreferencesFromDb(deviceType);
        lastLoadedDeviceRef.current = deviceType;

        if (dbPrefs.mode && dbPrefs.mode !== dockMode) {
          setDockMode(dbPrefs.mode);
          saveDockModeToLocal(dbPrefs.mode);
        }
        if (dbPrefs.orientation && dbPrefs.orientation !== orientation) {
          setOrientation(dbPrefs.orientation);
          saveDockOrientationToLocal(dbPrefs.orientation);
        }
        if (dbPrefs.autoHide !== undefined && dbPrefs.autoHide !== autoHide) {
          setAutoHide(dbPrefs.autoHide);
          saveAutoHideToLocal(dbPrefs.autoHide);
        }
        if (dbPrefs.placement !== undefined && dbPrefs.placement !== placement) {
          setPlacement(dbPrefs.placement);
          saveDockPlacementToLocal(dbPrefs.placement);
        }
      } catch (error) {
        log.error("[FloatingDock] Failed to load preferences from database:", error);
      }
    };

    loadFromDb();
  }, [isAuthenticated, deviceType]);

  // Debounced save to database (per device type)
  const saveToDatabaseDebounced = useCallback(
    (prefs: DockPreferences) => {
      if (dbSyncTimeoutRef.current) {
        clearTimeout(dbSyncTimeoutRef.current);
      }
      dbSyncTimeoutRef.current = setTimeout(async () => {
        if (isAuthenticated) {
          await saveDockPreferencesToDb(deviceType, prefs);
        }
        dbSyncTimeoutRef.current = null;
      }, 1000);
    },
    [isAuthenticated, deviceType]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (dbSyncTimeoutRef.current) {
        clearTimeout(dbSyncTimeoutRef.current);
      }
    };
  }, []);

  // Check permissions for various sections
  const canViewMonitoring = hasAnyPermission([
    RBAC_PERMISSIONS.LIVE_QUERIES_VIEW,
    RBAC_PERMISSIONS.METRICS_VIEW,
    RBAC_PERMISSIONS.METRICS_VIEW_ADVANCED,
    RBAC_PERMISSIONS.QUERY_HISTORY_VIEW,
    RBAC_PERMISSIONS.QUERY_HISTORY_VIEW_ALL,
  ]);

  const canViewAdmin = hasAnyPermission([
    RBAC_PERMISSIONS.USERS_VIEW,
    RBAC_PERMISSIONS.USERS_CREATE,
    RBAC_PERMISSIONS.ROLES_VIEW,
    RBAC_PERMISSIONS.AUDIT_VIEW,
  ]);

  const canViewOverview = true;

  const canViewExplorer = hasAnyPermission([
    RBAC_PERMISSIONS.DB_VIEW,
    RBAC_PERMISSIONS.TABLE_VIEW,
  ]);

  const canViewSettings = true;

  const navItems = [
    ...(canViewOverview ? [{ icon: LayoutDashboard, label: "Home", to: "/overview" }] : []),
    ...(canViewExplorer ? [{ icon: Database, label: "Explorer", to: "/explorer" }] : []),
    ...(canViewMonitoring ? [{ icon: Activity, label: "Monitoring", to: "/monitoring" }] : []),
    ...(canViewAdmin ? [{ icon: Shield, label: "Admin", to: "/admin" }] : []),
    ...(canViewSettings ? [{ icon: UserCog, label: "Preferences", to: "/preferences" }] : []),
  ];

  // Auto-hide logic
  useEffect(() => {
    if (!autoHide || isDragging) {
      setIsVisible(true);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      return;
    }

    if (isHovered) {
      // Mouse is on the dock — stay visible and cancel any hide timer
      setIsVisible(true);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      return;
    }

    // Mouse left the dock — start hide timer with a generous delay
    // to avoid flickering when moving between dock items
    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 3500);

    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [autoHide, isHovered, isDragging]);

  // Handle drag end - save placement
  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(false);
    const { x, y } = info.point;
    const w = window.innerWidth;
    const h = window.innerHeight;

    // Distances to edges
    const distTop = y;
    const distBottom = h - y;
    const distLeft = x;
    const distRight = w - x;

    const minDist = Math.min(distTop, distBottom, distLeft, distRight);
    let newPlacement: DockPlacement = "bottom";
    if (minDist === distTop) newPlacement = "top";
    else if (minDist === distBottom) newPlacement = "bottom";
    else if (minDist === distLeft) newPlacement = "left";
    else if (minDist === distRight) newPlacement = "right";

    // Auto-adjust orientation based on placement
    const newOrientation = (newPlacement === "left" || newPlacement === "right") ? "vertical" : "horizontal";

    setPlacement(newPlacement);
    setOrientation(newOrientation);
    saveDockPlacementToLocal(newPlacement);
    saveDockOrientationToLocal(newOrientation);
    saveToDatabaseDebounced({ mode: dockMode, orientation: newOrientation, autoHide, placement: newPlacement });
  };

  // Toggle orientation
  const toggleOrientation = () => {
    const newOrientation = orientation === "horizontal" ? "vertical" : "horizontal";
    setOrientation(newOrientation);
    saveDockOrientationToLocal(newOrientation);
    saveToDatabaseDebounced({ mode: dockMode, orientation: newOrientation, autoHide, placement });
  };

  // Toggle auto-hide
  const toggleAutoHide = () => {
    const newAutoHide = !autoHide;
    setAutoHide(newAutoHide);
    saveAutoHideToLocal(newAutoHide);
    saveToDatabaseDebounced({ mode: dockMode, orientation, autoHide: newAutoHide, placement });
  };

  // Reset placement
  const resetPosition = () => {
    setPlacement("bottom");
    setOrientation("horizontal");
    saveDockPlacementToLocal("bottom");
    saveDockOrientationToLocal("horizontal");
    saveToDatabaseDebounced({ mode: dockMode, orientation: "horizontal", autoHide, placement: "bottom" });
  };

  // Toggle dock mode (floating <-> sidebar)
  const toggleDockMode = () => {
    const newMode = dockMode === "floating" ? "sidebar" : "floating";
    setDockMode(newMode);
    saveDockModeToLocal(newMode);
    saveToDatabaseDebounced({ mode: newMode, orientation, autoHide, placement });
    // Dispatch event so App.tsx can respond
    window.dispatchEvent(new CustomEvent("dock:mode-change", { detail: { mode: newMode } }));
  };

  // Dispatch mode on mount
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("dock:mode-change", { detail: { mode: dockMode } }));
  }, []);

  // Start drag from handle
  const startDrag = (event: React.PointerEvent) => {
    // Prevent default touch behaviors to ensure smooth dragging on mobile/tablet
    if (event.pointerType === 'touch') {
      event.preventDefault();
    }
    dragControls.start(event);
  };

  const isVertical = orientation === "vertical";
  const isSidebar = dockMode === "sidebar";

  // Calculate offsets for animations based on placement
  const getVisibleAnimation = () => {
    switch (placement) {
      case "top": return { x: "-50%", y: 12 };
      case "bottom": return { x: "-50%", y: -12 };
      case "left": return { x: 12, y: "-50%" };
      case "right": return { x: -12, y: "-50%" };
      default: return { x: "-50%", y: -12 };
    }
  };

  const getHiddenAnimation = () => {
    switch (placement) {
      case "top": return { x: "-50%", y: -80 };
      case "bottom": return { x: "-50%", y: 80 };
      case "left": return { x: -80, y: "-50%" };
      case "right": return { x: 80, y: "-50%" };
      default: return { x: "-50%", y: 80 };
    }
  };

  const visibleAnim = getVisibleAnimation();
  const hiddenAnim = getHiddenAnimation();

  // Sidebar mode rendering (hidden during fullscreen — falls through to floating dock)
  if (isSidebar && !isFullscreen) {
    return (
      <motion.div
        initial={{ x: -80, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed left-0 top-0 h-full w-14 z-[70] flex flex-col bg-black/60 backdrop-blur-2xl border-r border-white/10"
      >
        <div className="flex flex-col items-center gap-2 px-2 py-4 h-full">
          {/* Logo & Branding */}
          <Link
            to="/overview"
            className="flex flex-col items-center gap-1 rounded-lg hover:bg-white/10 transition-colors p-2"
          >
            <img
              src={Logo}
              alt="CHouse UI"
              className="w-6 h-6 object-contain drop-shadow-[0_0_6px_rgba(255,200,0,0.4)]"
            />
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-semibold text-white/90">CHouse</span>
              <span className="text-[8px] font-mono text-purple-400/80">v{version}</span>
            </div>
          </Link>

          <DockSeparator isVertical={true} />

          {/* Navigation */}
          <nav className="flex flex-col items-center gap-1 flex-1">
            {navItems.map((item) => (
              <DockItem
                key={item.to}
                icon={item.icon}
                label={item.label}
                to={item.to}
                isActive={location.pathname.startsWith(item.to)}
                isVertical={true}
              />
            ))}
          </nav>

          <DockSeparator isVertical={true} />

          {/* Connection & User */}
          <div className="flex flex-col items-center gap-1">
            <TooltipProvider>
              <ConnectionSelector isCollapsed={true} />
            </TooltipProvider>
            <UserMenu isCollapsed={true} />
          </div>

          <DockSeparator isVertical={true} />

          {/* Fullscreen Toggle */}
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleFullscreen}
                  className="flex items-center justify-center w-8 h-8 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-all"
                >
                  {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="z-[100] bg-black/90 text-white border-white/10 backdrop-blur-xl text-xs">
                {isFullscreen ? "Exit full screen" : "Enter full screen"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Switch to Floating Mode */}
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleDockMode}
                  className="flex items-center justify-center w-8 h-8 rounded text-purple-400 hover:text-white hover:bg-white/10 transition-all"
                >
                  <Dock className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="z-[100] bg-black/90 text-white border-white/10 backdrop-blur-xl text-xs">
                Switch to floating dock
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </motion.div>
    );
  }

  // Floating dock mode rendering
  return (
    <>
      {/* Drag constraints container */}
      <div ref={constraintsRef} className="fixed inset-2 z-40 pointer-events-none" />

      {/* Hover/tap trigger zone when hidden (onPointerDown fixes touch-to-open on mobile) */}
      <AnimatePresence>
        {autoHide && !isVisible && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.3 }}
            onMouseEnter={() => {
              setIsHovered(false); // Reset so auto-hide timer starts for the dock
              setIsVisible(true);
            }}
            onPointerDown={() => {
              setIsHovered(false);
              setIsVisible(true);
            }}
            className={cn(
              "fixed z-[80] cursor-pointer",
              placement === "left" && "left-0 top-1/2 -translate-y-1/2 w-16 h-64",
              placement === "right" && "right-0 top-1/2 -translate-y-1/2 w-16 h-64",
              placement === "top" && "top-0 left-1/2 -translate-x-1/2 h-16 w-64",
              placement === "bottom" && "bottom-0 left-1/2 -translate-x-1/2 h-16 w-64"
            )}
          >
            <div className={cn(
              "flex items-center justify-center h-full w-full",
              isVertical ? "pr-2" : ""
            )}>
              <motion.div
                animate={{
                  opacity: [0.6, 0.9, 0.6],
                }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className={cn(
                  "rounded-2xl bg-black/60 backdrop-blur-xl flex items-center gap-2.5 border border-white/15 shadow-xl shadow-black/40",
                  isVertical ? "flex-col py-3 px-2 w-10" : "px-4 py-2"
                )}
              >
                {isVertical ? (
                  <>
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {(() => {
                      const currentNav = navItems.find(item => location.pathname.startsWith(item.to));
                      if (currentNav) {
                        const NavIcon = currentNav.icon;
                        return <NavIcon className="w-3.5 h-3.5 text-white/70" />;
                      }
                      return null;
                    })()}
                    <div className="h-px w-4 bg-white/15" />
                    <ChevronLeft className="w-3 h-3 text-white/60" />
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {(() => {
                        const currentNav = navItems.find(item => location.pathname.startsWith(item.to));
                        if (currentNav) {
                          const NavIcon = currentNav.icon;
                          return (
                            <>
                              <NavIcon className="w-3.5 h-3.5 text-white/70" />
                              <span className="text-[11px] text-white/60 font-medium">{currentNav.label}</span>
                            </>
                          );
                        }
                        return <span className="text-[11px] text-white/60 font-medium">CHouse</span>;
                      })()}
                    </div>
                    <div className="w-px h-3.5 bg-white/15" />
                    <div className="flex items-center gap-1.5">
                      <ChevronUp className="w-3 h-3 text-white/50" />
                      <span className="text-[10px] text-white/50 font-medium">Hover to show menu</span>
                    </div>
                  </>
                )}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        ref={dockRef}
        drag
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={constraintsRef}
        dragElastic={0.1}
        dragMomentum={false}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={handleDragEnd}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        initial={{ opacity: 0, scale: 0.9, ...visibleAnim }}
        animate={{
          opacity: isVisible ? 1 : 0,
          scale: isVisible ? 1 : 0.95,
          ...(isVisible ? visibleAnim : hiddenAnim)
        }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        style={{ touchAction: 'none' }}
        className={cn(
          "fixed z-[70] pointer-events-auto",
          placement === "top" && "top-0 left-1/2",
          placement === "bottom" && "bottom-0 left-1/2",
          placement === "left" && "left-0 top-1/2",
          placement === "right" && "right-0 top-1/2",
          !isVisible && "pointer-events-none"
        )}
      >
        <div className={cn(
          "flex items-center gap-1 px-1.5 py-1.5 rounded-2xl border transition-all duration-300",
          isVertical ? "flex-col" : "flex-row",
          isDragging
            ? "border-purple-500/50 bg-black/80 backdrop-blur-2xl shadow-lg shadow-purple-500/20"
            : isHovered
              ? "border-white/20 bg-black/60 backdrop-blur-2xl shadow-xl shadow-black/40"
              : "border-white/5 bg-black/40 backdrop-blur-xl shadow-lg shadow-black/30"
        )}>
          {/* Drag Handle */}
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onPointerDown={startDrag}
                  style={{ touchAction: 'none' }}
                  className={cn(
                    "flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-white/10 active:bg-white/20 transition-all cursor-grab active:cursor-grabbing touch-none",
                    // Minimum 44x44px touch target for accessibility on mobile/tablet
                    isVertical ? "w-8 h-6 min-w-[44px] min-h-[44px] sm:w-8 sm:h-6" : "w-6 h-8 min-w-[44px] min-h-[44px] sm:w-6 sm:h-8"
                  )}
                  aria-label="Drag to move dock"
                >
                  <GripVertical className={cn("w-3 h-3 sm:w-3 sm:h-3", isVertical && "rotate-90")} />
                </button>
              </TooltipTrigger>
              <TooltipContent side={isVertical ? "right" : "top"} className="z-[100] bg-black/90 text-white border-white/10 backdrop-blur-xl text-xs">
                Drag to move
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DockSeparator isVertical={isVertical} />

          {/* Logo & Branding */}
          <Link
            to="/overview"
            className={cn(
              "flex items-center gap-2 rounded-lg hover:bg-white/10 transition-colors px-2",
              isVertical ? "w-full h-auto py-2 flex-col" : "h-10"
            )}
          >
            <img
              src={Logo}
              alt="CHouse UI"
              className="w-5 h-5 object-contain drop-shadow-[0_0_6px_rgba(255,200,0,0.4)]"
            />
            <div className={cn(
              "flex items-center gap-1.5",
              isVertical && "flex-col gap-0"
            )}>
              <span className="text-xs font-semibold text-white/90">CHouse</span>
              <span className="text-[9px] font-mono text-purple-400/80">v{version}</span>
            </div>
          </Link>

          <DockSeparator isVertical={isVertical} />

          {/* Navigation */}
          <nav className={cn(
            "flex items-center gap-0.5",
            isVertical ? "flex-col" : "flex-row"
          )}>
            {navItems.map((item) => (
              <DockItem
                key={item.to}
                icon={item.icon}
                label={item.label}
                to={item.to}
                isActive={location.pathname.startsWith(item.to)}
                isVertical={isVertical}
              />
            ))}
          </nav>

          <DockSeparator isVertical={isVertical} />

          {/* Connection & User */}
          <div className={cn(
            "flex items-center gap-0.5",
            isVertical ? "flex-col" : "flex-row"
          )}>
            <TooltipProvider>
              <ConnectionSelector isCollapsed={true} />
            </TooltipProvider>
            <UserMenu isCollapsed={true} />
          </div>

          <DockSeparator isVertical={isVertical} />

          {/* Dock Controls */}
          <div className={cn(
            "flex items-center gap-0.5",
            isVertical ? "flex-col" : "flex-row"
          )}>
            {/* Fullscreen Toggle — always visible */}
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleFullscreen}
                    className={cn(
                      "flex items-center justify-center rounded transition-all",
                      isVertical ? "w-8 h-8" : "w-8 h-8",
                      isFullscreen
                        ? "text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
                        : "text-gray-400 hover:text-white hover:bg-white/10"
                    )}
                  >
                    {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side={isVertical ? "right" : "top"} className="z-[100] bg-black/90 text-white border-white/10 backdrop-blur-xl text-xs">
                  {isFullscreen ? "Exit full screen" : "Enter full screen"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Manual Hide — only when auto-hide is enabled */}
            {autoHide && (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => {
                        setIsHovered(false);
                        setIsVisible(false);
                      }}
                      className={cn(
                        "flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-white/10 transition-all",
                        isVertical ? "w-8 h-8" : "w-8 h-8"
                      )}
                    >
                      {isVertical ? (
                        <ChevronRight className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side={isVertical ? "right" : "top"} className="z-[100] bg-black/90 text-white border-white/10 backdrop-blur-xl text-xs">
                    Hide dock
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Settings Popover — all other dock controls */}
            <Popover>
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <PopoverTrigger asChild>
                    <TooltipTrigger asChild>
                      <button
                        className={cn(
                          "flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-white/10 transition-all",
                          isVertical ? "w-8 h-8" : "w-8 h-8"
                        )}
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                  </PopoverTrigger>
                  <TooltipContent side={isVertical ? "right" : "top"} className="z-[100] bg-black/90 text-white border-white/10 backdrop-blur-xl text-xs">
                    Dock settings
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <PopoverContent
                side={isVertical ? "right" : "top"}
                sideOffset={12}
                className="z-[100] w-56 p-2 bg-black/90 backdrop-blur-2xl border-white/10 rounded-xl shadow-2xl shadow-black/50"
              >
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold px-2 py-1">Dock Settings</p>

                  {/* Pin / Unpin */}
                  <button
                    onClick={toggleAutoHide}
                    className="flex items-center gap-3 w-full px-2 py-2 rounded-lg hover:bg-white/10 transition-colors group"
                  >
                    <div className={cn(
                      "p-1.5 rounded-md transition-colors",
                      autoHide ? "bg-emerald-500/20" : "bg-white/5"
                    )}>
                      {autoHide ? <PinOff className="w-3.5 h-3.5 text-emerald-400" /> : <Pin className="w-3.5 h-3.5 text-gray-400" />}
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-xs font-medium text-zinc-200">Auto-hide</p>
                      <p className="text-[10px] text-zinc-500">{autoHide ? "Dock hides when inactive" : "Dock always visible"}</p>
                    </div>
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      autoHide ? "bg-emerald-400" : "bg-zinc-600"
                    )} />
                  </button>

                  {/* Orientation */}
                  {!isSidebar && !isFullscreen && (
                    <button
                      onClick={toggleOrientation}
                      className="flex items-center gap-3 w-full px-2 py-2 rounded-lg hover:bg-white/10 transition-colors group"
                    >
                      <div className="p-1.5 rounded-md bg-white/5">
                        {isVertical ? <Rows className="w-3.5 h-3.5 text-gray-400" /> : <Columns className="w-3.5 h-3.5 text-gray-400" />}
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-xs font-medium text-zinc-200">Orientation</p>
                        <p className="text-[10px] text-zinc-500">{isVertical ? "Vertical layout" : "Horizontal layout"}</p>
                      </div>
                      <span className="text-[10px] text-zinc-500 font-mono">{isVertical ? "V" : "H"}</span>
                    </button>
                  )}

                  {/* Dock Mode */}
                  {!isFullscreen && (
                    <button
                      onClick={toggleDockMode}
                      className="flex items-center gap-3 w-full px-2 py-2 rounded-lg hover:bg-white/10 transition-colors group"
                    >
                      <div className="p-1.5 rounded-md bg-white/5">
                        {isSidebar ? <Dock className="w-3.5 h-3.5 text-gray-400" /> : <PanelLeft className="w-3.5 h-3.5 text-gray-400" />}
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-xs font-medium text-zinc-200">Dock Mode</p>
                        <p className="text-[10px] text-zinc-500">{isSidebar ? "Sidebar mode" : "Floating mode"}</p>
                      </div>
                    </button>
                  )}

                  {/* Reset Position */}
                  {placement !== "bottom" && !isSidebar && (
                    <>
                      <div className="h-px bg-white/5 mx-1" />
                      <button
                        onClick={resetPosition}
                        className="flex items-center gap-3 w-full px-2 py-2 rounded-lg hover:bg-white/10 transition-colors group"
                      >
                        <div className="p-1.5 rounded-md bg-white/5">
                          <RotateCcw className="w-3.5 h-3.5 text-gray-400" />
                        </div>
                        <div className="flex-1 text-left">
                          <p className="text-xs font-medium text-zinc-200">Reset Position</p>
                          <p className="text-[10px] text-zinc-500">Move dock to default spot</p>
                        </div>
                      </button>
                    </>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </motion.div>
    </>
  );
}
