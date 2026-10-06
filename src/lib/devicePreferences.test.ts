/**
 * Tests for lib/devicePreferences.ts
 */

import { describe, it, expect } from "vitest";
import {
  getDeviceType,
  getDockPrefsFromWorkspace,
  getChatSheetWidth,
  mergeDockPrefsIntoWorkspace,
  mergeChatSheetWidthIntoWorkspace,
  DOCK_DEFAULT_PREFERENCES_BY_DEVICE,
  CHAT_SHEET_DEFAULT_WIDTH_BY_DEVICE,
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
        expect.objectContaining({ placement: "bottom", mode: "floating", autoHide: true, sessionExpanded: false })
      );
      expect(DOCK_DEFAULT_PREFERENCES_BY_DEVICE.tablet).toEqual(
        expect.objectContaining({ placement: "bottom", mode: "floating", autoHide: true, sessionExpanded: false })
      );
      expect(DOCK_DEFAULT_PREFERENCES_BY_DEVICE.laptop).toEqual(
        expect.objectContaining({ placement: "bottom", mode: "sidebar", autoHide: true, sessionExpanded: false })
      );
      expect(DOCK_DEFAULT_PREFERENCES_BY_DEVICE.pc).toEqual(
        expect.objectContaining({ placement: "bottom", mode: "sidebar", autoHide: true, sessionExpanded: false })
      );
    });
  });

  describe("CHAT_SHEET_DEFAULT_WIDTH_BY_DEVICE", () => {
    it("opens the sheet wide on every docked device", () => {
      for (const device of ["tablet", "laptop", "pc"] as const) {
        expect(CHAT_SHEET_DEFAULT_WIDTH_BY_DEVICE[device]).toBeGreaterThanOrEqual(680);
      }
      expect(CHAT_SHEET_DEFAULT_WIDTH_BY_DEVICE.pc).toBeGreaterThan(CHAT_SHEET_DEFAULT_WIDTH_BY_DEVICE.laptop);
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

  describe("getChatSheetWidth", () => {
    it("returns the width the user dragged to", () => {
      const workspace: WorkspacePreferencesMap = { byDevice: { laptop: { chatPreferences: { sheetWidth: 640 } } } };
      expect(getChatSheetWidth(workspace, "laptop")).toBe(640);
    });

    it("ignores legacy floating-window geometry and uses the device default", () => {
      const workspace = {
        chatPreferences: { size: { width: 420, height: 560 } },
        byDevice: { laptop: { chatPreferences: { position: { x: 40, y: 40 }, size: { width: 420, height: 0 } } } },
      } as WorkspacePreferencesMap;
      expect(getChatSheetWidth(workspace, "laptop")).toBe(CHAT_SHEET_DEFAULT_WIDTH_BY_DEVICE.laptop);
    });

    it("returns the device default when nothing is saved", () => {
      expect(getChatSheetWidth(undefined, "pc")).toBe(CHAT_SHEET_DEFAULT_WIDTH_BY_DEVICE.pc);
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

  describe("mergeChatSheetWidthIntoWorkspace", () => {
    it("stores only the sheet width and keeps the dock slice", () => {
      const workspace: WorkspacePreferencesMap = {
        byDevice: { laptop: { dockPreferences: { placement: "left" }, chatPreferences: { sheetWidth: 500 } } },
      };
      const merged = mergeChatSheetWidthIntoWorkspace(workspace, "laptop", 720);
      const laptop = ((merged as Record<string, unknown>).byDevice as Record<string, unknown>).laptop as Record<string, unknown>;
      expect(laptop.chatPreferences).toEqual({ sheetWidth: 720 });
      expect(laptop.dockPreferences).toEqual({ placement: "left" });
    });
  });
});
