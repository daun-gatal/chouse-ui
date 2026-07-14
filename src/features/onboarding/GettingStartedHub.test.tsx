import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GettingStartedHub } from "./GettingStartedHub";
import { useOnboardingStore } from "./store";
import type { OnboardingChapter } from "./types";

const mocks = vi.hoisted(() => ({
  changePassword: vi.fn(async () => undefined),
  getOnboarding: vi.fn(),
  logout: vi.fn(async () => undefined),
  updateOnboarding: vi.fn(),
}));

vi.mock("@/api", () => ({
  rbacAuthApi: { changePassword: mocks.changePassword },
  rbacUserPreferencesApi: {
    getOnboarding: mocks.getOnboarding,
    updateOnboarding: mocks.updateOnboarding,
  },
}));

vi.mock("@/stores", () => ({
  useRbacStore: (selector: (state: { logout: () => Promise<void> }) => unknown) =>
    selector({ logout: mocks.logout }),
}));

const chapter: OnboardingChapter = {
  id: "shell",
  title: "Navigate CHouse",
  summary: "Learn the product map.",
  estimatedMinutes: 2,
  steps: [{ id: "shell.navigation", title: "Navigation", body: "Use the dock.", route: "/overview" }],
};

const response = {
  progress: {
    formatRevision: 1 as const,
    welcomeSeen: false,
    completedChapterIds: [],
    dismissedChapterIds: [],
    lastStepIndex: 0,
  },
  bootstrapOnboardingPending: false,
  requiresPasswordChange: false,
};

describe("GettingStartedHub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateOnboarding.mockImplementation(async (patch: Record<string, unknown>) => ({
      ...response,
      progress: {
        ...response.progress,
        lastChapterId: typeof patch.lastChapterId === "string" ? patch.lastChapterId : undefined,
        lastStepId: typeof patch.lastStepId === "string" ? patch.lastStepId : undefined,
        lastStepIndex: typeof patch.lastStepIndex === "number" ? patch.lastStepIndex : 0,
      },
    }));
    useOnboardingStore.getState().reset();
    useOnboardingStore.setState({
      isHubOpen: true,
      bootstrapOnboardingPending: true,
      requiresPasswordChange: true,
    });
  });

  it("shows both fresh-install requirements and blocks completion until the password changes", () => {
    render(
      <MemoryRouter>
        <GettingStartedHub chapters={[chapter]} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("region", { name: "First-install setup" })).toBeTruthy();
    expect(screen.getByText("Secure administrator")).toBeTruthy();
    expect(screen.getByText("Connect ClickHouse")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Complete first-install setup" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps every chapter in a viewport-constrained scroll region", () => {
    const chapters = Array.from({ length: 8 }, (_, index) => ({
      ...chapter,
      id: `chapter-${index}`,
      title: `Chapter ${index + 1}`,
    }));
    render(
      <MemoryRouter>
        <GettingStartedHub chapters={chapters} />
      </MemoryRouter>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.classList.contains("grid-rows-[auto_minmax(0,1fr)]")).toBe(true);
    expect(dialog.classList.contains("h-[calc(100dvh-1rem)]")).toBe(true);
    expect(dialog.classList.contains("overflow-hidden")).toBe(true);
    const chapterList = document.querySelector('[data-onboarding-region="chapter-list"]');
    expect(chapterList).toBeTruthy();
    expect(chapterList?.classList.contains("min-h-0")).toBe(true);
    expect(chapterList?.classList.contains("touch-pan-y")).toBe(true);
    expect(chapterList?.classList.contains("overflow-y-auto")).toBe(true);
    expect(chapterList?.classList.contains("overscroll-contain")).toBe(true);
    expect(screen.getByRole("region", { name: "Onboarding chapters and setup" })).toBe(chapterList);
    expect(screen.getByText("Chapter 8")).toBeTruthy();
  });

  it("stays open across the launcher's two-pass surface preparation", async () => {
    useOnboardingStore.setState({ isHubOpen: false });
    render(
      <MemoryRouter>
        <GettingStartedHub chapters={[chapter]} />
      </MemoryRouter>,
    );

    await act(async () => {
      useOnboardingStore.getState().setHubOpen(true);
      await Promise.resolve();
    });

    expect(useOnboardingStore.getState().isHubOpen).toBe(true);
    const dialog = screen.getByRole("dialog");
    expect(dialog.hasAttribute("data-onboarding-hub")).toBe(true);
    expect(dialog.classList.contains("z-[1000000000]")).toBe(true);
    expect(document.querySelector('[data-onboarding-surface-overlay="dialog"]')?.classList.contains("z-[1000000000]")).toBe(true);
  });

  it("resumes by stable step identity when the eligible step order changes", async () => {
    const changedChapter: OnboardingChapter = {
      ...chapter,
      steps: [
        { id: "shell.navigation", title: "Navigation", body: "Use the dock.", route: "/overview" },
        { id: "shell.preferences", title: "Preferences", body: "Tune the workspace.", route: "/preferences" },
      ],
    };
    useOnboardingStore.setState({
      progress: {
        ...response.progress,
        lastChapterId: chapter.id,
        lastStepId: "shell.preferences",
        lastStepIndex: 99,
      },
    });
    render(
      <MemoryRouter>
        <GettingStartedHub chapters={[changedChapter]} />
      </MemoryRouter>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resume" }));
      await Promise.resolve();
    });

    expect(useOnboardingStore.getState().activeStepIndex).toBe(1);
    expect(useOnboardingStore.getState().progress.lastStepId).toBe("shell.preferences");
  });

  it("exposes accessible password fields", () => {
    render(
      <MemoryRouter>
        <GettingStartedHub chapters={[chapter]} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByLabelText("Current password")).toBeTruthy();
    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByLabelText("Confirm new password")).toBeTruthy();
  });

  it("completes the bootstrap marker through the bounded onboarding API", async () => {
    useOnboardingStore.setState({ requiresPasswordChange: false });
    render(
      <MemoryRouter>
        <GettingStartedHub chapters={[chapter]} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Complete first-install setup" }));
    await waitFor(() => expect(mocks.updateOnboarding).toHaveBeenCalledWith(
      { bootstrapComplete: true },
      expect.any(AbortSignal),
    ));
  });

  it("surfaces bootstrap completion failures inside the Hub", async () => {
    mocks.updateOnboarding.mockRejectedValueOnce(new Error("Deployment is not ready"));
    useOnboardingStore.setState({ requiresPasswordChange: false });
    render(
      <MemoryRouter>
        <GettingStartedHub chapters={[chapter]} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Complete first-install setup" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Deployment is not ready");
    expect(screen.getByRole("dialog").contains(alert)).toBe(true);
  });

  it("surfaces password-change failures inside the Hub", async () => {
    mocks.changePassword.mockRejectedValueOnce(new Error("Current password is incorrect"));
    render(
      <MemoryRouter>
        <GettingStartedHub chapters={[chapter]} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "wrong-password" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "SecurePassword1!" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "SecurePassword1!" } });
    const submitButtons = screen.getAllByRole("button", { name: "Change password" });
    fireEvent.click(submitButtons[submitButtons.length - 1]);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Current password is incorrect");
    expect(screen.getByRole("dialog").contains(alert)).toBe(true);
  });
});
