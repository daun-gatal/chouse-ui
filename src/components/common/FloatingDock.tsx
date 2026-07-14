import { useState, useRef, useEffect, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Globe2,
  LayoutDashboard,
  Database,
  Activity,
  Workflow,
  Stethoscope,
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
  BookOpen,
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
import {
  ADMIN_ACCESS_PERMISSIONS,
  MONITORING_ACCESS_PERMISSIONS,
  EXPLORER_ACCESS_PERMISSIONS,
  DATAOPS_ACCESS_PERMISSIONS,
} from "@/lib/navAccess";
import { motion, useDragControls, PanInfo, AnimatePresence } from "framer-motion";
import { withBasePath } from "@/lib/basePath";
import ConnectionSelector from "./ConnectionSelector";
import UserMenu from "@/components/sidebar/UserMenu";
import FleetAlertsDockItem from "@/features/fleet/components/FleetAlertsDockItem";
import { useOnboardingStore } from "@/features/onboarding/store";
import { version } from "../../../package.json";
import { rbacUserPreferencesApi } from "@/api/rbac";
import { useDeviceType } from "@/hooks/useDeviceType";
import {
  DOCK_DEFAULT_PREFERENCES_BY_DEVICE,
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

interface ResolvedDockPreferences {
  placement: DockPlacement;
  orientation: DockOrientation;
  autoHide: boolean;
  mode: DockMode;
}

function GettingStartedDockButton({ side }: { side: "top" | "right" }): React.JSX.Element {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("onboarding:open"))}
            data-onboarding-id="getting-started-launcher"
            className="grid h-8 w-8 min-h-[44px] min-w-[44px] place-items-center rounded-xs text-paper-dim transition-colors hover:bg-ink-200 hover:text-brand sm:min-h-0 sm:min-w-0"
            aria-label="Open Getting Started"
          >
            <BookOpen className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side={side} className={TOOLTIP_CLASS}>
          Getting Started
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ============================================
// localStorage helpers
// ============================================

export function loadDockPreferencesFromLocal(
  deviceType: DeviceType,
  storage: Pick<Storage, "getItem"> = localStorage,
): ResolvedDockPreferences {
  const defaults = DOCK_DEFAULT_PREFERENCES_BY_DEVICE[deviceType];
  const fallback: ResolvedDockPreferences = {
    placement: defaults.placement ?? "bottom",
    orientation: defaults.orientation ?? "horizontal",
    autoHide: defaults.autoHide ?? true,
    mode: defaults.mode ?? "floating",
  };

  try {
    const placement = storage.getItem(DOCK_PLACEMENT_KEY);
    const orientation = storage.getItem(DOCK_ORIENTATION_KEY);
    const autoHide = storage.getItem(DOCK_AUTOHIDE_KEY);
    const mode = storage.getItem(DOCK_MODE_KEY);
    return {
      placement: placement === "bottom" || placement === "top" || placement === "left" || placement === "right"
        ? placement
        : fallback.placement,
      orientation: orientation === "vertical" || orientation === "horizontal"
        ? orientation
        : fallback.orientation,
      autoHide: autoHide === "true" ? true : autoHide === "false" ? false : fallback.autoHide,
      mode: mode === "floating" || mode === "sidebar" ? mode : fallback.mode,
    };
  } catch {
    return fallback;
  }
}

function saveDockPlacementToLocal(placement: DockPlacement): void {
  try {
    localStorage.setItem(DOCK_PLACEMENT_KEY, placement);
  } catch {
    // Ignore errors
  }
}

function saveDockOrientationToLocal(orientation: DockOrientation): void {
  try {
    localStorage.setItem(DOCK_ORIENTATION_KEY, orientation);
  } catch {
    // Ignore errors
  }
}

function saveAutoHideToLocal(autoHide: boolean): void {
  try {
    localStorage.setItem(DOCK_AUTOHIDE_KEY, String(autoHide));
  } catch {
    // Ignore errors
  }
}

function saveDockModeToLocal(mode: DockMode): void {
  try {
    localStorage.setItem(DOCK_MODE_KEY, mode);
  } catch {
    // Ignore errors
  }
}

async function loadDockPreferencesFromDb(deviceType: DeviceType): Promise<DockPreferences> {
  const preferences = await rbacUserPreferencesApi.getPreferences();
  const workspace = preferences.workspacePreferences as WorkspacePreferencesMap | undefined;
  return getDockPrefsFromWorkspace(workspace, deviceType);
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

// ============================================
// Editorial primitives
// ============================================

const TOOLTIP_CLASS =
  "z-[100] rounded-xs border border-ink-500 bg-ink-200 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted shadow-lg";

interface DockItemProps {
  icon: React.ElementType;
  label: string;
  to: string;
  isActive?: boolean;
  isVertical?: boolean;
}

const DockItem = ({ icon: Icon, label, to, isActive, isVertical }: DockItemProps) => (
  <TooltipProvider delayDuration={0}>
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={to}
          className={cn(
            "group relative grid h-9 w-9 shrink-0 place-items-center rounded-xs transition-colors",
            isActive
              ? "text-paper"
              : "text-paper-dim hover:bg-ink-200 hover:text-paper"
          )}
          aria-label={label}
          aria-current={isActive ? "page" : undefined}
        >
          {isActive && (
            <motion.span
              layoutId="dock-active-marker"
              className={cn(
                "absolute bg-brand",
                isVertical
                  ? "left-0 top-1/2 h-5 w-[2px] -translate-y-1/2"
                  : "bottom-0 left-1/2 h-[2px] w-5 -translate-x-1/2"
              )}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
          )}
          <Icon className="h-[17px] w-[17px]" aria-hidden />
        </Link>
      </TooltipTrigger>
      <TooltipContent side={isVertical ? "right" : "top"} sideOffset={8} className={TOOLTIP_CLASS}>
        {label}
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

const DockSeparator = ({ isVertical }: { isVertical: boolean }) => (
  <div
    className={cn(
      "shrink-0 bg-ink-500",
      isVertical ? "my-1 h-px w-6" : "mx-1 h-6 w-px"
    )}
    aria-hidden
  />
);

// ============================================
// Main component
// ============================================

export default function FloatingDock() {
  const location = useLocation();
  const deviceType = useDeviceType();
  const Logo = withBasePath("logo.svg");
  const constraintsRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const dockRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dbSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastLoadedDeviceRef = useRef<DeviceType | null>(null);
  const initialPreferencesRef = useRef<ResolvedDockPreferences | null>(null);
  initialPreferencesRef.current ??= loadDockPreferencesFromLocal(deviceType);
  const initialPreferences = initialPreferencesRef.current;

  const [orientation, setOrientation] = useState<DockOrientation>(initialPreferences.orientation);
  const [placement, setPlacement] = useState<DockPlacement>(initialPreferences.placement);
  const [isDragging, setIsDragging] = useState(false);
  const [autoHide, setAutoHide] = useState(initialPreferences.autoHide);
  const [isVisible, setIsVisible] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [dockMode, setDockMode] = useState<DockMode>(initialPreferences.mode);
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

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

  const { hasAnyPermission, isAuthenticated } = useRbacStore();
  const isOnboardingGuideActive = useOnboardingStore((state) => state.activeChapterId !== null);
  const isMobile = deviceType === "mobile";

  // Load preferences from database
  useEffect(() => {
    if (
      !isAuthenticated
      || isOnboardingGuideActive
      || lastLoadedDeviceRef.current === deviceType
    ) return;

    const loadFromDb = async () => {
      try {
        const dbPrefs = await loadDockPreferencesFromDb(deviceType);
        // A guide may have started while the request was in flight. Apply the
        // saved layout after it closes so the highlighted dock never jumps.
        if (useOnboardingStore.getState().activeChapterId !== null) return;
        lastLoadedDeviceRef.current = deviceType;

        if (dbPrefs.mode && dbPrefs.mode !== dockMode) {
          setDockMode(dbPrefs.mode);
          saveDockModeToLocal(dbPrefs.mode);
          window.dispatchEvent(new CustomEvent("dock:mode-change", { detail: { mode: dbPrefs.mode } }));
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
  }, [isAuthenticated, isOnboardingGuideActive, deviceType]);

  // Debounced save to database
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

  useEffect(() => {
    return () => {
      if (dbSyncTimeoutRef.current) {
        clearTimeout(dbSyncTimeoutRef.current);
      }
    };
  }, []);

  const canViewMonitoring = hasAnyPermission(MONITORING_ACCESS_PERMISSIONS);

  const canViewDataOps = hasAnyPermission(DATAOPS_ACCESS_PERMISSIONS);

  const canViewAdmin = hasAnyPermission(ADMIN_ACCESS_PERMISSIONS);

  const canViewExplorer = hasAnyPermission(EXPLORER_ACCESS_PERMISSIONS);

  const canViewFleet = hasAnyPermission([RBAC_PERMISSIONS.FLEET_VIEW]);
  const canViewDoctor = hasAnyPermission([RBAC_PERMISSIONS.DOCTOR_VIEW]);

  const navItems = [
    ...(canViewFleet ? [{ icon: Globe2, label: "Fleet", to: "/fleet" }] : []),
    ...(canViewDoctor ? [{ icon: Stethoscope, label: "Doctor", to: "/doctor" }] : []),
    { icon: LayoutDashboard, label: "Home", to: "/overview" },
    ...(canViewExplorer ? [{ icon: Database, label: "Explorer", to: "/explorer" }] : []),
    ...(canViewMonitoring ? [{ icon: Activity, label: "Monitoring", to: "/monitoring" }] : []),
    ...(canViewDataOps ? [{ icon: Workflow, label: "DataOps", to: "/dataops" }] : []),
    ...(canViewAdmin ? [{ icon: Shield, label: "Admin", to: "/admin" }] : []),
    { icon: UserCog, label: "Preferences", to: "/preferences" },
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
      setIsVisible(true);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      return;
    }

    hideTimeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 3500);

    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [autoHide, isHovered, isDragging]);

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(false);
    const { x, y } = info.point;
    const w = window.innerWidth;
    const h = window.innerHeight;

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

    const newOrientation = (newPlacement === "left" || newPlacement === "right") ? "vertical" : "horizontal";

    setPlacement(newPlacement);
    setOrientation(newOrientation);
    saveDockPlacementToLocal(newPlacement);
    saveDockOrientationToLocal(newOrientation);
    saveToDatabaseDebounced({ mode: dockMode, orientation: newOrientation, autoHide, placement: newPlacement });
  };

  const toggleOrientation = () => {
    const newOrientation = orientation === "horizontal" ? "vertical" : "horizontal";
    setOrientation(newOrientation);
    saveDockOrientationToLocal(newOrientation);
    saveToDatabaseDebounced({ mode: dockMode, orientation: newOrientation, autoHide, placement });
  };

  const toggleAutoHide = () => {
    const newAutoHide = !autoHide;
    setAutoHide(newAutoHide);
    saveAutoHideToLocal(newAutoHide);
    saveToDatabaseDebounced({ mode: dockMode, orientation, autoHide: newAutoHide, placement });
  };

  const resetPosition = () => {
    setPlacement("bottom");
    setOrientation("horizontal");
    saveDockPlacementToLocal("bottom");
    saveDockOrientationToLocal("horizontal");
    saveToDatabaseDebounced({ mode: dockMode, orientation: "horizontal", autoHide, placement: "bottom" });
  };

  const toggleDockMode = () => {
    const newMode = dockMode === "floating" ? "sidebar" : "floating";
    setDockMode(newMode);
    saveDockModeToLocal(newMode);
    saveToDatabaseDebounced({ mode: newMode, orientation, autoHide, placement });
    window.dispatchEvent(new CustomEvent("dock:mode-change", { detail: { mode: newMode } }));
  };

  // Sync App.tsx layout state on mount. Defer to a microtask so any parent
  // effect that attaches a listener has a chance to register first (React
  // runs child effects before parent effects, otherwise this event is lost).
  useEffect(() => {
    saveDockModeToLocal(dockMode);
    const id = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("dock:mode-change", { detail: { mode: dockMode } }));
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  // Listen for the global "toggle dock mode" event so the command palette
  // (and any other surface) can flip floating↔sidebar without holding a ref.
  useEffect(() => {
    const handler = () => toggleDockMode();
    window.addEventListener("dock:toggle-mode", handler);
    return () => window.removeEventListener("dock:toggle-mode", handler);
  }, [dockMode]);

  const startDrag = (event: React.PointerEvent) => {
    if (event.pointerType === "touch") {
      event.preventDefault();
    }
    dragControls.start(event);
  };

  const isVertical = orientation === "vertical";
  const isSidebar = dockMode === "sidebar";

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
  // Preserve the user's auto-hide state underneath the temporary guide pin.
  const isDockVisible = isOnboardingGuideActive || isVisible;

  // ============================================
  // Sidebar mode rendering (hidden during fullscreen)
  // ============================================
  if (isSidebar && !isFullscreen) {
    return (
      <motion.div
        data-onboarding-id="app-navigation"
        initial={{ x: -80, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed left-0 top-0 z-[70] flex h-full w-14 flex-col border-r border-ink-500 bg-ink-50"
      >
        <div className="flex h-full flex-col items-center gap-2 overflow-hidden px-2 py-4">
          {!isMobile && (
            <>
              <Link
                to="/overview"
                className="flex flex-col items-center gap-1 rounded-xs p-2 transition-colors hover:bg-ink-200"
              >
                <img src={Logo} alt="CHouse UI" className="h-6 w-6 object-contain" />
                <div className="flex flex-col items-center gap-0">
                  <span className="text-[10px] font-semibold text-paper">CH<span className="text-paper-dim">/UI</span></span>
                  <span className="font-mono text-[8px] text-paper-faint">v{version}</span>
                </div>
              </Link>

              <DockSeparator isVertical />
            </>
          )}

          {/* Navigation */}
          <nav
            data-mobile-dock-nav={isMobile ? "true" : undefined}
            className="custom-scrollbar flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto overscroll-contain touch-pan-y"
          >
            {isMobile && canViewFleet && <FleetAlertsDockItem side="right" />}
            {navItems.map((item) => (
              <DockItem
                key={item.to}
                icon={item.icon}
                label={item.label}
                to={item.to}
                isActive={location.pathname.startsWith(item.to)}
                isVertical
              />
            ))}
          </nav>

          <DockSeparator isVertical />

          {/* Connection & User */}
          <div
            data-mobile-dock-essentials={isMobile ? "sidebar" : undefined}
            className="flex shrink-0 flex-col items-center gap-1"
          >
            <GettingStartedDockButton side="right" />
            {!isMobile && canViewFleet && <FleetAlertsDockItem side="right" />}
            <TooltipProvider>
              <ConnectionSelector isCollapsed={true} />
            </TooltipProvider>
            <UserMenu isCollapsed={true} />
          </div>

          <DockSeparator isVertical />

          {/* Fullscreen is collapsed out of the short mobile sidebar. */}
          {!isMobile && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="grid h-8 w-8 place-items-center rounded-xs text-paper-dim transition-colors hover:bg-ink-200 hover:text-paper"
                    aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
                  >
                    {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className={TOOLTIP_CLASS}>
                  {isFullscreen ? "Exit full screen" : "Enter full screen"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Switch to floating */}
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={toggleDockMode}
                  className="grid h-8 w-8 place-items-center rounded-xs text-paper-dim transition-colors hover:bg-ink-200 hover:text-brand"
                  aria-label="Switch to floating dock"
                >
                  <Dock className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className={TOOLTIP_CLASS}>
                Switch to floating
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </motion.div>
    );
  }

  // ============================================
  // Floating mode rendering
  // ============================================
  return (
    <>
      <div ref={constraintsRef} className="pointer-events-none fixed inset-2 z-40" />

      {/* Hover trigger when hidden */}
      <AnimatePresence>
        {autoHide && !isDockVisible && (
          <motion.button
            type="button"
            aria-label="Show dock"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            onMouseEnter={() => {
              setIsHovered(false);
              setIsVisible(true);
            }}
            onPointerDown={() => {
              setIsHovered(false);
              setIsVisible(true);
            }}
            onClick={() => {
              setIsHovered(false);
              setIsVisible(true);
            }}
            className={cn(
              "fixed z-[80] cursor-pointer",
              placement === "left" && "left-0 top-1/2 h-64 w-16 -translate-y-1/2",
              placement === "right" && "right-0 top-1/2 h-64 w-16 -translate-y-1/2",
              placement === "top" && "left-1/2 top-0 h-16 w-64 -translate-x-1/2",
              placement === "bottom" && "bottom-0 left-1/2 h-16 w-64 -translate-x-1/2"
            )}
          >
            <div
              className={cn(
                "flex h-full w-full items-center justify-center",
                isVertical ? "pr-2" : ""
              )}
            >
              <div
                className={cn(
                  "flex items-center gap-2 rounded-xs border border-ink-500 bg-ink-100 px-3 py-1.5",
                  isVertical && "flex-col py-2 px-1.5"
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                {(() => {
                  const currentNav = navItems.find((item) => location.pathname.startsWith(item.to));
                  if (!currentNav) return null;
                  const NavIcon = currentNav.icon;
                  return <NavIcon className="h-3.5 w-3.5 text-paper-muted" aria-hidden />;
                })()}
                {!isVertical && (
                  <>
                    <span className="h-3 w-px bg-ink-500" aria-hidden />
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-dim">
                      Show dock
                    </span>
                    <ChevronUp className="h-3 w-3 text-paper-dim" aria-hidden />
                  </>
                )}
                {isVertical && (
                  <ChevronLeft className="h-3 w-3 text-paper-dim" aria-hidden />
                )}
              </div>
            </div>
          </motion.button>
        )}
      </AnimatePresence>

      <motion.div
        data-onboarding-id="app-navigation"
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
        initial={{ opacity: 0, ...visibleAnim }}
        animate={{
          opacity: isDockVisible ? 1 : 0,
          ...(isDockVisible ? visibleAnim : hiddenAnim),
        }}
        transition={isMobile
          ? { duration: 0.2, ease: [0.32, 0.72, 0, 1] }
          : { type: "spring", stiffness: 300, damping: 30 }}
        style={{ touchAction: isMobile ? "auto" : "none" }}
        className={cn(
          "fixed z-[70] pointer-events-auto",
          placement === "top" && "left-1/2 top-0",
          placement === "bottom" && "bottom-0 left-1/2",
          placement === "left" && "left-0 top-1/2",
          placement === "right" && "right-0 top-1/2",
          !isDockVisible && "pointer-events-none"
        )}
      >
        <div
          data-mobile-dock-layout={isMobile ? (isVertical ? "vertical" : "horizontal") : undefined}
          className={cn(
            "flex items-center gap-1 rounded-md border bg-ink-100 px-1.5 py-1.5 transition-colors duration-200",
            isVertical ? "flex-col" : "flex-row",
            isMobile && isVertical && "max-h-[calc(100dvh-1.5rem)] overflow-hidden",
            isMobile && !isVertical && "w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-hidden",
            isDragging
              ? "border-brand"
              : isHovered
                ? "border-ink-700"
                : "border-ink-500"
          )}
        >
          {/* Drag handle */}
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onPointerDown={startDrag}
                  style={{ touchAction: "none" }}
                  className={cn(
                    "grid place-items-center rounded-xs text-paper-faint transition-colors hover:bg-ink-200 hover:text-paper active:cursor-grabbing cursor-grab",
                    isVertical
                      ? "h-6 w-8 min-h-[44px] min-w-[44px] sm:h-6 sm:w-8"
                      : "h-8 w-6 min-h-[44px] min-w-[44px] sm:h-8 sm:w-6"
                  )}
                  aria-label="Drag to move dock"
                >
                  <GripVertical className={cn("h-3 w-3", isVertical && "rotate-90")} aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent side={isVertical ? "right" : "top"} className={TOOLTIP_CLASS}>
                Drag to move
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DockSeparator isVertical={isVertical} />

          {/* Desktop/tablet branding; mobile reserves this width for navigation. */}
          {!isMobile && (
            <>
              <Link
                to="/overview"
                className={cn(
                  "flex items-center gap-2 rounded-xs px-2 transition-colors hover:bg-ink-200",
                  isVertical ? "h-auto w-full flex-col py-2" : "h-9"
                )}
              >
                <img src={Logo} alt="CHouse UI" className="h-5 w-5 object-contain" />
                <div
                  className={cn(
                    "flex items-center gap-1.5",
                    isVertical && "flex-col gap-0"
                  )}
                >
                  <span className="text-xs font-semibold text-paper">
                    CH<span className="text-paper-dim">/UI</span>
                  </span>
                  <span className="font-mono text-[9px] text-paper-faint">v{version}</span>
                </div>
              </Link>

              <DockSeparator isVertical={isVertical} />
            </>
          )}

          {/* Navigation */}
          <nav
            data-mobile-dock-nav={isMobile ? "true" : undefined}
            className={cn(
              "flex items-center gap-0.5",
              isVertical ? "flex-col" : "flex-row",
              isMobile && isVertical && "custom-scrollbar min-h-0 w-full flex-1 overflow-y-auto overscroll-contain touch-pan-y",
              isMobile && !isVertical && "min-w-0 flex-1 overflow-x-auto overscroll-contain touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            )}
          >
            {isMobile && canViewFleet && (
              <FleetAlertsDockItem side={isVertical ? "right" : "top"} />
            )}
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
          <div
            data-mobile-dock-essentials={isMobile ? "account" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-0.5",
              isVertical ? "flex-col" : "flex-row"
            )}
          >
            {!isMobile && canViewFleet && <FleetAlertsDockItem side={isVertical ? "right" : "top"} />}
            <TooltipProvider>
              <ConnectionSelector isCollapsed={true} />
            </TooltipProvider>
            <UserMenu isCollapsed={true} />
          </div>

          {!isMobile && <DockSeparator isVertical={isVertical} />}

          {/* Controls */}
          <div
            data-mobile-dock-essentials={isMobile ? "guide" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-0.5",
              isVertical ? "flex-col" : "flex-row"
            )}
          >
            <GettingStartedDockButton side={isVertical ? "right" : "top"} />
            {!isMobile && (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      className={cn(
                        "grid h-8 w-8 place-items-center rounded-xs transition-colors hover:bg-ink-200",
                        isFullscreen ? "text-brand" : "text-paper-dim hover:text-paper"
                      )}
                      aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
                    >
                      {isFullscreen ? (
                        <Minimize2 className="h-3.5 w-3.5" />
                      ) : (
                        <Maximize2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side={isVertical ? "right" : "top"} className={TOOLTIP_CLASS}>
                    {isFullscreen ? "Exit full screen" : "Enter full screen"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {!isMobile && autoHide && (
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setIsHovered(false);
                        setIsVisible(false);
                      }}
                      className="grid h-8 w-8 place-items-center rounded-xs text-paper-dim transition-colors hover:bg-ink-200 hover:text-paper"
                      aria-label="Hide dock"
                    >
                      {isVertical ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side={isVertical ? "right" : "top"} className={TOOLTIP_CLASS}>
                    Hide dock
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            {/* Settings popover */}
            <Popover>
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <PopoverTrigger asChild>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="grid h-8 w-8 place-items-center rounded-xs text-paper-dim transition-colors hover:bg-ink-200 hover:text-paper"
                        aria-label="Dock settings"
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                  </PopoverTrigger>
                  <TooltipContent side={isVertical ? "right" : "top"} className={TOOLTIP_CLASS}>
                    Dock settings
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <PopoverContent
                side={isVertical ? "right" : "top"}
                sideOffset={12}
                className="z-[100] w-60 rounded-md border border-ink-500 bg-ink-100 p-0 shadow-xl"
              >
                <div className="border-b border-ink-500 px-3 py-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                    Dock settings
                  </p>
                </div>
                <div className="flex flex-col py-1">
                  <SettingRow
                    icon={autoHide ? PinOff : Pin}
                    label="Auto-hide"
                    sub={autoHide ? "Hides when inactive" : "Always visible"}
                    onClick={toggleAutoHide}
                    state={autoHide ? "on" : "off"}
                  />

                  {!isSidebar && !isFullscreen && (
                    <SettingRow
                      icon={isVertical ? Rows : Columns}
                      label="Orientation"
                      sub={isVertical ? "Vertical" : "Horizontal"}
                      onClick={toggleOrientation}
                      trailing={
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                          {isVertical ? "V" : "H"}
                        </span>
                      }
                    />
                  )}

                  {!isFullscreen && (
                    <SettingRow
                      icon={isSidebar ? Dock : PanelLeft}
                      label="Dock mode"
                      sub={isSidebar ? "Sidebar mode" : "Floating mode"}
                      onClick={toggleDockMode}
                    />
                  )}

                  {placement !== "bottom" && !isSidebar && (
                    <>
                      <div className="my-1 h-px bg-ink-500" aria-hidden />
                      <SettingRow
                        icon={RotateCcw}
                        label="Reset position"
                        sub="Move to default spot"
                        onClick={resetPosition}
                      />
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

// ============================================
// Setting row primitive (popover items)
// ============================================

interface SettingRowProps {
  icon: React.ElementType;
  label: string;
  sub: string;
  onClick: () => void;
  state?: "on" | "off";
  trailing?: React.ReactNode;
}

function SettingRow({ icon: Icon, label, sub, onClick, state, trailing }: SettingRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-ink-200"
    >
      <span className="grid h-7 w-7 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted transition-colors group-hover:border-ink-700 group-hover:text-paper">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-medium text-paper">{label}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
          {sub}
        </span>
      </span>
      {state && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            state === "on" ? "bg-brand" : "bg-ink-700"
          )}
          aria-hidden
        />
      )}
      {trailing}
    </button>
  );
}
