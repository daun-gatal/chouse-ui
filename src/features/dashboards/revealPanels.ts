/**
 * Panels just added by Ask AI: the review navigates to the dashboard with
 * their ids in the navigation state, and the dashboard scrolls the first into
 * view and outlines them for a moment once they are drawn.
 */

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

export const REVEAL_CLASS = "panel-just-added";
const REVEAL_MS = 2_500;
const FIND_EVERY_MS = 100;
const FIND_TRIES = 20;

/** The ids in a navigation state, when it carries any. */
export function addedPanelsOf(state: unknown): string[] {
  if (typeof state !== "object" || state === null || !("highlightPanels" in state)) return [];
  const ids = state.highlightPanels;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/** Bring the panels named in the navigation state into view once `panelIds` has them. */
export function useRevealAddedPanels(panelIds: string[] | null): void {
  const location = useLocation();
  const navigate = useNavigate();
  const [pending, setPending] = useState<string[]>([]);
  const timers = useRef<number[]>([]);

  // Taken once, then cleared, so going back or reloading does not outline them again.
  useEffect(() => {
    const ids = addedPanelsOf(location.state);
    if (ids.length === 0) return;
    setPending(ids);
    navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: null });
  }, [location.state, location.pathname, location.search, location.hash, navigate]);

  useEffect(() => {
    if (pending.length === 0 || panelIds === null) return;
    // The dashboard may still show the version from before the save: wait for one that has them.
    const ids = pending.filter((id) => panelIds.includes(id));
    if (ids.length === 0) return;
    setPending([]);
    let tries = 0;
    const find = (): void => {
      const elements = [...document.querySelectorAll<HTMLElement>("[data-panel-key]")].filter((el) => ids.includes(el.dataset.panelKey ?? ""));
      if (elements.length === 0 && tries < FIND_TRIES) {
        tries += 1;
        timers.current.push(window.setTimeout(find, FIND_EVERY_MS));
        return;
      }
      elements[0]?.scrollIntoView({ block: "center", behavior: "smooth" });
      for (const el of elements) el.classList.add(REVEAL_CLASS);
      timers.current.push(window.setTimeout(() => {
        for (const el of elements) el.classList.remove(REVEAL_CLASS);
      }, REVEAL_MS));
    };
    find();
  }, [pending, panelIds]);

  useEffect(() => () => {
    for (const timer of timers.current) window.clearTimeout(timer);
  }, []);
}
