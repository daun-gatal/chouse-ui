import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RBAC_PERMISSIONS } from "@/stores";

import { OnboardingProvider } from "./OnboardingProvider";
import { useOnboardingStore } from "./store";

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}{location.search}</output>;
}

const mocks = vi.hoisted(() => ({
  authState: { activeConnectionId: "connection-1" as string | null },
  rbacState: {
    isAuthenticated: true,
    permissions: [] as string[],
    roles: [] as string[],
    user: { id: "user-1" },
  },
}));

vi.mock("@/api", () => ({
  rbacUserPreferencesApi: {
    getOnboarding: vi.fn(),
    updateOnboarding: vi.fn(async () => ({
      progress: {
        formatRevision: 1,
        welcomeSeen: true,
        completedChapterIds: [],
        dismissedChapterIds: [],
        lastStepIndex: 0,
      },
      bootstrapOnboardingPending: false,
      requiresPasswordChange: false,
    })),
  },
}));

vi.mock("@/stores", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores")>();
  return {
    ...actual,
    useAuthStore: (selector: (state: typeof mocks.authState) => unknown) => selector(mocks.authState),
    useRbacStore: (selector: (state: typeof mocks.rbacState) => unknown) => selector(mocks.rbacState),
  };
});

describe("OnboardingProvider", () => {
  beforeEach(() => {
    mocks.authState.activeConnectionId = "connection-1";
    mocks.rbacState.permissions = [];
    mocks.rbacState.roles = [];
    useOnboardingStore.getState().reset();
    useOnboardingStore.setState({
      initializedForUserId: "user-1",
      activeChapterId: "shell",
      activeStepIndex: 0,
      isHubOpen: true,
    });
  });

  it("never renders the hub and coachmark at the same time", async () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <OnboardingProvider />
      </MemoryRouter>,
    );

    expect(screen.getByText("Getting started with CHouse")).toBeTruthy();
    expect(screen.queryByText("Your product map")).toBeNull();

    act(() => useOnboardingStore.setState({ isHubOpen: false }));

    expect(screen.queryByText("Getting started with CHouse")).toBeNull();
    expect(await screen.findByText("Your product map")).toBeTruthy();
  });

  it("uses super-admin effective permissions for every chapter", () => {
    mocks.rbacState.roles = ["super_admin"];
    useOnboardingStore.setState({ activeChapterId: null, isHubOpen: true });

    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <OnboardingProvider />
      </MemoryRouter>,
    );

    expect(screen.getByText("Explore data and write SQL")).toBeTruthy();
    expect(screen.getByText("Investigate cluster behavior")).toBeTruthy();
    expect(screen.getByText("Administer CHouse safely")).toBeTruthy();
  });

  it("removes a stale Monitoring guide query once no chapter owns the route", async () => {
    useOnboardingStore.setState({ activeChapterId: null, isHubOpen: false });

    render(
      <MemoryRouter initialEntries={["/monitoring/logs?range=6h&guide=patterns"]}>
        <LocationProbe />
        <OnboardingProvider />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Current route").textContent).toBe("/monitoring/logs?range=6h");
    });
  });

  it("exits the active Fleet chapter when its connection eligibility is lost", async () => {
    mocks.rbacState.permissions = [RBAC_PERMISSIONS.FLEET_VIEW, RBAC_PERMISSIONS.DOCTOR_VIEW];
    useOnboardingStore.setState({
      activeChapterId: "fleet",
      activeStepIndex: 0,
      isHubOpen: false,
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={["/fleet"]}>
        <OnboardingProvider />
      </MemoryRouter>,
    );

    expect(useOnboardingStore.getState().activeChapterId).toBe("fleet");
    mocks.authState.activeConnectionId = null;
    rerender(
      <MemoryRouter initialEntries={["/fleet"]}>
        <OnboardingProvider />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(useOnboardingStore.getState().activeChapterId).toBeNull();
      expect(useOnboardingStore.getState().activeStepIndex).toBe(0);
    });
  });

  it("exits instead of remapping the current index when eligible steps change", async () => {
    mocks.rbacState.permissions = [RBAC_PERMISSIONS.LOGS_VIEW, RBAC_PERMISSIONS.METRICS_VIEW_ADVANCED];
    useOnboardingStore.setState({
      activeChapterId: "monitoring",
      activeStepIndex: 6,
      isHubOpen: false,
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={["/monitoring/metrics"]}>
        <OnboardingProvider />
      </MemoryRouter>,
    );

    expect(useOnboardingStore.getState().activeChapterId).toBe("monitoring");
    mocks.rbacState.permissions = [RBAC_PERMISSIONS.LOGS_VIEW];
    rerender(
      <MemoryRouter initialEntries={["/monitoring/metrics"]}>
        <OnboardingProvider />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(useOnboardingStore.getState().activeChapterId).toBeNull();
      expect(useOnboardingStore.getState().progress.lastStepIndex).toBe(6);
    });
  });

  it("exits an active chapter when a permission change makes it unavailable", async () => {
    mocks.rbacState.permissions = [RBAC_PERMISSIONS.LOGS_VIEW];
    useOnboardingStore.setState({
      activeChapterId: "monitoring",
      activeStepIndex: 0,
      isHubOpen: false,
    });

    const { rerender } = render(
      <MemoryRouter initialEntries={["/monitoring/logs"]}>
        <OnboardingProvider />
      </MemoryRouter>,
    );

    expect(useOnboardingStore.getState().activeChapterId).toBe("monitoring");
    mocks.rbacState.permissions = [];
    rerender(
      <MemoryRouter initialEntries={["/monitoring/logs"]}>
        <OnboardingProvider />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(useOnboardingStore.getState().activeChapterId).toBeNull();
      expect(useOnboardingStore.getState().activeStepIndex).toBe(0);
    });
  });
});
