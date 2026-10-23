import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REVEAL_CLASS, addedPanelsOf, useRevealAddedPanels } from "./revealPanels";

describe("addedPanelsOf", () => {
  it("reads the ids from a navigation state and ignores anything else", () => {
    expect(addedPanelsOf({ highlightPanels: ["a", 1, "b"] })).toEqual(["a", "b"]);
    expect(addedPanelsOf({ highlightPanels: "a" })).toEqual([]);
    expect(addedPanelsOf(null)).toEqual([]);
    expect(addedPanelsOf("x")).toEqual([]);
  });
});

let seenState: unknown = "unset";

function Probe({ panelIds, drawn }: { panelIds: string[] | null; drawn: string[] }): React.ReactElement {
  useRevealAddedPanels(panelIds);
  seenState = useLocation().state;
  return <div>{drawn.map((id) => <div key={id} data-panel-key={id}><section /></div>)}</div>;
}

function mount(panelIds: string[] | null, drawn: string[]): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/dashboards/d1", state: { highlightPanels: ["p2", "gone"] } }]}>
      <Probe panelIds={panelIds} drawn={drawn} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  seenState = "unset";
});

describe("useRevealAddedPanels", () => {
  it("waits for a version of the dashboard that has the added panels, and clears the state so it happens once", () => {
    const view = mount(["p1"], ["p1"]);
    expect(seenState).toBeNull();
    act(() => vi.advanceTimersByTime(3_000));
    // The dashboard still shows the version before the save: nothing yet.
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

    view.rerender(
      <MemoryRouter initialEntries={[{ pathname: "/dashboards/d1", state: { highlightPanels: ["p2", "gone"] } }]}>
        <Probe panelIds={["p1", "p2"]} drawn={["p1", "p2"]} />
      </MemoryRouter>,
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-panel-key="p2"]')?.classList.contains(REVEAL_CLASS)).toBe(true);
    view.rerender(
      <MemoryRouter initialEntries={[{ pathname: "/dashboards/d1", state: { highlightPanels: ["p2", "gone"] } }]}>
        <Probe panelIds={["p1", "p2", "p3"]} drawn={["p1", "p2", "p3"]} />
      </MemoryRouter>,
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("waits for the canvas to draw the panel, then outlines only the added ones", () => {
    const view = mount(["p1", "p2"], []);
    act(() => vi.advanceTimersByTime(100));
    view.rerender(
      <MemoryRouter initialEntries={[{ pathname: "/dashboards/d1", state: { highlightPanels: ["p2", "gone"] } }]}>
        <Probe panelIds={["p1", "p2"]} drawn={["p1", "p2"]} />
      </MemoryRouter>,
    );
    act(() => vi.advanceTimersByTime(100));
    const added = document.querySelector('[data-panel-key="p2"]');
    expect(added?.classList.contains(REVEAL_CLASS)).toBe(true);
    expect(document.querySelector('[data-panel-key="p1"]')?.classList.contains(REVEAL_CLASS)).toBe(false);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2_500));
    expect(added?.classList.contains(REVEAL_CLASS)).toBe(false);
  });
});
