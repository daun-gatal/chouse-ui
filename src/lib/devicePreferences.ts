/**
 * Device type and per-device preference defaults.
 * Used by FloatingDock and AiChatBubble to store/load position and size per device.
 */

export type DeviceType = "mobile" | "tablet" | "laptop" | "pc";

export interface DockPreferences {
  mode?: "floating" | "sidebar";
  orientation?: "horizontal" | "vertical";
  autoHide?: boolean;
  placement?: "top" | "bottom" | "left" | "right";
}

export interface ChatPreferences {
  position?: { x: number; y: number };
  size?: { width: number; height: number };
}

export interface DeviceWorkspacePrefs {
  dockPreferences?: DockPreferences;
  chatPreferences?: ChatPreferences;
}

export type WorkspacePreferencesMap = Record<string, unknown> & {
  dockPreferences?: DockPreferences;
  chatPreferences?: ChatPreferences;
  byDevice?: Partial<Record<DeviceType, DeviceWorkspacePrefs>>;
};

/**
 * Derive device type from viewport width.
 * mobile: ≤640, tablet: 641–1024, laptop: 1025–1439, pc: ≥1440
 */
export function getDeviceType(width: number): DeviceType {
  if (width <= 640) return "mobile";
  if (width <= 1024) return "tablet";
  if (width < 1440) return "laptop";
  return "pc";
}

/** Default dock preferences per device type (placement, mode, autoHide). */
export const DOCK_DEFAULT_PREFERENCES_BY_DEVICE: Record<DeviceType, DockPreferences> = {
  mobile: { placement: "bottom", mode: "floating", orientation: "horizontal", autoHide: true },
  tablet: { placement: "bottom", mode: "floating", orientation: "horizontal", autoHide: true },
  laptop: { placement: "bottom", mode: "sidebar", orientation: "horizontal", autoHide: true },
  pc: { placement: "bottom", mode: "sidebar", orientation: "horizontal", autoHide: true },
};

/** Default chat position and size per device type. */
export const CHAT_DEFAULT_POSITION_AND_SIZE_BY_DEVICE: Record<
  DeviceType,
  { position: { x: number; y: number }; size: { width: number; height: number } }
> = {
  mobile: { position: { x: 0, y: 0 }, size: { width: 0, height: 0 } }, // full viewport; size ignored
  tablet: { position: { x: 24, y: 24 }, size: { width: 680, height: 840 } },
  laptop: { position: { x: 40, y: 40 }, size: { width: 420, height: 560 } },
  pc: { position: { x: 80, y: 80 }, size: { width: 520, height: 700 } },
};

/**
 * Resolve dock preferences for a device: byDevice[device] → legacy dockPreferences → default.
 */
export function getDockPrefsFromWorkspace(
  workspace: WorkspacePreferencesMap | undefined,
  deviceType: DeviceType
): DockPreferences {
  const byDevice = workspace?.byDevice?.[deviceType]?.dockPreferences;
  if (byDevice && Object.keys(byDevice).length > 0) return byDevice;
  const legacy = workspace?.dockPreferences;
  if (legacy && Object.keys(legacy).length > 0) return legacy;
  return DOCK_DEFAULT_PREFERENCES_BY_DEVICE[deviceType];
}

/**
 * Resolve chat preferences (position + size) for a device: byDevice[device] → legacy → default.
 */
export function getChatPrefsFromWorkspace(
  workspace: WorkspacePreferencesMap | undefined,
  deviceType: DeviceType
): { position: { x: number; y: number }; size: { width: number; height: number } } {
  const byDevice = workspace?.byDevice?.[deviceType]?.chatPreferences;
  const legacy = workspace?.chatPreferences as ChatPreferences | undefined;
  const defaultForDevice = CHAT_DEFAULT_POSITION_AND_SIZE_BY_DEVICE[deviceType];

  const position = byDevice?.position ?? legacy?.position ?? defaultForDevice.position;
  const size = byDevice?.size ?? legacy?.size ?? defaultForDevice.size;

  return {
    position: { x: position?.x ?? 0, y: position?.y ?? 0 },
    size: { width: size?.width ?? defaultForDevice.size.width, height: size?.height ?? defaultForDevice.size.height },
  };
}

/**
 * Merge dock preferences for a device into a copy of workspacePreferences (for PUT).
 */
export function mergeDockPrefsIntoWorkspace(
  workspace: WorkspacePreferencesMap | undefined,
  deviceType: DeviceType,
  dockPrefs: DockPreferences
): Record<string, unknown> {
  const current = (workspace ?? {}) as Record<string, unknown>;
  const byDevice = { ...(current.byDevice as Record<string, unknown> | undefined) };
  const deviceSlice = { ...(byDevice[deviceType] as Record<string, unknown> | undefined), dockPreferences: dockPrefs };
  byDevice[deviceType] = deviceSlice;
  return { ...current, byDevice };
}

/**
 * Merge chat preferences (position + size) for a device into a copy of workspacePreferences (for PUT).
 */
export function mergeChatPrefsIntoWorkspace(
  workspace: WorkspacePreferencesMap | undefined,
  deviceType: DeviceType,
  chatPrefs: ChatPreferences
): Record<string, unknown> {
  const current = (workspace ?? {}) as Record<string, unknown>;
  const byDevice = { ...(current.byDevice as Record<string, unknown> | undefined) };
  const deviceSlice = { ...(byDevice[deviceType] as Record<string, unknown> | undefined), chatPreferences: chatPrefs };
  byDevice[deviceType] = deviceSlice;
  return { ...current, byDevice };
}
