import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FleetUpgradeNode, VersionStatus } from "@/api/upgrades";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FleetVersion, upgradesPath } from "./FleetVersion";

const status = (over: Partial<VersionStatus> = {}): VersionStatus => ({
  version: "25.8.33.6", line: "25.8", lts: true, supported: true, supportEnded: null, expectedEnd: { line: "26.8", month: "2026-08" },
  latestPatch: "25.8.33.6", latestDate: "2026-08-26", newerPatch: false, ...over,
});
const node = (over: Partial<FleetUpgradeNode> = {}): FleetUpgradeNode => ({ connectionId: "c1", name: "billing", version: "25.8.33.6", status: status(), lastCheck: null, ...over });

function renderVersion(n: FleetUpgradeNode | undefined, onOpen = vi.fn()): ReturnType<typeof render> {
  return render(<TooltipProvider><FleetVersion version="25.8.33.6" node={n} onOpen={onOpen} /></TooltipProvider>);
}

describe("FleetVersion", () => {
  it("stays plain text for readers without upgrades:view", () => {
    renderVersion(undefined);
    expect(screen.getByText("25.8.33.6").tagName).toBe("SPAN");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is red when out of support, amber with a newer patch, and uncoloured when current", () => {
    const { unmount } = renderVersion(node({ status: status({ supported: false, supportEnded: { by: "26.8", date: "2026-08-30" } }) }));
    expect(screen.getByRole("button").className).toContain("text-red-500");
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("Out of support since 26.8 shipped");
    unmount();
    const second = renderVersion(node({ status: status({ newerPatch: true, latestPatch: "25.8.40.1" }) }));
    expect(screen.getByRole("button").className).toContain("text-amber-600");
    second.unmount();
    renderVersion(node());
    expect(screen.getByRole("button").className).not.toMatch(/text-(red|amber)/);
  });

  it("opens Upgrades on the last checked target, else the newer patch", () => {
    const onOpen = vi.fn();
    renderVersion(node({ lastCheck: { id: "a", targetVersion: "26.8.36.3", mode: "exact", counts: { blocker: 2, warning: 3, info: 0, note: 0 }, at: 1 } }), onOpen);
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith("/monitoring/upgrades?target=26.8.36.3");
    expect(upgradesPath(node({ status: status({ newerPatch: true, latestPatch: "25.8.40.1" }) }))).toBe("/monitoring/upgrades?target=25.8.40.1");
    expect(upgradesPath(node())).toBe("/monitoring/upgrades");
    expect(upgradesPath(undefined)).toBe("/monitoring/upgrades");
  });
});
