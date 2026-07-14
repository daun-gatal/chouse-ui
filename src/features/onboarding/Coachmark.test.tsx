import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calculateCoachmarkPosition, Coachmark, isOnboardingRouteActive } from "./Coachmark";
import { useOnboardingStore } from "./store";
import type { OnboardingChapter } from "./types";

const surfaceMocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  waitForSettle: vi.fn<() => Promise<void>>(),
}));

const navigationMocks = vi.hoisted(() => ({
  enabled: false,
  navigate: vi.fn(),
}));

vi.mock("@/lib/onboardingSurfaces", () => ({
  prepareSurfacesForOnboarding: surfaceMocks.prepare,
  waitForOnboardingSurfacesToSettle: surfaceMocks.waitForSettle,
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => {
      const actualNavigate = actual.useNavigate();
      return navigationMocks.enabled ? navigationMocks.navigate : actualNavigate;
    },
  };
});

const completeChapter = vi.fn(async () => undefined);
const dismissChapter = vi.fn(async () => undefined);
const setActiveStep = vi.fn(async () => undefined);
const exitChapter = vi.fn();

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const chapter: OnboardingChapter = {
  id: "test",
  title: "Test guide",
  summary: "Test",
  estimatedMinutes: 1,
  steps: [
    { id: "step-one", title: "First control", body: "Learn the first control.", route: "/overview", target: "visible-target" },
    { id: "step-two", title: "Second control", body: "Learn the second control.", route: "/overview" },
  ],
};

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}{location.search}</output>;
}

describe("Coachmark", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.clearAllMocks();
    navigationMocks.enabled = false;
    surfaceMocks.waitForSettle.mockResolvedValue();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 10, 100, 40));
    useOnboardingStore.setState({
      activeChapterId: "test",
      activeStepIndex: 0,
      completeChapter,
      dismissChapter,
      setActiveStep,
      exitChapter,
      isTerminalActionPending: false,
    });
  });

  it("highlights a stable target and exposes chapter progress", async () => {
    const scrollIntoView = vi.fn();
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <div
          ref={(element) => {
            if (element) element.scrollIntoView = scrollIntoView;
          }}
          data-onboarding-id="visible-target"
          style={{ width: 100, height: 40 }}
        >
          Target
        </div>
        <Coachmark chapter={chapter} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("dialog")).toBeTruthy();
    await waitFor(() => {
      expect(document.querySelector("[data-onboarding-spotlight]")).toBeTruthy();
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(screen.getByText("Test guide · 1/2")).toBeTruthy();
    expect(screen.getByText("First control")).toBeTruthy();
  });

  it("waits for surface teardown before measuring, revealing, or focusing the step", async () => {
    const settle = deferred<void>();
    surfaceMocks.waitForSettle.mockReturnValue(settle.promise);
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <button type="button">Background action</button>
        <Coachmark chapter={{ ...chapter, steps: [chapter.steps[1]] }} />
      </MemoryRouter>,
    );

    const background = screen.getByRole("button", { name: "Background action" });
    background.focus();
    const hiddenCard = screen.getByRole("dialog", { hidden: true });
    expect(hiddenCard.hasAttribute("inert")).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(background);
    expect(surfaceMocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      surfaceMocks.waitForSettle.mock.invocationCallOrder[0],
    );

    await act(async () => settle.resolve(undefined));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    expect(dialog.hasAttribute("inert")).toBe(false);
  });

  it("shares one timeout budget between surface teardown and target acquisition", async () => {
    const settle = deferred<void>();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    surfaceMocks.waitForSettle.mockReturnValue(settle.promise);
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <Coachmark chapter={{
          ...chapter,
          steps: [{ ...chapter.steps[0], target: "target-that-never-mounts" }],
        }} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    now = 650;
    await act(async () => settle.resolve(undefined));

    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("keeps a visible target when the first measurement arrives at the deadline", async () => {
    const settle = deferred<void>();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    surfaceMocks.waitForSettle.mockReturnValue(settle.promise);
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <div data-onboarding-id="visible-target">Target</div>
        <Coachmark chapter={chapter} />
      </MemoryRouter>,
    );

    now = 650;
    await act(async () => settle.resolve(undefined));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(document.querySelector("[data-onboarding-spotlight]")).toBeTruthy();
    expect(
      document.querySelector("[data-onboarding-coachmark]")?.getAttribute("data-onboarding-target-found"),
    ).toBe("true");
  });

  it("keeps the bounded centered fallback stable when a target mounts too late", async () => {
    const settle = deferred<void>();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    surfaceMocks.waitForSettle.mockReturnValue(settle.promise);
    const renderJourney = (showTarget: boolean): React.JSX.Element => (
      <MemoryRouter initialEntries={["/overview"]}>
        {showTarget && <div data-onboarding-id="visible-target">Late target</div>}
        <Coachmark chapter={chapter} />
      </MemoryRouter>
    );
    const view = render(renderJourney(false));

    now = 650;
    await act(async () => settle.resolve(undefined));
    const dialog = await screen.findByRole("dialog");
    const initialPosition = { left: dialog.style.left, top: dialog.style.top };

    view.rerender(renderJourney(true));
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 30)));

    expect(document.querySelector("[data-onboarding-spotlight]")).toBeNull();
    expect(dialog.getAttribute("data-onboarding-target-found")).toBe("false");
    expect({ left: dialog.style.left, top: dialog.style.top }).toEqual(initialPosition);
  });

  it("scrolls only when the target is outside the viewport", async () => {
    const scrollIntoView = vi.fn();
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <div
          ref={(element) => {
            if (!element) return;
            element.scrollIntoView = scrollIntoView;
            element.getBoundingClientRect = () => new DOMRect(10, 900, 100, 40);
          }}
          data-onboarding-id="visible-target"
        >
          Target
        </div>
        <Coachmark chapter={chapter} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "nearest", behavior: "auto" });
    });
  });

  it("reveals a clipped target inside its own horizontal tab strip", async () => {
    const scrollIntoView = vi.fn();
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <div
          data-testid="vertical-scroller"
          ref={(scroller) => {
            if (!scroller) return;
            scroller.style.overflowY = "auto";
            scroller.scrollTop = 37;
            scroller.getBoundingClientRect = () => new DOMRect(50, 50, 400, 400);
            Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 });
            Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1_000 });
          }}
        >
          <div
            ref={(strip) => {
              if (!strip) return;
              strip.style.overflowX = "auto";
              strip.getBoundingClientRect = () => new DOMRect(100, 100, 200, 80);
              Object.defineProperty(strip, "clientWidth", { configurable: true, value: 200 });
              Object.defineProperty(strip, "scrollWidth", { configurable: true, value: 800 });
            }}
          >
            <div
              ref={(element) => {
                if (!element) return;
                element.scrollIntoView = scrollIntoView;
                element.getBoundingClientRect = () => {
                  const strip = element.parentElement;
                  return new DOMRect(500 - (strip?.scrollLeft ?? 0), 120, 80, 30);
                };
              }}
              data-onboarding-id="visible-target"
            >
              Target
            </div>
          </div>
        </div>
        <Coachmark chapter={chapter} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const strip = screen.getByText("Target").parentElement;
      expect(strip?.scrollLeft).toBeGreaterThan(0);
      expect(document.querySelector("[data-onboarding-spotlight]")).toBeTruthy();
    });
    expect(screen.getByTestId("vertical-scroller").scrollTop).toBe(37);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("stops reveal retries when clipping cannot be improved", async () => {
    const requestFrame = vi.spyOn(window, "requestAnimationFrame");
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <div
          ref={(container) => {
            if (!container) return;
            container.style.overflow = "hidden";
            container.getBoundingClientRect = () => new DOMRect(100, 100, 50, 50);
          }}
        >
          <div
            ref={(element) => {
              if (element) element.getBoundingClientRect = () => new DOMRect(200, 110, 100, 30);
            }}
            data-onboarding-id="visible-target"
          >
            Clipped target
          </div>
        </div>
        <Coachmark chapter={chapter} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(document.querySelector("[data-onboarding-spotlight]")).toBeNull();
    const settledFrameCount = requestFrame.mock.calls.length;
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 60)));
    expect(requestFrame.mock.calls.length - settledFrameCount).toBeLessThanOrEqual(2);
  });

  it("keeps the explanation and spotlight synchronized after the target moves", async () => {
    let targetTop = 40;
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <div
          ref={(element) => {
            if (element) element.getBoundingClientRect = () => new DOMRect(400, targetTop, 100, 40);
          }}
          data-onboarding-id="visible-target"
        >
          Target
        </div>
        <Coachmark chapter={chapter} />
      </MemoryRouter>,
    );

    const dialog = await screen.findByRole("dialog");
    const initialCardTop = dialog.style.top;
    targetTop = 250;
    fireEvent.scroll(window);

    await waitFor(() => {
      expect(dialog.style.top).not.toBe(initialCardTop);
      expect(document.querySelector<HTMLElement>("[data-onboarding-spotlight]")?.style.top).toBe("242px");
    });
  });

  it("keeps the last stable layout through transient target loss before accepting its replacement", async () => {
    let targetVisible = true;
    let targetTop = 40;
    const renderJourney = (): React.JSX.Element => (
      <MemoryRouter initialEntries={["/overview"]}>
        {targetVisible && (
          <div
            ref={(element) => {
              if (element) element.getBoundingClientRect = () => new DOMRect(400, targetTop, 100, 40);
            }}
            data-onboarding-id="visible-target"
          >
            Target
          </div>
        )}
        <Coachmark chapter={chapter} />
      </MemoryRouter>
    );
    const view = render(renderJourney());

    const dialog = await screen.findByRole("dialog");
    const initialCardTop = dialog.style.top;
    const initialSpotlightTop = document.querySelector<HTMLElement>("[data-onboarding-spotlight]")?.style.top;
    targetVisible = false;
    view.rerender(renderJourney());

    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 80)));
    expect(dialog.style.top).toBe(initialCardTop);
    expect(document.querySelector<HTMLElement>("[data-onboarding-spotlight]")?.style.top).toBe(initialSpotlightTop);

    targetTop = 250;
    targetVisible = true;
    view.rerender(renderJourney());
    await waitFor(() => {
      expect(document.querySelector<HTMLElement>("[data-onboarding-spotlight]")?.style.top).toBe("242px");
      expect(dialog.style.top).not.toBe(initialCardTop);
    });
  });

  it("retains the chosen card side while that side still fits", async () => {
    let targetLeft = 480;
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <div
          ref={(element) => {
            if (element) element.getBoundingClientRect = () => new DOMRect(targetLeft, 30, 20, 700);
          }}
          data-onboarding-id="visible-target"
        >
          Target
        </div>
        <Coachmark chapter={chapter} />
      </MemoryRouter>,
    );

    const dialog = await screen.findByRole("dialog");
    expect(Number.parseFloat(dialog.style.left)).toBeGreaterThan(500);
    targetLeft = 520;
    fireEvent.scroll(window);

    await waitFor(() => {
      expect(Number.parseFloat(dialog.style.left)).toBeGreaterThan(540);
    });
  });

  it("waits for moving target geometry to settle before revealing the step", async () => {
    let reads = 0;
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <div
          ref={(element) => {
            if (!element) return;
            element.getBoundingClientRect = () => {
              reads += 1;
              const top = reads < 5 ? 10 + reads * 4 : 30;
              return new DOMRect(400, top, 100, 40);
            };
          }}
          data-onboarding-id="visible-target"
        >
          Target
        </div>
        <Coachmark chapter={chapter} />
      </MemoryRouter>,
    );

    await screen.findByRole("dialog");
    expect(document.querySelector<HTMLElement>("[data-onboarding-spotlight]")?.style.top).toBe("22px");
  });

  it("ignores unrelated style churn after target observation starts", async () => {
    let targetReads = 0;
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <div data-testid="unrelated-animation" />
        <div
          ref={(element) => {
            if (!element) return;
            element.getBoundingClientRect = () => {
              targetReads += 1;
              return new DOMRect(400, 40, 100, 40);
            };
          }}
          data-onboarding-id="visible-target"
        >
          Target
        </div>
        <Coachmark chapter={chapter} />
      </MemoryRouter>,
    );

    await screen.findByRole("dialog");
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 30)));
    const settledReads = targetReads;
    screen.getByTestId("unrelated-animation").style.transform = "translateX(10px)";
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 30)));
    expect(targetReads).toBe(settledReads);
  });

  it("avoids a clipped spotlight for targets that fill most of the viewport", async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(new DOMRect(0, 0, 1_000, 700));
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <div data-onboarding-id="visible-target">Target</div>
        <Coachmark chapter={chapter} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(document.querySelector("[data-onboarding-spotlight]")).toBeNull();
  });

  it("keeps the spotlight for a wide but shallow section", async () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(new DOMRect(10, 300, 1_000, 80));
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <div data-onboarding-id="visible-target">Target</div>
        <Coachmark chapter={chapter} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("dialog")).toBeTruthy();
    await waitFor(() => expect(document.querySelector("[data-onboarding-spotlight]")).toBeTruthy());
  });

  it("contains background scrolling while preserving scrolling inside the guide", async () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <Coachmark chapter={{ ...chapter, steps: [chapter.steps[1]] }} />
      </MemoryRouter>,
    );

    const dialog = await screen.findByRole("dialog");
    const backgroundWheel = new WheelEvent("wheel", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(backgroundWheel);
    expect(backgroundWheel.defaultPrevented).toBe(true);

    const dialogWheel = new WheelEvent("wheel", { bubbles: true, cancelable: true });
    dialog.dispatchEvent(dialogWheel);
    expect(dialogWheel.defaultPrevented).toBe(false);
  });

  it("contains focus and both Tab directions when focus starts outside the guide", async () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <button type="button">Background action</button>
        <Coachmark chapter={{ ...chapter, steps: [chapter.steps[1]] }} />
      </MemoryRouter>,
    );

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    const background = screen.getByRole("button", { name: "Background action" });
    background.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);

    dialog.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Complete" }));
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Exit guide" }));
  });

  it("does not mount a blocking overlay while its route is inactive", async () => {
    navigationMocks.enabled = true;
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <button type="button">Background action</button>
        <Coachmark chapter={{
          ...chapter,
          steps: [{ ...chapter.steps[1], route: "/blocked" }],
        }} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(navigationMocks.navigate).toHaveBeenCalledWith("/blocked", { replace: true }));
    expect(document.querySelector("[data-onboarding-overlay]")).toBeNull();
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true });
    document.body.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
  });

  it("sizes and positions the card inside the visual viewport", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, "visualViewport");
    const viewport = {
      width: 320,
      height: 240,
      offsetLeft: 10,
      offsetTop: 20,
      pageLeft: 0,
      pageTop: 0,
      scale: 1,
      onresize: null,
      onscroll: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function () {
      if (this.hasAttribute("data-onboarding-coachmark")) return new DOMRect(0, 0, 288, 180);
      return new DOMRect(10, 10, 100, 40);
    });
    const view = render(
      <MemoryRouter initialEntries={["/overview"]}>
        <Coachmark chapter={{ ...chapter, steps: [chapter.steps[1]] }} />
      </MemoryRouter>,
    );

    try {
      const dialog = await screen.findByRole("dialog");
      expect(dialog.style.width).toBe("288px");
      expect(dialog.style.maxWidth).toBe("288px");
      expect(dialog.style.maxHeight).toBe("208px");
      const left = Number.parseFloat(dialog.style.left);
      const top = Number.parseFloat(dialog.style.top);
      expect(left).toBeGreaterThanOrEqual(viewport.offsetLeft + 16);
      expect(left + 288).toBeLessThanOrEqual(viewport.offsetLeft + viewport.width - 16);
      expect(top).toBeGreaterThanOrEqual(viewport.offsetTop + 16);
      expect(top + 180).toBeLessThanOrEqual(viewport.offsetTop + viewport.height - 16);
    } finally {
      view.unmount();
      if (originalDescriptor) Object.defineProperty(window, "visualViewport", originalDescriptor);
      else Reflect.deleteProperty(window, "visualViewport");
    }
  });

  it("reveals the settled explanation without showing an intermediate opening card", async () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <Coachmark chapter={{
          ...chapter,
          steps: [{ ...chapter.steps[0], target: "target-that-is-still-loading" }],
        }} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("dialog", { hidden: true }).getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Preparing First control");
    expect(screen.queryByText("Opening First control…")).toBeNull();
    expect(document.querySelector("[data-onboarding-overlay] > div")?.className).toContain("opacity-0");

    const dialog = await screen.findByRole("dialog");
    expect(dialog.className).not.toContain("transition-opacity");
    expect(screen.getByText("Learn the first control.")).toBeTruthy();
  });

  it("places the explanation next to the settled highlight", () => {
    const above = calculateCoachmarkPosition(
      { top: 600, left: 500, width: 100, height: 40 },
      { width: 380, height: 220 },
      { width: 1_280, height: 720 },
    );
    const below = calculateCoachmarkPosition(
      { top: 40, left: 500, width: 100, height: 40 },
      { width: 380, height: 220 },
      { width: 1_280, height: 720 },
    );

    expect(above.top + 220).toBe(588);
    expect(below.top).toBe(92);
  });

  it("navigates between guide states on the same route", async () => {
    render(
      <MemoryRouter initialEntries={["/monitoring/logs?range=6h&guide=queries"]}>
        <LocationProbe />
        <Coachmark chapter={{
          ...chapter,
          steps: [{
            ...chapter.steps[0],
            route: "/monitoring/logs?guide=patterns",
            target: undefined,
          }],
        }} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Current route").textContent).toBe("/monitoring/logs?range=6h&guide=patterns");
    });
  });

  it("matches guide query parameters regardless of order and preserves unrelated parameters", () => {
    expect(isOnboardingRouteActive(
      "/monitoring/logs",
      "?range=1h&guide=patterns",
      "/monitoring/logs?guide=patterns",
    )).toBe(true);
    expect(isOnboardingRouteActive(
      "/monitoring/logs",
      "?range=1h&guide=queries",
      "/monitoring/logs?guide=patterns",
    )).toBe(false);
  });

  it("keeps Doctor report descendants inside the Doctor route family", async () => {
    expect(isOnboardingRouteActive("/doctor/report-1", "", "/doctor", "descendants")).toBe(true);
    expect(isOnboardingRouteActive("/doctor/report-1", "", "/doctor", "exact")).toBe(false);

    render(
      <MemoryRouter initialEntries={["/doctor/report-1"]}>
        <LocationProbe />
        <div data-onboarding-id="visible-target">Target</div>
        <Coachmark chapter={{
          ...chapter,
          steps: [{
            ...chapter.steps[0],
            route: "/doctor",
            routeMatch: "descendants",
          }],
        }} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText("Current route").textContent).toBe("/doctor/report-1");
  });

  it("supports keyboard progression and exit", async () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <Coachmark chapter={{ ...chapter, steps: [chapter.steps[1]] }} />
      </MemoryRouter>,
    );

    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(completeChapter).toHaveBeenCalledWith("test"));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(exitChapter).toHaveBeenCalled();
  });

  it("locks exit controls while terminal persistence is pending", async () => {
    useOnboardingStore.setState({ isTerminalActionPending: true });
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <Coachmark chapter={{ ...chapter, steps: [chapter.steps[1]] }} />
      </MemoryRouter>,
    );

    const exitButton = await screen.findByRole("button", { name: "Exit guide" });
    if (!(exitButton instanceof HTMLButtonElement)) throw new Error("Exit control is not a button");
    expect(exitButton.disabled).toBe(true);

    fireEvent.click(exitButton);
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    window.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBe(true);
    expect(exitChapter).not.toHaveBeenCalled();
  });

  it("allows the user to skip without invoking a product action", async () => {
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <Coachmark chapter={{ ...chapter, steps: [chapter.steps[1]] }} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Skip chapter" }));
    expect(dismissChapter).toHaveBeenCalledWith("test");
  });
});
