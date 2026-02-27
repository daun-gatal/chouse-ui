/**
 * Tests for lib/devicePreferences.ts
 */

import { describe, it, expect } from "vitest";
import {
  getDeviceType,
  getDockPrefsFromWorkspace,
  getChatPrefsFromWorkspace,
  mergeDockPrefsIntoWorkspace,
  mergeChatPrefsIntoWorkspace,
  DOCK_DEFAULT_PREFERENCES_BY_DEVICE,
  CHAT_DEFAULT_POSITION_AND_SIZE_BY_DEVICE,
  type WorkspacePreferencesMap,
} from "./devicePreferences";

describe("devicePreferences", () => {
  describe("getDeviceType", () => {
    it("returns mobile for width <= 640", () => {
      expect(getDeviceType(0)).toBe("mobile");
      expect(getDeviceType(640)).toBe("mobile");
    });

    it("returns tablet for 641-1024", () => {
      expect(getDeviceType(641)).toBe("tablet");
      expect(getDeviceType(1024)).toBe("tablet");
    });

    it("returns laptop for 1025-1439", () => {
      expect(getDeviceType(1025)).toBe("laptop");
      expect(getDeviceType(1439)).toBe("laptop");
    });

    it("returns pc for width >= 1440", () => {
      expect(getDeviceType(1440)).toBe("pc");
      expect(getDeviceType(1920)).toBe("pc");
    });
  });

  describe("DOCK_DEFAULT_PREFERENCES_BY_DEVICE", () => {
    it("has defaults for all device types", () => {
      expect(DOCK_DEFAULT_PREFERENCES_BY_DEVICE.mobile).toEqual(
        expect.objectContaining({ placement: "bottom", mode: "floating", autoHide: true })
      );
      expect(DOCK_DEFAULT_PREFERENCES_BY_DEVICE.tablet).toEqual(
        expect.objectContaining({ placement: "bottom", mode: "floating", autoHide: true })
      );
      expect(DOCK_DEFAULT_PREFERENCES_BY_DEVICE.laptop).toEqual(
        expect.objectContaining({ placement: "bottom", mode: "sidebar", autoHide: true })
      );
      expect(DOCK_DEFAULT_PREFERENCES_BY_DEVICE.pc).toEqual(
        expect.objectContaining({ placement: "bottom", mode: "sidebar", autoHide: true })
      );
    });
  });

  describe("CHAT_DEFAULT_POSITION_AND_SIZE_BY_DEVICE", () => {
    it("has position and size for all device types", () => {
      for (const device of ["mobile", "tablet", "laptop", "pc"] as const) {
        const def = CHAT_DEFAULT_POSITION_AND_SIZE_BY_DEVICE[device];
        expect(def).toHaveProperty("position");
        expect(def.position).toHaveProperty("x");
        expect(def.position).toHaveProperty("y");
        expect(def).toHaveProperty("size");
        expect(def.size).toHaveProperty("width");
        expect(def.size).toHaveProperty("height");
      }
    });
  });

  describe("getDockPrefsFromWorkspace", () => {
    it("returns byDevice[device] when present", () => {
      const workspace: WorkspacePreferencesMap = {
        byDevice: {
          laptop: { dockPreferences: { placement: "left", mode: "floating" } },
        },
      };
      expect(getDockPrefsFromWorkspace(workspace, "laptop")).toEqual(
        expect.objectContaining({ placement: "left", mode: "floating" })
      );
    });

    it("falls back to legacy dockPreferences when byDevice[device] missing", () => {
      const workspace: WorkspacePreferencesMap = {
        dockPreferences: { placement: "top", autoHide: false },
      };
      expect(getDockPrefsFromWorkspace(workspace, "pc")).toEqual(
        expect.objectContaining({ placement: "top", autoHide: false })
      );
    });

    it("falls back to device default when nothing saved", () => {
      expect(getDockPrefsFromWorkspace(undefined, "mobile")).toEqual(
        DOCK_DEFAULT_PREFERENCES_BY_DEVICE.mobile
      );
      expect(getDockPrefsFromWorkspace({}, "tablet")).toEqual(
        DOCK_DEFAULT_PREFERENCES_BY_DEVICE.tablet
      );
    });
  });

  describe("getChatPrefsFromWorkspace", () => {
    it("returns position and size from byDevice[device] when present", () => {
      const workspace: WorkspacePreferencesMap = {
        byDevice: {
          tablet: {
            chatPreferences: { position: { x: 10, y: 20 }, size: { width: 600, height: 800 } },
          },
        },
      };
      const result = getChatPrefsFromWorkspace(workspace, "tablet");
      expect(result.position).toEqual({ x: 10, y: 20 });
      expect(result.size).toEqual({ width: 600, height: 800 });
    });

    it("falls back to legacy chatPreferences then default", () => {
      const workspace: WorkspacePreferencesMap = {
        chatPreferences: { position: { x: 5, y: 5 } },
      };
      const result = getChatPrefsFromWorkspace(workspace, "laptop");
      expect(result.position).toEqual({ x: 5, y: 5 });
      expect(result.size).toEqual(CHAT_DEFAULT_POSITION_AND_SIZE_BY_DEVICE.laptop.size);
    });

    it("returns device default when nothing saved", () => {
      const result = getChatPrefsFromWorkspace(undefined, "pc");
      expect(result.position).toEqual(CHAT_DEFAULT_POSITION_AND_SIZE_BY_DEVICE.pc.position);
      expect(result.size).toEqual(CHAT_DEFAULT_POSITION_AND_SIZE_BY_DEVICE.pc.size);
    });
  });

  describe("mergeDockPrefsIntoWorkspace", () => {
    it("sets byDevice[device].dockPreferences and preserves other keys", () => {
      const workspace: WorkspacePreferencesMap = { theme: "dark" };
      const merged = mergeDockPrefsIntoWorkspace(workspace, "mobile", {
        placement: "bottom",
        autoHide: true,
      });
      expect(merged.byDevice).toBeDefined();
      expect((merged as Record<string, unknown>).byDevice).toHaveProperty("mobile");
      const mobile = (merged as Record<string, unknown>).byDevice as Record<string, unknown>;
      expect(mobile.mobile).toEqual(
        expect.objectContaining({ dockPreferences: { placement: "bottom", autoHide: true } })
      );
      expect(merged.theme).toBe("dark");
    });

    it("preserves other device slices when merging one", () => {
      const workspace: WorkspacePreferencesMap = {
        byDevice: {
          tablet: { dockPreferences: { placement: "left" } },
        },
      };
      const merged = mergeDockPrefsIntoWorkspace(workspace, "pc", { placement: "right" });
      const byDevice = (merged as Record<string, unknown>).byDevice as Record<string, unknown>;
      expect(byDevice.tablet).toEqual(expect.objectContaining({ dockPreferences: { placement: "left" } }));
      expect(byDevice.pc).toEqual(expect.objectContaining({ dockPreferences: { placement: "right" } }));
    });
  });

  describe("mergeChatPrefsIntoWorkspace", () => {
    it("sets byDevice[device].chatPreferences with position and size", () => {
      const workspace: WorkspacePreferencesMap = {};
      const merged = mergeChatPrefsIntoWorkspace(workspace, "laptop", {
        position: { x: 40, y: 40 },
        size: { width: 420, height: 560 },
      });
      const laptop = ((merged as Record<string, unknown>).byDevice as Record<string, unknown>).laptop as Record<string, unknown>;
      expect(laptop.chatPreferences).toEqual({
        position: { x: 40, y: 40 },
        size: { width: 420, height: 560 },
      });
    });
  });
});
