/**
 * Tests for lib/devicePreferences.ts
 */

import { describe, it, expect } from "vitest";
import {
  getDeviceType,
  getDockPrefsFromWorkspace,
  mergeDockPrefsIntoWorkspace,
  DOCK_DEFAULT_PREFERENCES_BY_DEVICE,
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

});
