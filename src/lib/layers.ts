import { createContext, useCallback, useContext, type CSSProperties } from "react";

/**
 * One z-index scale for floating UI (ADR 0025 §6). Radix dialogs, sheets and
 * menus sit at 50; the dock above them; the full-screen review above the dock;
 * Chobi above everything a page opens; the onboarding tour and toasts on top.
 */
export const LAYERS = {
  dialog: 50,
  dock: 70,
  dockFlyout: 80,
  review: 90,
  chobiPanel: 95,
  chobiLauncher: 96,
  /** Menus, popovers and tooltips opened from inside Chobi. */
  chobiPopover: 97,
  onboarding: 1_000_000_000,
} as const;

/** Width of the dock's sidebar rail while it shows (a CSS length on <html>); things parked on the left sit beside it. */
export const DOCK_RAIL_WIDTH_VAR = "--dock-rail-width";

/** `offset` px in from the left edge, past the dock rail when there is one. */
export function leftOfRail(offset: number): string {
  return `calc(var(${DOCK_RAIL_WIDTH_VAR}, 0px) + ${offset}px)`;
}

/** Marks Chobi's root element; everything inside belongs to Chobi. */
export const CHOBI_ROOT_ATTRIBUTE = "data-chobi-root";

export function isInsideChobi(target: EventTarget | null): boolean {
  return typeof Element !== "undefined" && target instanceof Element && target.closest(`[${CHOBI_ROOT_ATTRIBUTE}]`) !== null;
}

/** Escape events a page layer left to Chobi (it marks them handled so it stays open). */
const deferredToChobi = new WeakSet<Event>();

/** Whether a page layer stood aside for this Escape because it was typed in Chobi. */
export function escapeDeferredToChobi(event: Event): boolean {
  return deferredToChobi.has(event);
}

/**
 * The z-index for layers opened from inside a raised surface. React context
 * reaches through portals, so a menu rendered under Chobi's tree lands above
 * Chobi even though it is portaled to <body>.
 */
export const FloatingLayerContext = createContext<number | null>(null);

interface LayerProps<E extends Event> {
  style?: CSSProperties;
  onEscapeKeyDown?: (event: E) => void;
}

/**
 * Props every Radix content wrapper applies: the raised z-index when opened
 * from inside Chobi, and Escape typed in Chobi left to Chobi, so it never
 * closes a dialog or menu the page has open behind it.
 */
export function useLayerProps<E extends Event>({ style, onEscapeKeyDown }: LayerProps<E>): { style: CSSProperties | undefined; onEscapeKeyDown: (event: E) => void } {
  const zIndex = useContext(FloatingLayerContext);
  const handleEscape = useCallback((event: E): void => {
    onEscapeKeyDown?.(event);
    if (typeof document === "undefined" || !isInsideChobi(document.activeElement)) return;
    deferredToChobi.add(event);
    event.preventDefault();
  }, [onEscapeKeyDown]);
  return { style: zIndex === null ? style : { ...style, zIndex }, onEscapeKeyDown: handleEscape };
}

/** The overlay of a dialog opened from inside Chobi sits with its content, above Chobi. */
export function useLayerStyle(style?: CSSProperties): CSSProperties | undefined {
  const zIndex = useContext(FloatingLayerContext);
  return zIndex === null ? style : { ...style, zIndex };
}
