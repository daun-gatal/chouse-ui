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
  PanelLeft,
  Dock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { motion, useDragControls, PanInfo, AnimatePresence } from "framer-motion";
import { withBasePath } from "@/lib/basePath";
import ConnectionSelector from "./ConnectionSelector";
import UserMenu from "@/components/sidebar/UserMenu";
import { version } from "../../../package.json";
import { rbacUserPreferencesApi } from "@/api/rbac";

// Storage keys for dock preferences (localStorage fallback)
const DOCK_POSITION_KEY = "chouseui-dock-position";
const DOCK_ORIENTATION_KEY = "chouseui-dock-orientation";
const DOCK_AUTOHIDE_KEY = "chouseui-dock-autohide";
const DOCK_MODE_KEY = "chouseui-dock-mode";

interface DockPosition {
  x: number;
  y: number;
}

type DockOrientation = "horizontal" | "vertical";
type DockMode = "floating" | "sidebar";

interface DockPreferences {
  mode?: DockMode;
  orientation?: DockOrientation;
  autoHide?: boolean;
  position?: DockPosition | null;
}

// Load dock preferences from localStorage (fallback)
function loadDockPositionFromLocal(): DockPosition | null {
  try {
    const saved = localStorage.getItem(DOCK_POSITION_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch {
    // Ignore errors
  }
  return null;
}

function saveDockPositionToLocal(position: DockPosition | null): void {
  try {
    if (position) {
      localStorage.setItem(DOCK_POSITION_KEY, JSON.stringify(position));
    } else {
      localStorage.removeItem(DOCK_POSITION_KEY);
    }
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
  return "floating";
}

function saveDockModeToLocal(mode: DockMode): void {
  try {
    localStorage.setItem(DOCK_MODE_KEY, mode);
  } catch {
    // Ignore errors
  }
}

// Database preference functions
async function loadDockPreferencesFromDb(): Promise<DockPreferences> {
  try {
    const preferences = await rbacUserPreferencesApi.getPreferences();
    const dockPrefs = preferences.workspacePreferences?.dockPreferences as DockPreferences | undefined;
    return dockPrefs || {};
  } catch (error) {
    console.error('[FloatingDock] Failed to fetch dock preferences:', error);
    return {};
  }
}

async function saveDockPreferencesToDb(dockPrefs: DockPreferences): Promise<void> {
  try {
    const currentPreferences = await rbacUserPreferencesApi.getPreferences();
    await rbacUserPreferencesApi.updatePreferences({
      workspacePreferences: {
        ...currentPreferences.workspacePreferences,
        dockPreferences: dockPrefs,
      },
    });
  } catch (error) {
    console.error('[FloatingDock] Failed to save dock preferences:', error);
  }
}

interface DockItemProps {
  icon: React.ElementType;
  label: string;
  to: string;
  isActive?: boolean;
  shortcut?: string;
  isVertical?: boolean;
}

const DockItem = ({ icon: Icon, label, to, isActive, shortcut, isVertical }: DockItemProps) => {
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
          className="bg-black/90 text-white border-white/10 backdrop-blur-xl px-2.5 py-1.5 text-xs"
        >
          <div className="flex items-center gap-2">
            <span>{label}</span>
            {shortcut && (
              <kbd className="px-1 py-0.5 rounded bg-white/10 text-[9px] font-mono text-gray-400">
                {shortcut}
              </kbd>
            )}
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
  const hasLoadedFromDb = useRef(false);

  // Dock state - initialize from localStorage for quick render
  const [orientation, setOrientation] = useState<DockOrientation>(loadDockOrientationFromLocal);
  const [position, setPosition] = useState<DockPosition | null>(loadDockPositionFromLocal);
  const [isDragging, setIsDragging] = useState(false);
  const [autoHide, setAutoHide] = useState(loadAutoHideFromLocal);
  const [isVisible, setIsVisible] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [dockMode, setDockMode] = useState<DockMode>(loadDockModeFromLocal);

  // Use RBAC store for all authentication
  const {
    hasPermission,
    hasAnyPermission,
    isAuthenticated,
  } = useRbacStore();

  // Load preferences from database on mount (authenticated users)
  useEffect(() => {
    if (!isAuthenticated || hasLoadedFromDb.current) return;

    const loadFromDb = async () => {
      try {
        const dbPrefs = await loadDockPreferencesFromDb();
        hasLoadedFromDb.current = true;

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
        if (dbPrefs.position !== undefined) {
          setPosition(dbPrefs.position);
          saveDockPositionToLocal(dbPrefs.position);
        }
      } catch (error) {
        console.error('[FloatingDock] Failed to load preferences from database:', error);
      }
    };

    loadFromDb();
  }, [isAuthenticated]);

  // Debounced save to database
  const saveToDatabaseDebounced = useCallback((prefs: DockPreferences) => {
    if (dbSyncTimeoutRef.current) {
      clearTimeout(dbSyncTimeoutRef.current);
    }
    dbSyncTimeoutRef.current = setTimeout(async () => {
      if (isAuthenticated) {
        await saveDockPreferencesToDb(prefs);
      }
      dbSyncTimeoutRef.current = null;
    }, 1000);
  }, [isAuthenticated]);

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

  const canViewSettings = hasPermission(RBAC_PERMISSIONS.SETTINGS_VIEW);

  const navItems = [
    ...(canViewOverview ? [{ icon: LayoutDashboard, label: "Home", to: "/overview", shortcut: "⌘1" }] : []),
    ...(canViewExplorer ? [{ icon: Database, label: "Explorer", to: "/explorer", shortcut: "⌘2" }] : []),
    ...(canViewMonitoring ? [{ icon: Activity, label: "Monitoring", to: "/monitoring", shortcut: "⌘3" }] : []),
    ...(canViewAdmin ? [{ icon: Shield, label: "Admin", to: "/admin", shortcut: "⌘4" }] : []),
    ...(canViewSettings ? [{ icon: Settings, label: "Settings", to: "/settings", shortcut: "⌘5" }] : []),
  ];

  // Auto-hide logic
  useEffect(() => {
    if (!autoHide || isHovered || isDragging) {
      setIsVisible(true);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      return;
    }

    // Start hide timer
    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 2000);

    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [autoHide, isHovered, isDragging]);

  // Handle drag end - save position
  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(false);
    const newPosition = {
      x: (position?.x || 0) + info.offset.x,
      y: (position?.y || 0) + info.offset.y,
    };
    setPosition(newPosition);
    saveDockPositionToLocal(newPosition);
    saveToDatabaseDebounced({ mode: dockMode, orientation, autoHide, position: newPosition });
  };

  // Toggle orientation
  const toggleOrientation = () => {
    const newOrientation = orientation === "horizontal" ? "vertical" : "horizontal";
    setOrientation(newOrientation);
    saveDockOrientationToLocal(newOrientation);
    saveToDatabaseDebounced({ mode: dockMode, orientation: newOrientation, autoHide, position });
  };

  // Toggle auto-hide
  const toggleAutoHide = () => {
    const newAutoHide = !autoHide;
    setAutoHide(newAutoHide);
    saveAutoHideToLocal(newAutoHide);
    saveToDatabaseDebounced({ mode: dockMode, orientation, autoHide: newAutoHide, position });
  };

  // Reset position
  const resetPosition = () => {
    setPosition(null);
    saveDockPositionToLocal(null);
    saveToDatabaseDebounced({ mode: dockMode, orientation, autoHide, position: null });
  };

  // Toggle dock mode (floating <-> sidebar)
  const toggleDockMode = () => {
    const newMode = dockMode === "floating" ? "sidebar" : "floating";
    setDockMode(newMode);
    saveDockModeToLocal(newMode);
    saveToDatabaseDebounced({ mode: newMode, orientation, autoHide, position });
    // Dispatch event so App.tsx can respond
    window.dispatchEvent(new CustomEvent("dock:mode-change", { detail: { mode: newMode } }));
  };

  // Dispatch mode on mount
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("dock:mode-change", { detail: { mode: dockMode } }));
  }, []);

  // Start drag from handle
  const startDrag = (event: React.PointerEvent) => {
    dragControls.start(event);
  };

  const isVertical = orientation === "vertical";
  const isSidebar = dockMode === "sidebar";

  // Calculate peek position for hidden state
  const hiddenOffset = isVertical ? { x: 50 } : { y: 60 };
  const visibleOffset = { x: position?.x || 0, y: position?.y || 0 };

  // Sidebar mode rendering
  if (isSidebar) {
    return (
      <motion.div
        initial={{ x: -80, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed left-0 top-0 h-full w-14 z-50 flex flex-col bg-black/60 backdrop-blur-2xl border-r border-white/10"
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
                shortcut={item.shortcut}
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
              <TooltipContent side="right" className="bg-black/90 text-white border-white/10 backdrop-blur-xl text-xs">
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

      {/* Hover trigger zone when hidden */}
      <AnimatePresence>
        {autoHide && !isVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseEnter={() => setIsVisible(true)}
            className={cn(
              "fixed z-50 cursor-pointer",
              isVertical
                ? "right-0 top-1/2 -translate-y-1/2 w-16 h-64"
                : "bottom-0 left-1/2 -translate-x-1/2 h-16 w-80"
            )}
          >
            <div className={cn(
              "flex items-center justify-center h-full w-full",
              isVertical ? "pr-2" : "pb-2"
            )}>
              <motion.div
                animate={{
                  opacity: [0.3, 0.5, 0.3],
                  scale: [1, 1.02, 1]
                }}
                transition={{ duration: 2.5, repeat: Infinity }}
                className={cn(
                  "rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center gap-1 border border-white/10",
                  isVertical ? "w-6 h-24 flex-col py-2" : "h-6 w-40 px-3"
                )}
              >
                {isVertical ? (
                  <>
                    <ChevronLeft className="w-3 h-3 text-white/50" />
                    <span className="text-[9px] text-white/50 font-medium writing-vertical">Menu</span>
                  </>
                ) : (
                  <>
                    <ChevronUp className="w-3 h-3 text-white/50" />
                    <span className="text-[9px] text-white/50 font-medium">Hover for menu</span>
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
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{
          opacity: isVisible ? 1 : 0,
          scale: isVisible ? 1 : 0.95,
          x: isVisible ? visibleOffset.x : (isVertical ? hiddenOffset.x : visibleOffset.x),
          y: isVisible ? visibleOffset.y : (isVertical ? visibleOffset.y : hiddenOffset.y),
        }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className={cn(
          "fixed z-50 pointer-events-auto",
          !position && (isVertical
            ? "right-3 top-1/2 -translate-y-1/2"
            : "bottom-3 left-1/2 -translate-x-1/2"
          ),
          !isVisible && "pointer-events-none"
        )}
        style={position ? { left: "50%", bottom: "12px" } : undefined}
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
                  className={cn(
                    "flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-white/10 transition-all cursor-grab active:cursor-grabbing",
                    isVertical ? "w-8 h-6" : "w-6 h-8"
                  )}
                >
                  <GripVertical className={cn("w-3 h-3", isVertical && "rotate-90")} />
                </button>
              </TooltipTrigger>
              <TooltipContent side={isVertical ? "right" : "top"} className="bg-black/90 text-white border-white/10 backdrop-blur-xl text-xs">
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
                shortcut={item.shortcut}
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
            {/* Toggle Auto-Hide */}
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleAutoHide}
                    className={cn(
                      "flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-white/10 transition-all",
                      isVertical ? "w-8 h-8" : "w-8 h-8",
                      autoHide && "text-purple-400"
                    )}
                  >
                    {isVertical ? (
                      autoHide ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />
                    ) : (
                      autoHide ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side={isVertical ? "right" : "top"} className="bg-black/90 text-white border-white/10 backdrop-blur-xl text-xs">
                  {autoHide ? "Auto-hide on" : "Auto-hide off"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Toggle Orientation */}
            {!isSidebar && (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={toggleOrientation}
                      className={cn(
                        "flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-white/10 transition-all",
                        isVertical ? "w-8 h-8" : "w-8 h-8"
                      )}
                    >
                      {isVertical ? (
                        <Rows className="w-3.5 h-3.5" />
                      ) : (
                        <Columns className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side={isVertical ? "right" : "top"} className="bg-black/90 text-white border-white/10 backdrop-blur-xl text-xs">
                    {isVertical ? "Horizontal" : "Vertical"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Toggle Dock Mode (Floating <-> Sidebar) */}
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleDockMode}
                    className={cn(
                      "flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-white/10 transition-all",
                      isSidebar ? "w-8 h-8" : "w-8 h-8",
                      isSidebar && "text-purple-400"
                    )}
                  >
                    {isSidebar ? (
                      <Dock className="w-3.5 h-3.5" />
                    ) : (
                      <PanelLeft className="w-3.5 h-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side={isSidebar ? "right" : isVertical ? "right" : "top"} className="bg-black/90 text-white border-white/10 backdrop-blur-xl text-xs">
                  {isSidebar ? "Switch to floating" : "Switch to sidebar"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Reset Position */}
            {position && !isSidebar && (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={resetPosition}
                      className={cn(
                        "flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-white/10 transition-all",
                        isVertical ? "w-8 h-8" : "w-8 h-8"
                      )}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side={isVertical ? "right" : "top"} className="bg-black/90 text-white border-white/10 backdrop-blur-xl text-xs">
                    Reset position
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}
