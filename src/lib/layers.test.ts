import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHOBI_ROOT_ATTRIBUTE, escapeDeferredToChobi, FloatingLayerContext, isInsideChobi, LAYERS, useLayerProps, useLayerStyle } from "./layers";

function chobiRoot(): { root: HTMLElement; input: HTMLInputElement } {
  const root = document.createElement("div");
  root.setAttribute(CHOBI_ROOT_ATTRIBUTE, "");
  const input = document.createElement("input");
  root.appendChild(input);
  document.body.appendChild(root);
  return { root, input };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("LAYERS", () => {
  it("puts Chobi above dialogs, the dock and the review, below the tour", () => {
    expect(LAYERS.chobiPanel).toBeGreaterThan(LAYERS.review);
    expect(LAYERS.review).toBeGreaterThan(LAYERS.dockFlyout);
    expect(LAYERS.dock).toBeGreaterThan(LAYERS.dialog);
    expect(LAYERS.chobiLauncher).toBeGreaterThan(LAYERS.chobiPanel);
    expect(LAYERS.chobiPopover).toBeGreaterThan(LAYERS.chobiLauncher);
    expect(LAYERS.onboarding).toBeGreaterThan(LAYERS.chobiPopover);
  });
});

describe("isInsideChobi", () => {
  it("knows Chobi's elements", () => {
    const { root, input } = chobiRoot();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    expect(isInsideChobi(root)).toBe(true);
    expect(isInsideChobi(input)).toBe(true);
    expect(isInsideChobi(outside)).toBe(false);
    expect(isInsideChobi(null)).toBe(false);
    expect(isInsideChobi(window)).toBe(false);
  });
});

describe("useLayerProps", () => {
  it("leaves a layer alone outside Chobi", () => {
    const { result } = renderHook(() => useLayerProps({ style: { color: "red" } }));
    expect(result.current.style).toEqual({ color: "red" });
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    result.current.onEscapeKeyDown(event);
    expect(event.defaultPrevented).toBe(false);
    expect(escapeDeferredToChobi(event)).toBe(false);
  });

  it("raises a layer opened from inside Chobi", () => {
    const wrapper = ({ children }: { children: ReactNode }): React.JSX.Element => createElement(FloatingLayerContext.Provider, { value: LAYERS.chobiPopover }, children);
    const { result } = renderHook(() => useLayerProps({ style: { color: "red" } }), { wrapper });
    expect(result.current.style).toEqual({ color: "red", zIndex: LAYERS.chobiPopover });
    const overlay = renderHook(() => useLayerStyle(undefined), { wrapper });
    expect(overlay.result.current).toEqual({ zIndex: LAYERS.chobiPopover });
  });

  it("stands aside for Escape typed in Chobi, and still calls the layer's own handler", () => {
    const { input } = chobiRoot();
    input.focus();
    const own = vi.fn();
    const { result } = renderHook(() => useLayerProps({ onEscapeKeyDown: own }));
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    result.current.onEscapeKeyDown(event);
    expect(own).toHaveBeenCalledWith(event);
    expect(event.defaultPrevented).toBe(true);
    expect(escapeDeferredToChobi(event)).toBe(true);
  });
});
