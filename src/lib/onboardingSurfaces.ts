import {
  useCallback,
  useLayoutEffect,
  useRef,
  type Ref,
  type RefCallback,
  type RefObject,
} from "react";

export const ONBOARDING_PREPARE_EVENT = "onboarding:prepare";

const ONBOARDING_SURFACE_SELECTOR = [
  "[data-onboarding-surface]",
  "[data-onboarding-surface-overlay]",
].join(",");
const ONBOARDING_SURFACE_SETTLING_ATTRIBUTE = "data-onboarding-surface-settling";
const DEFAULT_SURFACE_SETTLE_WAIT_MS = 450;

let nextPreparationId = 0;

function taggedSurfaces(): HTMLElement[] {
  if (typeof document === "undefined") return [];
  return Array.from(document.querySelectorAll<HTMLElement>(ONBOARDING_SURFACE_SELECTOR));
}

function surfaceIsVisiblyActive(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  const style = window.getComputedStyle(element);
  if (
    style.display === "none"
    || style.visibility === "hidden"
    || style.visibility === "collapse"
  ) return false;
  if (
    element.getAttribute("data-state") === "open"
    || element.hasAttribute(ONBOARDING_SURFACE_SETTLING_ATTRIBUTE)
  ) return true;
  const opacity = Number.parseFloat(style.opacity);
  return !Number.isFinite(opacity) || opacity > 0.01;
}

function finishSurfaceAnimations(element: HTMLElement): void {
  if (typeof element.getAnimations !== "function") return;
  const animations = element.getAnimations({ subtree: true });
  for (const animation of animations) {
    if (animation.playState === "finished" || animation.playState === "idle") continue;
    try {
      animation.finish();
    } catch {
      animation.cancel();
    }
  }
}

function disableTaggedSurfaceTransitions(): void {
  for (const element of taggedSurfaces()) {
    if (!surfaceIsVisiblyActive(element)) continue;
    finishSurfaceAnimations(element);
    element.setAttribute(ONBOARDING_SURFACE_SETTLING_ATTRIBUTE, "true");
    element.style.setProperty("animation", "none", "important");
    element.style.setProperty("transition", "none", "important");
  }
}

function emitPrepareEvent(preparationId: number): void {
  window.dispatchEvent(new CustomEvent(ONBOARDING_PREPARE_EVENT, {
    detail: preparationId,
  }));
}

function preparationIdFromEvent(event: Event): number | null {
  if (!(event instanceof CustomEvent)) return null;
  return typeof event.detail === "number" ? event.detail : null;
}

export function prepareSurfacesForOnboarding(): void {
  const preparationId = ++nextPreparationId;
  disableTaggedSurfaceTransitions();
  emitPrepareEvent(preparationId);
  queueMicrotask(() => {
    disableTaggedSurfaceTransitions();
    emitPrepareEvent(preparationId);
  });
}

export function hasActiveOnboardingSurfaces(): boolean {
  return taggedSurfaces().some(surfaceIsVisiblyActive);
}

export async function waitForOnboardingSurfacesToSettle(
  maxWaitMs = DEFAULT_SURFACE_SETTLE_WAIT_MS,
): Promise<void> {
  if (!hasActiveOnboardingSurfaces()) return;
  const boundedWaitMs = Number.isFinite(maxWaitMs)
    ? Math.max(0, maxWaitMs)
    : DEFAULT_SURFACE_SETTLE_WAIT_MS;
  if (boundedWaitMs === 0) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    let frameId: number | null = null;
    let framePending = false;
    let observer: MutationObserver | null = null;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
      observer?.disconnect();
      resolve();
    };

    const check = (): void => {
      if (settled) return;
      if (!hasActiveOnboardingSurfaces()) {
        finish();
        return;
      }
      if (framePending) return;
      framePending = true;
      frameId = window.requestAnimationFrame(() => {
        framePending = false;
        frameId = null;
        check();
      });
    };

    const timeoutId = window.setTimeout(finish, boundedWaitMs);
    if (typeof MutationObserver !== "undefined" && document.body) {
      observer = new MutationObserver(check);
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-state", "style", "hidden", "aria-hidden"],
      });
    }
    check();
  });
}

export function useOnboardingSurfaceDismiss(
  closeRef: RefObject<HTMLButtonElement | null>,
  enabled = true,
): void {
  useOnboardingSurfaceDismissAction(() => {
    if (!enabled) return false;
    const closeButton = closeRef.current;
    if (!closeButton) return false;
    closeButton.click();
    return true;
  });
}

export function useOnboardingSurfaceDismissAction(
  dismiss: () => boolean | void,
): void {
  const dismissRef = useRef(dismiss);
  const lastPreparationIdRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    dismissRef.current = dismiss;
  }, [dismiss]);

  useLayoutEffect(() => {
    const handlePrepare = (event: Event): void => {
      const preparationId = preparationIdFromEvent(event);
      if (
        preparationId !== null
        && lastPreparationIdRef.current !== null
        && preparationId <= lastPreparationIdRef.current
      ) return;
      const handled = dismissRef.current();
      if (preparationId !== null && handled !== false) {
        lastPreparationIdRef.current = preparationId;
      }
    };
    window.addEventListener(ONBOARDING_PREPARE_EVENT, handlePrepare);
    return () => window.removeEventListener(ONBOARDING_PREPARE_EVENT, handlePrepare);
  }, []);
}

function useOnboardingSurfaceEscape(
  surfaceRef: RefObject<HTMLElement | null>,
): void {
  useOnboardingSurfaceDismissAction(() => {
    const target = surfaceRef.current;
    if (!target?.isConnected) return false;
    // Radix handles Escape during capture; contain the bubble so the guide does not interpret it as Exit.
    const containEscape = (event: KeyboardEvent): void => event.stopPropagation();
    target.addEventListener("keydown", containEscape, { once: true });
    try {
      target.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }));
    } finally {
      target.removeEventListener("keydown", containEscape);
    }
    return true;
  });
}

export function useOnboardingSurfaceRef<T extends HTMLElement>(
  forwardedRef: Ref<T>,
): RefCallback<T> {
  const surfaceRef = useRef<T>(null);
  useOnboardingSurfaceEscape(surfaceRef);

  return useCallback((element: T | null) => {
    surfaceRef.current = element;

    if (element === null) {
      if (typeof forwardedRef === "function") forwardedRef(null);
      else if (forwardedRef) forwardedRef.current = null;
      return;
    }

    if (typeof forwardedRef === "function") {
      const forwardedCleanup = forwardedRef(element);
      return (): void => {
        surfaceRef.current = null;
        if (typeof forwardedCleanup === "function") forwardedCleanup();
        else forwardedRef(null);
      };
    }

    if (forwardedRef) forwardedRef.current = element;
    return (): void => {
      surfaceRef.current = null;
      if (forwardedRef) forwardedRef.current = null;
    };
  }, [forwardedRef]);
}
