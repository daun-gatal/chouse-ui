import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FloatingDock, { loadDockPreferencesFromLocal } from "./FloatingDock";

const mocks = vi.hoisted(() => ({
  deviceType: "mobile" as "mobile" | "tablet" | "laptop" | "pc",
  isAuthenticated: false,
  activeChapterId: null as string | null,
  getPreferences: vi.fn(),
}));

vi.mock("@/hooks/useDeviceType", () => ({
  useDeviceType: () => mocks.deviceType,
}));

vi.mock("@/stores", () => ({
  RBAC_PERMISSIONS: {
    FLEET_VIEW: "fleet:view",
    DOCTOR_VIEW: "doctor:view",
  },
  useRbacStore: () => ({
    hasAnyPermission: () => true,
    isAuthenticated: mocks.isAuthenticated,
  }),
}));

vi.mock("@/lib/navAccess", () => ({
  ADMIN_ACCESS_PERMISSIONS: ["admin:view"],
  MONITORING_ACCESS_PERMISSIONS: ["monitoring:view"],
  EXPLORER_ACCESS_PERMISSIONS: ["explorer:view"],
  DATAOPS_ACCESS_PERMISSIONS: ["dataops:view"],
}));

vi.mock("@/features/onboarding/store", () => {
  const useOnboardingStore = Object.assign(
    (selector: (state: { activeChapterId: string | null }) => unknown) =>
      selector({ activeChapterId: mocks.activeChapterId }),
    {
      getState: () => ({ activeChapterId: mocks.activeChapterId }),
    },
  );

  return { useOnboardingStore };
});

vi.mock("@/api/rbac", () => ({
  rbacUserPreferencesApi: {
    getPreferences: mocks.getPreferences,
    updatePreferences: vi.fn(),
  },
}));

vi.mock("@/components/common/ConnectionSelector", () => ({
  default: () => <button type="button">Connection</button>,
}));

vi.mock("@/components/sidebar/UserMenu", () => ({
  default: () => <button type="button">User menu</button>,
}));

vi.mock("@/features/fleet/components/FleetAlertsDockItem", () => ({
  default: () => <button type="button">Fleet alerts</button>,
}));

describe("FloatingDock mobile layout", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.deviceType = "mobile";
    mocks.isAuthenticated = false;
    mocks.activeChapterId = null;
    mocks.getPreferences.mockReset();
    mocks.getPreferences.mockResolvedValue({});
  });

  it("uses the current device defaults when local storage has no valid override", () => {
    const emptyStorage = { getItem: () => null };

    expect(loadDockPreferencesFromLocal("mobile", emptyStorage)).toEqual({
      placement: "bottom",
      orientation: "horizontal",
      autoHide: true,
      mode: "floating",
    });
    expect(loadDockPreferencesFromLocal("laptop", emptyStorage)).toEqual({
      placement: "bottom",
      orientation: "horizontal",
      autoHide: true,
      mode: "sidebar",
    });
  });

  it("exposes the auto-hidden mobile dock as an accessible reveal button", () => {
    vi.useFakeTimers();
    try {
      render(
        <MemoryRouter initialEntries={["/overview"]}>
          <FloatingDock />
        </MemoryRouter>,
      );

      act(() => vi.advanceTimersByTime(3_500));

      expect(screen.getByRole("button", { name: "Show dock" })).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves valid local overrides and ignores invalid values", () => {
    const values: Record<string, string> = {
      "chouseui-dock-placement": "left",
      "chouseui-dock-orientation": "invalid",
      "chouseui-dock-autohide": "false",
      "chouseui-dock-mode": "sidebar",
    };

    expect(loadDockPreferencesFromLocal("mobile", {
      getItem: (key) => values[key] ?? null,
    })).toEqual({
      placement: "left",
      orientation: "horizontal",
      autoHide: false,
      mode: "sidebar",
    });
  });

  it("keeps guide and account actions fixed while only navigation scrolls", async () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <FloatingDock />
      </MemoryRouter>,
    );

    const layout = document.querySelector<HTMLElement>('[data-mobile-dock-layout="horizontal"]');
    const navigation = document.querySelector<HTMLElement>('[data-mobile-dock-nav="true"]');
    const accountActions = document.querySelector<HTMLElement>('[data-mobile-dock-essentials="account"]');
    const guideActions = document.querySelector<HTMLElement>('[data-mobile-dock-essentials="guide"]');

    expect(layout).not.toBeNull();
    expect(layout?.classList.contains("w-[calc(100vw-1.5rem)]")).toBe(true);
    expect(layout?.classList.contains("overflow-hidden")).toBe(true);
    expect(navigation?.classList.contains("min-w-0")).toBe(true);
    expect(navigation?.classList.contains("flex-1")).toBe(true);
    expect(navigation?.classList.contains("overflow-x-auto")).toBe(true);
    expect(accountActions?.classList.contains("shrink-0")).toBe(true);
    expect(guideActions?.classList.contains("shrink-0")).toBe(true);
    expect(accountActions?.contains(screen.getByRole("button", { name: "Connection" }))).toBe(true);
    expect(accountActions?.contains(screen.getByRole("button", { name: "User menu" }))).toBe(true);
    expect(guideActions?.contains(screen.getByRole("button", { name: "Open Getting Started" }))).toBe(true);
    expect(navigation?.contains(screen.getByRole("button", { name: "Fleet alerts" }))).toBe(true);
    expect(screen.queryByAltText("CHouse UI")).toBeNull();

    await waitFor(() => expect(localStorage.getItem("chouseui-dock-mode")).toBe("floating"));
  });

  it("keeps essential actions visible while the mobile sidebar navigation scrolls", async () => {
    localStorage.setItem("chouseui-dock-mode", "sidebar");

    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <FloatingDock />
      </MemoryRouter>,
    );

    const navigation = document.querySelector<HTMLElement>('[data-mobile-dock-nav="true"]');
    const essentials = document.querySelector<HTMLElement>('[data-mobile-dock-essentials="sidebar"]');

    expect(navigation?.classList.contains("min-h-0")).toBe(true);
    expect(navigation?.classList.contains("flex-1")).toBe(true);
    expect(navigation?.classList.contains("overflow-y-auto")).toBe(true);
    expect(navigation?.contains(screen.getByRole("button", { name: "Fleet alerts" }))).toBe(true);
    expect(essentials?.classList.contains("shrink-0")).toBe(true);
    expect(essentials?.contains(screen.getByRole("button", { name: "Open Getting Started" }))).toBe(true);
    expect(essentials?.contains(screen.getByRole("button", { name: "Connection" }))).toBe(true);
    expect(essentials?.contains(screen.getByRole("button", { name: "User menu" }))).toBe(true);
    expect(screen.queryByAltText("CHouse UI")).toBeNull();
    expect(screen.queryByRole("button", { name: "Enter full screen" })).toBeNull();
    expect(screen.getByRole("button", { name: "Switch to floating dock" })).not.toBeNull();

    await waitFor(() => expect(localStorage.getItem("chouseui-dock-mode")).toBe("sidebar"));
  });

  it("emits a mode-change event when the server loads a different dock mode", async () => {
    mocks.isAuthenticated = true;
    mocks.getPreferences.mockResolvedValue({
      workspacePreferences: {
        byDevice: {
          mobile: {
            dockPreferences: { mode: "sidebar" },
          },
        },
      },
    });
    const receivedModes: string[] = [];
    const handleModeChange = (event: Event): void => {
      if (event instanceof CustomEvent && event.detail?.mode === "sidebar") {
        receivedModes.push(event.detail.mode);
      }
    };
    window.addEventListener("dock:mode-change", handleModeChange);

    try {
      render(
        <MemoryRouter initialEntries={["/overview"]}>
          <FloatingDock />
        </MemoryRouter>,
      );

      await waitFor(() => expect(receivedModes).toEqual(["sidebar"]));
      expect(mocks.getPreferences).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Switch to floating dock" })).not.toBeNull();
      expect(localStorage.getItem("chouseui-dock-mode")).toBe("sidebar");
    } finally {
      window.removeEventListener("dock:mode-change", handleModeChange);
    }
  });

  it("defers server preference loading until the onboarding guide closes", async () => {
    mocks.isAuthenticated = true;
    mocks.activeChapterId = "shell";
    mocks.getPreferences.mockResolvedValue({
      workspacePreferences: {
        byDevice: {
          mobile: {
            dockPreferences: { mode: "sidebar" },
          },
        },
      },
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={["/overview"]}>
        <FloatingDock />
      </MemoryRouter>,
    );

    expect(mocks.getPreferences).not.toHaveBeenCalled();

    mocks.activeChapterId = null;
    rerender(
      <MemoryRouter initialEntries={["/overview"]}>
        <FloatingDock />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mocks.getPreferences).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Switch to floating dock" })).not.toBeNull(),
    );
  });

  it("preserves a valid local layout when the server preference request fails", async () => {
    localStorage.setItem("chouseui-dock-mode", "sidebar");
    mocks.isAuthenticated = true;
    mocks.getPreferences.mockRejectedValueOnce(new Error("offline"));

    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <FloatingDock />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mocks.getPreferences).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Switch to floating dock" })).not.toBeNull();
    expect(localStorage.getItem("chouseui-dock-mode")).toBe("sidebar");
  });
});
