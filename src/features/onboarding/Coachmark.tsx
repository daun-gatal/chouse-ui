import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  prepareSurfacesForOnboarding,
  waitForOnboardingSurfacesToSettle,
} from "@/lib/onboardingSurfaces";
import { cn } from "@/lib/utils";

import { useOnboardingStore } from "./store";
import type { OnboardingChapter } from "./types";

interface CoachmarkProps {
  chapter: OnboardingChapter;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface ElementSize {
  width: number;
  height: number;
}

interface CardPosition {
  top: number;
  left: number;
}

interface ViewportRect extends ElementSize {
  top: number;
  left: number;
}

interface TargetMatch {
  element: HTMLElement;
  rawRect: TargetRect;
  visibleRect: TargetRect | null;
}

interface CoachmarkLayout {
  stepId: string;
  ready: boolean;
  targetFound: boolean;
  targetRect: TargetRect | null;
  cardPosition: CardPosition | null;
  cardSide: CardSide | null;
  viewport: ViewportRect | null;
}

const TARGET_TIMEOUT_MS = 650;
const STABLE_FRAME_COUNT = 2;
const TARGET_LOSS_GRACE_MS = 240;
const GEOMETRY_SETTLE_MAX_MS = 300;
const MAX_REVEAL_ATTEMPTS = 2;
const CARD_GAP = 12;
const VIEWPORT_MARGIN = 16;
const SPOTLIGHT_PADDING = 8;
const GEOMETRY_EPSILON = 1;

type CardSide = "above" | "below" | "left" | "right";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function rectRight(rect: TargetRect): number {
  return rect.left + rect.width;
}

function rectBottom(rect: TargetRect): number {
  return rect.top + rect.height;
}

function intersectRects(first: TargetRect, second: TargetRect): TargetRect | null {
  const top = Math.max(first.top, second.top);
  const left = Math.max(first.left, second.left);
  const right = Math.min(rectRight(first), rectRight(second));
  const bottom = Math.min(rectBottom(first), rectBottom(second));
  if (right <= left || bottom <= top) return null;
  return { top, left, width: right - left, height: bottom - top };
}

function rectsAreClose(first: TargetRect | null, second: TargetRect | null): boolean {
  if (first === null || second === null) return first === second;
  return Math.abs(first.top - second.top) <= GEOMETRY_EPSILON
    && Math.abs(first.left - second.left) <= GEOMETRY_EPSILON
    && Math.abs(first.width - second.width) <= GEOMETRY_EPSILON
    && Math.abs(first.height - second.height) <= GEOMETRY_EPSILON;
}

function positionsAreClose(first: CardPosition | null, second: CardPosition | null): boolean {
  if (first === null || second === null) return first === second;
  return Math.abs(first.top - second.top) <= GEOMETRY_EPSILON
    && Math.abs(first.left - second.left) <= GEOMETRY_EPSILON;
}

function layoutsAreEqual(first: CoachmarkLayout, second: CoachmarkLayout): boolean {
  return first.stepId === second.stepId
    && first.ready === second.ready
    && first.targetFound === second.targetFound
    && rectsAreClose(first.targetRect, second.targetRect)
    && positionsAreClose(first.cardPosition, second.cardPosition)
    && first.cardSide === second.cardSide
    && rectsAreClose(first.viewport, second.viewport);
}

function readViewport(): ViewportRect {
  const viewport = window.visualViewport;
  if (!viewport) {
    return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
  }
  return {
    top: viewport.offsetTop,
    left: viewport.offsetLeft,
    width: viewport.width,
    height: viewport.height,
  };
}

function viewportAsTargetRect(viewport: ViewportRect): TargetRect {
  return {
    top: viewport.top,
    left: viewport.left,
    width: viewport.width,
    height: viewport.height,
  };
}

function domRectToTargetRect(rect: DOMRect): TargetRect {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function opacityIsHidden(value: string): boolean {
  if (value === "") return false;
  const opacity = Number.parseFloat(value);
  return Number.isFinite(opacity) && opacity <= 0.01;
}

function elementIsRendered(element: HTMLElement): boolean {
  let candidate: HTMLElement | null = element;
  while (candidate) {
    const style = window.getComputedStyle(candidate);
    if (
      style.display === "none"
      || style.visibility === "hidden"
      || style.visibility === "collapse"
      || opacityIsHidden(style.opacity)
      || candidate.hasAttribute("inert")
      || candidate.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }
    candidate = candidate.parentElement;
  }
  return true;
}

function clipsAxis(value: string): boolean {
  return value === "auto" || value === "scroll" || value === "hidden" || value === "clip";
}

function visibleTargetRect(element: HTMLElement, viewport: ViewportRect): TargetRect | null {
  if (!elementIsRendered(element)) return null;
  let visible = intersectRects(
    domRectToTargetRect(element.getBoundingClientRect()),
    viewportAsTargetRect(viewport),
  );
  if (!visible) return null;

  let ancestor = element.parentElement;
  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    const style = window.getComputedStyle(ancestor);
    const clipsX = clipsAxis(style.overflowX) || clipsAxis(style.overflow);
    const clipsY = clipsAxis(style.overflowY) || clipsAxis(style.overflow);
    if (clipsX || clipsY) {
      const ancestorRect = domRectToTargetRect(ancestor.getBoundingClientRect());
      const clipRect: TargetRect = {
        top: clipsY ? ancestorRect.top : visible.top,
        left: clipsX ? ancestorRect.left : visible.left,
        width: clipsX ? ancestorRect.width : visible.width,
        height: clipsY ? ancestorRect.height : visible.height,
      };
      visible = intersectRects(visible, clipRect);
      if (!visible) return null;
    }
    ancestor = ancestor.parentElement;
  }
  return visible;
}

function distanceFromViewport(rect: TargetRect, viewport: ViewportRect): number {
  const vertical = rectBottom(rect) < viewport.top
    ? viewport.top - rectBottom(rect)
    : rect.top > viewport.top + viewport.height
      ? rect.top - viewport.top - viewport.height
      : 0;
  const horizontal = rectRight(rect) < viewport.left
    ? viewport.left - rectRight(rect)
    : rect.left > viewport.left + viewport.width
      ? rect.left - viewport.left - viewport.width
      : 0;
  return vertical + horizontal;
}

function findTarget(targetId: string | undefined, viewport: ViewportRect): TargetMatch | null {
  if (!targetId) return null;
  const elements = document.querySelectorAll<HTMLElement>(`[data-onboarding-id="${targetId}"]`);
  let bestMatch: TargetMatch | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const element of elements) {
    if (!elementIsRendered(element)) continue;
    const rawRect = domRectToTargetRect(element.getBoundingClientRect());
    if (rawRect.width <= 0 || rawRect.height <= 0) continue;
    const visibleRect = visibleTargetRect(element, viewport);
    const visibleArea = visibleRect ? visibleRect.width * visibleRect.height : 0;
    const score = visibleArea > 0
      ? visibleArea
      : -distanceFromViewport(rawRect, viewport);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = { element, rawRect, visibleRect };
    }
  }
  return bestMatch;
}

interface RevealAxes {
  x: boolean;
  y: boolean;
}

interface RevealSnapshot {
  element: HTMLElement;
  rawRect: TargetRect;
  visibleRect: TargetRect | null;
  axes: RevealAxes;
}

function visibleAxisLength(
  element: HTMLElement,
  viewport: ViewportRect,
  axis: "x" | "y",
): number {
  if (!elementIsRendered(element)) return 0;
  const rawRect = element.getBoundingClientRect();
  const viewportStart = axis === "x" ? viewport.left : viewport.top;
  const viewportSize = axis === "x" ? viewport.width : viewport.height;
  let start = Math.max(axis === "x" ? rawRect.left : rawRect.top, viewportStart);
  let end = Math.min(axis === "x" ? rawRect.right : rawRect.bottom, viewportStart + viewportSize);

  let ancestor = element.parentElement;
  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    const style = window.getComputedStyle(ancestor);
    const clips = axis === "x"
      ? clipsAxis(style.overflowX) || clipsAxis(style.overflow)
      : clipsAxis(style.overflowY) || clipsAxis(style.overflow);
    if (clips) {
      const ancestorRect = ancestor.getBoundingClientRect();
      start = Math.max(start, axis === "x" ? ancestorRect.left : ancestorRect.top);
      end = Math.min(end, axis === "x" ? ancestorRect.right : ancestorRect.bottom);
    }
    ancestor = ancestor.parentElement;
  }
  return Math.max(0, end - start);
}

function targetRevealAxes(match: TargetMatch, viewport: ViewportRect): RevealAxes {
  const visibleWidthRatio = visibleAxisLength(match.element, viewport, "x") / match.rawRect.width;
  const visibleHeightRatio = visibleAxisLength(match.element, viewport, "y") / match.rawRect.height;
  return {
    x: match.rawRect.width <= viewport.width && visibleWidthRatio < 0.8,
    y: match.rawRect.height <= viewport.height && visibleHeightRatio < 0.8,
  };
}

function revealSnapshotsAreEqual(
  snapshot: RevealSnapshot | null,
  match: TargetMatch,
  axes: RevealAxes,
): boolean {
  return snapshot?.element === match.element
    && snapshot.axes.x === axes.x
    && snapshot.axes.y === axes.y
    && rectsAreClose(snapshot.rawRect, match.rawRect)
    && rectsAreClose(snapshot.visibleRect, match.visibleRect);
}

function isScrollableAxis(element: HTMLElement, axis: "x" | "y"): boolean {
  const style = window.getComputedStyle(element);
  const overflow = axis === "x" ? style.overflowX : style.overflowY;
  const allowsScroll = overflow === "auto" || overflow === "scroll";
  return allowsScroll && (axis === "x"
    ? element.scrollWidth > element.clientWidth
    : element.scrollHeight > element.clientHeight);
}

function centeredScrollDelta(
  targetStart: number,
  targetSize: number,
  containerStart: number,
  containerSize: number,
): number {
  if (targetSize >= containerSize) return targetStart - containerStart;
  return targetStart + targetSize / 2 - containerStart - containerSize / 2;
}

function axisNeedsRevealWithin(
  targetStart: number,
  targetSize: number,
  containerStart: number,
  containerSize: number,
): boolean {
  if (targetSize > containerSize) return false;
  const visible = Math.max(
    0,
    Math.min(targetStart + targetSize, containerStart + containerSize)
      - Math.max(targetStart, containerStart),
  );
  return visible / targetSize < 0.8;
}

function revealScore(element: HTMLElement, viewport: ViewportRect, axes: RevealAxes): number {
  const rect = element.getBoundingClientRect();
  let score = 0;
  if (axes.x && rect.width > 0) score += visibleAxisLength(element, viewport, "x") / rect.width;
  if (axes.y && rect.height > 0) score += visibleAxisLength(element, viewport, "y") / rect.height;
  return score;
}

function revealTarget(element: HTMLElement, viewport: ViewportRect, axes: RevealAxes): boolean {
  const beforeScore = revealScore(element, viewport, axes);
  let ancestor = element.parentElement;
  let movedX = false;
  let movedY = false;

  while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
    const targetRect = element.getBoundingClientRect();
    const ancestorRect = ancestor.getBoundingClientRect();
    if (
      axes.x
      && isScrollableAxis(ancestor, "x")
      && axisNeedsRevealWithin(targetRect.left, targetRect.width, ancestorRect.left, ancestorRect.width)
    ) {
      const delta = centeredScrollDelta(
        targetRect.left,
        targetRect.width,
        ancestorRect.left,
        ancestorRect.width,
      );
      if (Math.abs(delta) > GEOMETRY_EPSILON) {
        const before = ancestor.scrollLeft;
        ancestor.scrollLeft += delta;
        movedX = movedX || Math.abs(ancestor.scrollLeft - before) > GEOMETRY_EPSILON;
      }
    }
    if (
      axes.y
      && isScrollableAxis(ancestor, "y")
      && axisNeedsRevealWithin(targetRect.top, targetRect.height, ancestorRect.top, ancestorRect.height)
    ) {
      const delta = centeredScrollDelta(
        targetRect.top,
        targetRect.height,
        ancestorRect.top,
        ancestorRect.height,
      );
      if (Math.abs(delta) > GEOMETRY_EPSILON) {
        const before = ancestor.scrollTop;
        ancestor.scrollTop += delta;
        movedY = movedY || Math.abs(ancestor.scrollTop - before) > GEOMETRY_EPSILON;
      }
    }
    ancestor = ancestor.parentElement;
  }

  const finalRect = element.getBoundingClientRect();
  const outsideHorizontally = finalRect.left < viewport.left
    || finalRect.right > viewport.left + viewport.width;
  const outsideVertically = finalRect.top < viewport.top
    || finalRect.bottom > viewport.top + viewport.height;
  if ((axes.x && !movedX && outsideHorizontally) || (axes.y && !movedY && outsideVertically)) {
    element.scrollIntoView?.({
      block: axes.y && outsideVertically ? "center" : "nearest",
      inline: axes.x && outsideHorizontally ? "center" : "nearest",
      behavior: "auto",
    });
  }
  return revealScore(element, viewport, axes) > beforeScore + 0.01;
}

export function isOnboardingRouteActive(
  pathname: string,
  search: string,
  route: string,
  routeMatch: "exact" | "descendants" = "exact",
): boolean {
  const queryIndex = route.indexOf("?");
  const expectedPathname = queryIndex === -1 ? route : route.slice(0, queryIndex);
  const expectedSearch = queryIndex === -1 ? "" : route.slice(queryIndex + 1);
  const pathnameMatches = routeMatch === "descendants"
    ? pathname === expectedPathname || pathname.startsWith(`${expectedPathname}/`)
    : pathname === expectedPathname;
  if (!pathnameMatches) return false;

  const expectedParams = new URLSearchParams(expectedSearch);
  const currentParams = new URLSearchParams(search);
  for (const [key, value] of expectedParams.entries()) {
    if (!currentParams.getAll(key).includes(value)) return false;
  }
  return true;
}

function onboardingNavigationTarget(pathname: string, search: string, route: string): string {
  const queryIndex = route.indexOf("?");
  const expectedPathname = queryIndex === -1 ? route : route.slice(0, queryIndex);
  if (pathname !== expectedPathname || queryIndex === -1) return route;

  const params = new URLSearchParams(search);
  const expectedParams = new URLSearchParams(route.slice(queryIndex + 1));
  const expectedKeys = new Set(expectedParams.keys());
  for (const key of expectedKeys) params.delete(key);
  for (const [key, value] of expectedParams.entries()) params.append(key, value);
  const nextSearch = params.toString();
  return nextSearch ? `${expectedPathname}?${nextSearch}` : expectedPathname;
}

interface CardPlacement {
  position: CardPosition;
  side: CardSide | null;
}

function calculateCoachmarkPlacement(
  target: TargetRect | null,
  card: ElementSize,
  viewport: ElementSize,
  preferredSide: CardSide | null = null,
): CardPlacement {
  const width = Math.min(card.width || 384, Math.max(0, viewport.width - VIEWPORT_MARGIN * 2));
  const height = Math.min(card.height || 240, Math.max(0, viewport.height - VIEWPORT_MARGIN * 2));
  const maxLeft = viewport.width - width - VIEWPORT_MARGIN;
  const maxTop = viewport.height - height - VIEWPORT_MARGIN;

  if (!target) {
    return {
      position: {
        top: clamp((viewport.height - height) / 2, VIEWPORT_MARGIN, maxTop),
        left: clamp((viewport.width - width) / 2, VIEWPORT_MARGIN, maxLeft),
      },
      side: null,
    };
  }

  const centeredLeft = clamp(
    target.left + target.width / 2 - width / 2,
    VIEWPORT_MARGIN,
    maxLeft,
  );
  const centeredTop = clamp(
    target.top + target.height / 2 - height / 2,
    VIEWPORT_MARGIN,
    maxTop,
  );
  const candidates: Record<CardSide, CardPosition> = {
    above: { top: target.top - height - CARD_GAP, left: centeredLeft },
    below: { top: target.top + target.height + CARD_GAP, left: centeredLeft },
    left: { top: centeredTop, left: target.left - width - CARD_GAP },
    right: { top: centeredTop, left: target.left + target.width + CARD_GAP },
  };
  const available: Record<CardSide, number> = {
    above: target.top - VIEWPORT_MARGIN,
    below: viewport.height - VIEWPORT_MARGIN - target.top - target.height,
    left: target.left - VIEWPORT_MARGIN,
    right: viewport.width - VIEWPORT_MARGIN - target.left - target.width,
  };
  const targetCenterY = target.top + target.height / 2;
  const targetCenterX = target.left + target.width / 2;
  const horizontalOrder: CardSide[] = targetCenterX < viewport.width / 2
    ? ["right", "left"]
    : ["left", "right"];
  const preferred: CardSide[] = targetCenterY < viewport.height / 2
    ? ["below", ...horizontalOrder, "above"]
    : ["above", ...horizontalOrder, "below"];

  const orderedSides = preferredSide
    ? [preferredSide, ...preferred.filter((side) => side !== preferredSide)]
    : preferred;
  for (const side of orderedSides) {
    const required = side === "above" || side === "below" ? height + CARD_GAP : width + CARD_GAP;
    if (available[side] >= required) return { position: candidates[side], side };
  }

  return {
    position: {
      top: clamp((viewport.height - height) / 2, VIEWPORT_MARGIN, maxTop),
      left: clamp((viewport.width - width) / 2, VIEWPORT_MARGIN, maxLeft),
    },
    side: null,
  };
}

export function calculateCoachmarkPosition(
  target: TargetRect | null,
  card: ElementSize,
  viewport: ElementSize,
): CardPosition {
  return calculateCoachmarkPlacement(target, card, viewport).position;
}

function cardOverlapsTarget(
  position: CardPosition,
  card: ElementSize,
  target: TargetRect,
): boolean {
  return position.left < rectRight(target)
    && position.left + card.width > target.left
    && position.top < rectBottom(target)
    && position.top + card.height > target.top;
}

function calculateRuntimeLayout(
  stepId: string,
  target: TargetRect | null,
  targetFound: boolean,
  card: ElementSize,
  viewport: ViewportRect,
  preferredSide: CardSide | null,
): CoachmarkLayout {
  const localTarget = target
    ? { ...target, top: target.top - viewport.top, left: target.left - viewport.left }
    : null;
  let placement = calculateCoachmarkPlacement(
    localTarget,
    card,
    { width: viewport.width, height: viewport.height },
    preferredSide,
  );
  let localPosition = placement.position;
  let displayedTarget = target;
  const absolutePosition = {
    top: localPosition.top + viewport.top,
    left: localPosition.left + viewport.left,
  };

  if (target && cardOverlapsTarget(absolutePosition, card, target)) {
    displayedTarget = null;
    placement = calculateCoachmarkPlacement(
      null,
      card,
      { width: viewport.width, height: viewport.height },
    );
    localPosition = placement.position;
  }

  return {
    stepId,
    ready: true,
    targetFound,
    targetRect: displayedTarget,
    cardSide: displayedTarget ? placement.side : null,
    cardPosition: {
      top: localPosition.top + viewport.top,
      left: localPosition.left + viewport.left,
    },
    viewport,
  };
}

function initialLayout(stepId: string): CoachmarkLayout {
  return {
    stepId,
    ready: false,
    targetFound: false,
    targetRect: null,
    cardPosition: null,
    cardSide: null,
    viewport: null,
  };
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.closest('[aria-hidden="true"], [inert]'));
}

export function Coachmark({ chapter }: CoachmarkProps): React.ReactPortal | null {
  const navigate = useNavigate();
  const location = useLocation();
  const cardRef = useRef<HTMLDivElement>(null);
  const focusedStepRef = useRef<string | null>(null);
  const activeStepIndex = useOnboardingStore((state) => state.activeStepIndex);
  const setActiveStep = useOnboardingStore((state) => state.setActiveStep);
  const completeChapter = useOnboardingStore((state) => state.completeChapter);
  const dismissChapter = useOnboardingStore((state) => state.dismissChapter);
  const exitChapter = useOnboardingStore((state) => state.exitChapter);
  const isTerminalActionPending = useOnboardingStore((state) => state.isTerminalActionPending);
  const persistenceError = useOnboardingStore((state) => state.persistenceError);
  const clearPersistenceError = useOnboardingStore((state) => state.clearPersistenceError);
  const safeIndex = Math.min(activeStepIndex, chapter.steps.length - 1);
  const current = chapter.steps[safeIndex];
  const currentRouteIsActive = current
    ? isOnboardingRouteActive(location.pathname, location.search, current.route, current.routeMatch)
    : false;
  const [layout, setLayout] = useState<CoachmarkLayout>(() => initialLayout(current?.id ?? ""));

  useEffect(() => {
    if (!current) return;
    if (!currentRouteIsActive) {
      navigate(onboardingNavigationTarget(location.pathname, location.search, current.route), { replace: true });
    }
  }, [current, currentRouteIsActive, location.pathname, location.search, navigate]);

  useLayoutEffect(() => {
    if (!current || !currentRouteIsActive) {
      setLayout(initialLayout(current?.id ?? ""));
      return;
    }

    let frame = 0;
    let targetLossTimer: number | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let treeMutationObserver: MutationObserver | undefined;
    let attributeMutationObserver: MutationObserver | undefined;
    let observedTarget: HTMLElement | null = null;
    let acceptedTarget: HTMLElement | null = null;
    let acceptedRect: TargetRect | null = null;
    let pendingTarget: HTMLElement | null = null;
    let pendingRect: TargetRect | null = null;
    let pendingStartedAt: number | null = null;
    let pendingStableFrames = 0;
    let targetMissingSince: number | null = null;
    let previousRect: TargetRect | null = null;
    let stableFrames = 0;
    let initialRevealAttempts = 0;
    let unresolvedReveal: RevealSnapshot | null = null;
    let targetAttachmentLocked = false;
    let updateScheduled = false;
    let acquisitionStartedAt = 0;
    let preferredSide: CardSide | null = null;
    let cancelled = false;
    const stepId = current.id;

    const commit = (nextLayout: CoachmarkLayout): void => {
      setLayout((previous) => layoutsAreEqual(previous, nextLayout) ? previous : nextLayout);
    };

    const commitRuntimeLayout = (
      target: TargetRect | null,
      targetFound: boolean,
      card: ElementSize,
      viewport: ViewportRect,
    ): void => {
      const nextLayout = calculateRuntimeLayout(
        stepId,
        target,
        targetFound,
        card,
        viewport,
        preferredSide,
      );
      preferredSide = nextLayout.cardSide;
      commit(nextLayout);
    };

    const measureCard = (): ElementSize | null => {
      const cardRect = cardRef.current?.getBoundingClientRect();
      if (!cardRect) return null;
      return { width: cardRect.width, height: cardRect.height };
    };

    const resetPendingGeometry = (): void => {
      pendingTarget = null;
      pendingRect = null;
      pendingStartedAt = null;
      pendingStableFrames = 0;
    };

    const clearTargetLossTimer = (): void => {
      if (targetLossTimer !== undefined) window.clearTimeout(targetLossTimer);
      targetLossTimer = undefined;
    };

    const configureTargetObservers = (target: HTMLElement | null): void => {
      resizeObserver?.disconnect();
      if (resizeObserver && cardRef.current) resizeObserver.observe(cardRef.current);
      attributeMutationObserver?.disconnect();

      let candidate: HTMLElement | null = target;
      while (candidate) {
        resizeObserver?.observe(candidate);
        attributeMutationObserver?.observe(candidate, {
          attributes: true,
          attributeFilter: ["style", "class", "aria-hidden", "data-state"],
        });
        if (candidate === document.documentElement) break;
        candidate = candidate.parentElement;
      }
      observedTarget = target;
    };

    const revealIfNeeded = (
      match: TargetMatch,
      viewport: ViewportRect,
    ): "settled" | "moved" | "blocked" => {
      const axes = targetRevealAxes(match, viewport);
      if (!axes.x && !axes.y) {
        unresolvedReveal = null;
        return "settled";
      }
      if (revealSnapshotsAreEqual(unresolvedReveal, match, axes)) return "blocked";
      const improved = revealTarget(match.element, viewport, axes);
      if (improved) {
        unresolvedReveal = null;
        return "moved";
      }
      unresolvedReveal = {
        element: match.element,
        rawRect: match.rawRect,
        visibleRect: match.visibleRect,
        axes,
      };
      return "blocked";
    };

    const measureSettledLayout = (): void => {
      updateScheduled = false;
      const viewport = readViewport();
      const card = measureCard();
      if (!card) return;

      const match = targetAttachmentLocked ? null : findTarget(current.target, viewport);
      if (match && revealIfNeeded(match, viewport) === "moved") {
        scheduleSettledMeasurement();
        return;
      }

      const nextRect = match?.visibleRect ?? null;
      if (!current.target) {
        acceptedTarget = null;
        acceptedRect = null;
        resetPendingGeometry();
        commitRuntimeLayout(null, false, card, viewport);
        return;
      }

      if (!match || !nextRect) {
        resetPendingGeometry();
        if (acceptedRect) {
          const now = performance.now();
          targetMissingSince ??= now;
          const remainingGrace = TARGET_LOSS_GRACE_MS - (now - targetMissingSince);
          if (remainingGrace > 0) {
            clearTargetLossTimer();
            targetLossTimer = window.setTimeout(scheduleSettledMeasurement, remainingGrace);
            return;
          }
        }
        clearTargetLossTimer();
        targetMissingSince = null;
        acceptedTarget = null;
        acceptedRect = null;
        preferredSide = null;
        if (observedTarget) configureTargetObservers(null);
        commitRuntimeLayout(null, false, card, viewport);
        return;
      }

      clearTargetLossTimer();
      targetMissingSince = null;
      if (acceptedTarget === match.element && rectsAreClose(acceptedRect, nextRect)) {
        acceptedRect = nextRect;
        resetPendingGeometry();
        commitRuntimeLayout(nextRect, true, card, viewport);
        return;
      }

      const now = performance.now();
      if (pendingTarget !== match.element) {
        pendingTarget = match.element;
        pendingRect = nextRect;
        pendingStartedAt = now;
        pendingStableFrames = 0;
      } else if (rectsAreClose(pendingRect, nextRect)) {
        pendingStableFrames += 1;
      } else {
        pendingRect = nextRect;
        pendingStableFrames = 0;
      }

      if (
        pendingStableFrames < STABLE_FRAME_COUNT
        && now - (pendingStartedAt ?? now) < GEOMETRY_SETTLE_MAX_MS
      ) {
        scheduleSettledMeasurement();
        return;
      }

      acceptedTarget = match.element;
      acceptedRect = nextRect;
      resetPendingGeometry();
      if (observedTarget !== match.element) configureTargetObservers(match.element);
      commitRuntimeLayout(nextRect, true, card, viewport);
    };

    const scheduleSettledMeasurement = (): void => {
      if (updateScheduled) return;
      updateScheduled = true;
      frame = requestAnimationFrame(measureSettledLayout);
    };

    const startObservers = (): void => {
      window.addEventListener("resize", scheduleSettledMeasurement);
      window.addEventListener("scroll", scheduleSettledMeasurement, true);
      window.visualViewport?.addEventListener("resize", scheduleSettledMeasurement);
      window.visualViewport?.addEventListener("scroll", scheduleSettledMeasurement);

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(scheduleSettledMeasurement);
      }
      if (typeof MutationObserver !== "undefined") {
        treeMutationObserver = new MutationObserver(scheduleSettledMeasurement);
        attributeMutationObserver = new MutationObserver(scheduleSettledMeasurement);
        treeMutationObserver.observe(document.body, {
          subtree: true,
          childList: true,
        });
      }
      configureTargetObservers(observedTarget);
    };

    const acquire = (): void => {
      const viewport = readViewport();
      const card = measureCard();
      if (!card) {
        frame = requestAnimationFrame(acquire);
        return;
      }

      const match = findTarget(current.target, viewport);
      if (match) {
        const revealStatus = revealIfNeeded(match, viewport);
        if (revealStatus !== "settled") {
          initialRevealAttempts += 1;
          if (revealStatus === "moved" && initialRevealAttempts <= MAX_REVEAL_ATTEMPTS) {
            previousRect = null;
            stableFrames = 0;
            frame = requestAnimationFrame(acquire);
            return;
          }
          targetAttachmentLocked = true;
          commitRuntimeLayout(null, false, card, viewport);
          startObservers();
          return;
        }
      }

      const nextRect = match?.visibleRect ?? null;
      if (rectsAreClose(previousRect, nextRect)) stableFrames += 1;
      else stableFrames = 0;
      previousRect = nextRect;

      const targetReady = !current.target || Boolean(nextRect);
      if (targetReady && stableFrames >= STABLE_FRAME_COUNT) {
        observedTarget = match?.element ?? null;
        acceptedTarget = observedTarget;
        acceptedRect = nextRect;
        commitRuntimeLayout(nextRect, Boolean(match), card, viewport);
        startObservers();
        return;
      }

      if (performance.now() - acquisitionStartedAt >= TARGET_TIMEOUT_MS) {
        // A busy destination can delay the first animation frames past the
        // shared deadline even when its stable target is already visible. Use
        // the best visible measurement instead of discarding it solely because
        // there was no time left to collect the usual stability samples.
        if (match && nextRect) {
          observedTarget = match.element;
          acceptedTarget = match.element;
          acceptedRect = nextRect;
          commitRuntimeLayout(nextRect, true, card, viewport);
          startObservers();
          return;
        }
        // A late target must not pull an already-visible explanation across the
        // screen. Async pages must provide an always-mounted, layout-stable
        // anchor; the bounded centered fallback is deliberately immutable.
        targetAttachmentLocked = true;
        commitRuntimeLayout(null, false, card, viewport);
        startObservers();
        return;
      }
      frame = requestAnimationFrame(acquire);
    };

    setLayout(initialLayout(stepId));
    // Surface teardown and target acquisition share one bounded deadline. A
    // stubborn closing dialog must not add its full timeout on top of the
    // target timeout and leave an invisible interaction shield in place.
    acquisitionStartedAt = performance.now();
    prepareSurfacesForOnboarding();
    const beginAcquisition = (): void => {
      if (cancelled) return;
      frame = requestAnimationFrame(acquire);
    };
    void waitForOnboardingSurfacesToSettle().then(beginAcquisition, beginAcquisition);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTargetLossTimer();
      resizeObserver?.disconnect();
      treeMutationObserver?.disconnect();
      attributeMutationObserver?.disconnect();
      window.removeEventListener("resize", scheduleSettledMeasurement);
      window.removeEventListener("scroll", scheduleSettledMeasurement, true);
      window.visualViewport?.removeEventListener("resize", scheduleSettledMeasurement);
      window.visualViewport?.removeEventListener("scroll", scheduleSettledMeasurement);
    };
  }, [current, currentRouteIsActive]);

  const cardReady = Boolean(current && layout.stepId === current.id && layout.ready && layout.cardPosition);

  useEffect(() => {
    if (!current || !currentRouteIsActive || !cardReady) {
      focusedStepRef.current = null;
      return;
    }
    if (focusedStepRef.current === current.id) return;
    focusedStepRef.current = current.id;
    cardRef.current?.focus({ preventScroll: true });
  }, [cardReady, current, currentRouteIsActive]);

  useEffect(() => {
    if (!cardReady || !currentRouteIsActive) return;
    const containFocus = (event: FocusEvent): void => {
      const card = cardRef.current;
      if (!card || (event.target instanceof Node && card.contains(event.target))) return;
      const focusable = focusableElements(card);
      (focusable[0] ?? card).focus({ preventScroll: true });
    };
    document.addEventListener("focusin", containFocus, true);
    return () => document.removeEventListener("focusin", containFocus, true);
  }, [cardReady, currentRouteIsActive]);

  useEffect(() => {
    if (!currentRouteIsActive) return;
    const preventBackgroundScroll = (event: WheelEvent | TouchEvent): void => {
      const target = event.target;
      if (target instanceof Node && cardRef.current?.contains(target)) return;
      event.preventDefault();
    };
    document.addEventListener("wheel", preventBackgroundScroll, { capture: true, passive: false });
    document.addEventListener("touchmove", preventBackgroundScroll, { capture: true, passive: false });
    return () => {
      document.removeEventListener("wheel", preventBackgroundScroll, true);
      document.removeEventListener("touchmove", preventBackgroundScroll, true);
    };
  }, [currentRouteIsActive]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!currentRouteIsActive) return;
      if (event.key === "Tab") {
        const card = cardRef.current;
        if (!card) return;
        if (!cardReady) {
          event.preventDefault();
          return;
        }
        const focusable = focusableElements(card);
        if (focusable.length === 0) {
          event.preventDefault();
          card.focus({ preventScroll: true });
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!card.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && (document.activeElement === card || document.activeElement === first)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (!isTerminalActionPending) exitChapter();
        return;
      }
      if (event.repeat || isTerminalActionPending) return;
      if (event.key === "ArrowLeft" && safeIndex > 0) {
        event.preventDefault();
        void setActiveStep(safeIndex - 1, chapter.steps[safeIndex - 1]?.id);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (safeIndex < chapter.steps.length - 1) {
          void setActiveStep(safeIndex + 1, chapter.steps[safeIndex + 1]?.id);
        }
        else void completeChapter(chapter.id);
        return;
      }
      if (
        ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)
        && !(event.target instanceof Node && cardRef.current?.contains(event.target))
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cardReady, chapter.id, chapter.steps, completeChapter, currentRouteIsActive, exitChapter, isTerminalActionPending, safeIndex, setActiveStep]);

  if (!current || !currentRouteIsActive || typeof document === "undefined") return null;

  const targetRect = cardReady ? layout.targetRect : null;
  const viewport = layout.viewport ?? readViewport();
  const cardWidth = Math.max(0, Math.min(384, viewport.width - VIEWPORT_MARGIN * 2));
  const cardMaxHeight = Math.max(0, viewport.height - VIEWPORT_MARGIN * 2);
  const clippedTop = targetRect
    ? Math.max(viewport.top + 4, targetRect.top - SPOTLIGHT_PADDING)
    : 0;
  const clippedLeft = targetRect
    ? Math.max(viewport.left + 4, targetRect.left - SPOTLIGHT_PADDING)
    : 0;
  const clippedRight = targetRect
    ? Math.min(viewport.left + viewport.width - 4, rectRight(targetRect) + SPOTLIGHT_PADDING)
    : 0;
  const clippedBottom = targetRect
    ? Math.min(viewport.top + viewport.height - 4, rectBottom(targetRect) + SPOTLIGHT_PADDING)
    : 0;
  const spotlight = targetRect && clippedRight > clippedLeft && clippedBottom > clippedTop
    ? {
        top: clippedTop,
        left: clippedLeft,
        width: clippedRight - clippedLeft,
        height: clippedBottom - clippedTop,
      }
    : null;

  return createPortal(
    <div
      data-onboarding-overlay
      className="pointer-events-auto fixed inset-0 z-[1000000000] overscroll-contain"
      aria-live="polite"
    >
      <div
        className={cn(
          "absolute inset-0 motion-safe:transition-opacity motion-safe:duration-150",
          cardReady ? (spotlight ? "bg-transparent opacity-100" : "bg-black/70 opacity-100") : "bg-transparent opacity-0",
        )}
        aria-hidden
      />
      {!cardReady && <p role="status" className="sr-only">Preparing {current.title}</p>}
      {spotlight && (
        <div
          data-onboarding-spotlight
          className="pointer-events-none fixed rounded-md border-2 border-brand bg-transparent shadow-[0_0_0_9999px_rgba(0,0,0,0.70)]"
          style={spotlight}
          aria-hidden
        />
      )}
      <div
        ref={cardRef}
        data-onboarding-coachmark
        data-onboarding-target-id={current.target}
        data-onboarding-target-found={layout.targetFound}
        data-onboarding-card-side={layout.cardSide ?? "center"}
        role="dialog"
        aria-modal="true"
        aria-busy={!cardReady}
        aria-hidden={!cardReady}
        aria-labelledby="onboarding-step-title"
        inert={!cardReady}
        tabIndex={-1}
        style={{
          ...(layout.cardPosition ?? { top: viewport.top + VIEWPORT_MARGIN, left: viewport.left + VIEWPORT_MARGIN }),
          width: cardWidth,
          maxWidth: cardWidth,
          maxHeight: cardMaxHeight,
        }}
        className={cn(
          "fixed overflow-y-auto overscroll-contain rounded-md border border-ink-500 bg-ink-100 p-4 text-paper shadow-2xl outline-none sm:p-5",
          cardReady ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-brand">
              {chapter.title} · {safeIndex + 1}/{chapter.steps.length}
            </p>
            <h2 id="onboarding-step-title" className="mt-2 text-[17px] font-semibold tracking-tight">
              {current.title}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-xs"
            disabled={isTerminalActionPending}
            onClick={exitChapter}
            aria-label="Exit guide"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-3 text-[13px] leading-6 text-paper-muted">{current.body}</p>
        {persistenceError && (
          <div role="alert" className="mt-3 rounded-xs border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-[11px] leading-5 text-amber-100">
            <p>{persistenceError}</p>
            <button type="button" className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-amber-200 hover:text-paper" onClick={clearPersistenceError}>
              Dismiss
            </button>
          </div>
        )}
        <div className="mt-5 h-1 overflow-hidden rounded-full bg-ink-400" aria-hidden>
          <div
            className="h-full bg-brand motion-safe:transition-all"
            style={{ width: `${((safeIndex + 1) / chapter.steps.length) * 100}%` }}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            disabled={isTerminalActionPending}
            onClick={() => void dismissChapter(chapter.id)}
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-dim hover:text-paper disabled:opacity-50"
          >
            Skip chapter
          </button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safeIndex === 0 || isTerminalActionPending}
              onClick={() => void setActiveStep(safeIndex - 1, chapter.steps[safeIndex - 1]?.id)}
              className="rounded-xs"
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
            </Button>
            {safeIndex < chapter.steps.length - 1 ? (
              <Button
                size="sm"
                disabled={isTerminalActionPending}
                onClick={() => void setActiveStep(safeIndex + 1, chapter.steps[safeIndex + 1]?.id)}
                className="rounded-xs"
              >
                Next <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={isTerminalActionPending}
                onClick={() => void completeChapter(chapter.id)}
                className="rounded-xs"
              >
                Complete <Check className="ml-1 h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
