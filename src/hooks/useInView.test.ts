import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useInView } from "./useInView";

type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;

const observers: Array<{ callback: Callback; options: { root: unknown; rootMargin: string }; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = [];

function installObserver(): void {
  vi.stubGlobal("IntersectionObserver", class {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(callback: Callback, options: { root: unknown; rootMargin: string }) {
      observers.push({ callback, options, observe: this.observe, disconnect: this.disconnect });
    }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  observers.length = 0;
});

describe("useInView", () => {
  it("turns true once the element comes near its scroll container, stays true and stops observing", () => {
    installObserver();
    const root = { current: document.createElement("main") };
    const el = document.createElement("div");
    const { result, unmount } = renderHook(() => useInView<HTMLDivElement>({ root, rootMargin: "100px" }));
    expect(result.current[1]).toBe(false);
    act(() => result.current[0](el));
    expect(observers).toHaveLength(1);
    expect(observers[0].options).toEqual({ root: root.current, rootMargin: "100px" });
    expect(observers[0].observe).toHaveBeenCalledWith(el);

    act(() => observers[0].callback([{ isIntersecting: false }]));
    expect(result.current[1]).toBe(false);
    act(() => observers[0].callback([{ isIntersecting: true }]));
    expect(result.current[1]).toBe(true);
    expect(observers[0].disconnect).toHaveBeenCalled();
    expect(observers).toHaveLength(1);
    unmount();
  });

  it("observes an element that mounts after the first render, and uses the viewport without a root", () => {
    installObserver();
    const { result } = renderHook(() => useInView<HTMLDivElement>());
    expect(observers).toHaveLength(0);
    act(() => result.current[0](document.createElement("div")));
    expect(observers).toHaveLength(1);
    expect(observers[0].options.root).toBeNull();
  });

  it("disconnects when the element goes away before it was seen", () => {
    installObserver();
    const { result, unmount } = renderHook(() => useInView<HTMLDivElement>());
    act(() => result.current[0](document.createElement("div")));
    unmount();
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it("counts everything as seen where IntersectionObserver is missing", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    expect(renderHook(() => useInView()).result.current[1]).toBe(true);
  });
});
