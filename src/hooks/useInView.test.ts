import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useInView } from "./useInView";

type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;

const observers: Array<{ callback: Callback; options: unknown; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];

function installObserver(): void {
  vi.stubGlobal("IntersectionObserver", class {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(callback: Callback, options: unknown) {
      observers.push({ callback, options, observe: this.observe, disconnect: this.disconnect });
    }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  observers.length = 0;
});

describe("useInView", () => {
  it("turns true once the element comes near the viewport, stays true and stops observing", () => {
    installObserver();
    const ref = { current: document.createElement("div") };
    const { result, unmount } = renderHook(() => useInView(ref, "100px"));
    expect(result.current).toBe(false);
    expect(observers).toHaveLength(1);
    expect(observers[0].options).toEqual({ rootMargin: "100px" });
    expect(observers[0].observe).toHaveBeenCalledWith(ref.current);

    act(() => observers[0].callback([{ isIntersecting: false }]));
    expect(result.current).toBe(false);
    act(() => observers[0].callback([{ isIntersecting: true }]));
    expect(result.current).toBe(true);
    expect(observers[0].disconnect).toHaveBeenCalled();
    expect(observers).toHaveLength(1);
    unmount();
  });

  it("disconnects when the element goes away before it was seen", () => {
    installObserver();
    const ref = { current: document.createElement("div") };
    const { unmount } = renderHook(() => useInView(ref));
    unmount();
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it("counts everything as seen where IntersectionObserver is missing", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const ref = { current: document.createElement("div") };
    expect(renderHook(() => useInView(ref)).result.current).toBe(true);
  });
});
