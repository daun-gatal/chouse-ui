import { useCallback, useEffect, useRef, useState } from "react";

import { LAYERS, leftOfRail } from "@/lib/layers";
import { cn } from "@/lib/utils";
import type { ChobiSide } from "@/stores/chobi";
import { Mascot, MOOD_LABELS, type ChobiMood } from "./Mascot";

const SIZE = 56;
/** Pointer travel before a press becomes a drag. */
const DRAG_THRESHOLD = 5;

interface LauncherProps {
  mood: ChobiMood;
  plain: boolean;
  open: boolean;
  side: ChobiSide;
  /** Vertical centre, as a fraction of the window height. */
  y: number;
  mobile: boolean;
  pendingApprovals: number;
  /** A line Chobi shows beside itself (a nudge), or null. */
  peek: string | null;
  /** AI is still loading or is off: the launcher shows but does nothing (guided tours point at it). */
  unavailable?: "loading" | "off";
  onToggle: () => void;
  onMove: (side: ChobiSide, y: number) => void;
  onDismissPeek?: () => void;
}

/**
 * Chobi itself, parked on the edge of the screen. Click to open or close the
 * panel; drag to move it — it snaps to the nearer side. Hover or focus shows a
 * peek of what it has to say.
 */
export function Launcher({ mood, plain, open, side, y, mobile, pendingApprovals, peek, unavailable, onToggle, onMove, onDismissPeek }: LauncherProps): React.JSX.Element {
  const press = useRef<{ x: number; y: number; id: number; dragging: boolean } | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  /** A drag ends with a click on the same button; that click must not toggle. */
  const dragged = useRef(false);
  const [hover, setHover] = useState(false);
  const [viewport, setViewport] = useState(() => ({ height: typeof window === "undefined" ? 800 : window.innerHeight }));

  useEffect(() => {
    const onResize = (): void => setViewport({ height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>): void => {
    if (mobile || unavailable || event.button !== 0) return;
    press.current = { x: event.clientX, y: event.clientY, id: event.pointerId, dragging: false };
    // Capture now: a quick flick can leave the button before the first move arrives.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [mobile, unavailable]);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>): void => {
    const current = press.current;
    if (!current || current.id !== event.pointerId) return;
    if (!current.dragging && Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_THRESHOLD) return;
    current.dragging = true;
    setDrag({ x: event.clientX, y: event.clientY });
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLButtonElement>): void => {
    const current = press.current;
    press.current = null;
    if (!current?.dragging) return;
    dragged.current = true;
    setDrag(null);
    onMove(event.clientX < window.innerWidth / 2 ? "left" : "right", event.clientY / window.innerHeight);
  }, [onMove]);

  const onClick = useCallback((): void => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (!unavailable) onToggle();
  }, [onToggle, unavailable]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (mobile || !event.altKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      onMove(event.key === "ArrowLeft" ? "left" : "right", y);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      onMove(side, y + (event.key === "ArrowUp" ? -0.05 : 0.05));
    }
  }, [mobile, onMove, side, y]);

  const label = unavailable === "loading"
    ? "AI assistant is loading"
    : unavailable === "off"
      ? "AI assistant is unavailable"
      : `${open ? "Close" : "Open"} Chobi${pendingApprovals > 0 ? ` (${pendingApprovals} waiting for you)` : ""}`;

  const top = Math.round(y * viewport.height - SIZE / 2);
  const style: React.CSSProperties = mobile
    // Above the phone dock bar, not on it.
    ? { position: "fixed", right: 16, bottom: 84, zIndex: LAYERS.chobiLauncher }
    : drag
      ? { position: "fixed", left: drag.x - SIZE / 2, top: drag.y - SIZE / 2, zIndex: LAYERS.chobiLauncher }
      : { position: "fixed", ...(side === "left" ? { left: leftOfRail(10) } : { right: 10 }), top, zIndex: LAYERS.chobiLauncher };
  const peekText = unavailable ? null : peek ?? (hover && !open ? `${MOOD_LABELS[mood]} · Ctrl/⌘ J` : null);

  return (
    <div style={style} className="group" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        data-onboarding-id="ai-assistant"
        data-testid="chobi-launcher"
        aria-label={label}
        aria-expanded={unavailable ? undefined : open}
        aria-keyshortcuts="Control+J Meta+J"
        title={unavailable ? label : undefined}
        disabled={Boolean(unavailable)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { press.current = null; setDrag(null); }}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className={cn(
          "relative grid touch-none select-none place-items-center rounded-full border border-ink-500 bg-ink-100/95 shadow-lg shadow-black/40 backdrop-blur transition-[transform,border-color] duration-200",
          "hover:-translate-y-0.5 hover:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          drag ? "cursor-grabbing" : "cursor-pointer",
          open && "border-brand",
          unavailable && "cursor-not-allowed opacity-60 hover:translate-y-0 hover:border-ink-500",
        )}
        style={{ width: SIZE, height: SIZE }}
      >
        <Mascot mood={unavailable ? "sleeping" : mood} plain={plain} size={plain ? 30 : 44} />
        {pendingApprovals > 0 && !unavailable && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 font-mono text-[10px] font-bold text-ink-50 ring-2 ring-ink-100" aria-hidden>
            {pendingApprovals > 9 ? "9+" : pendingApprovals}
          </span>
        )}
      </button>
      {peekText && !drag && !mobile && (
        <div
          role="status"
          className={cn(
            "absolute top-1/2 w-max max-w-[240px] -translate-y-1/2 rounded-md border border-ink-500 bg-ink-100 px-3 py-2 text-[12px] text-paper shadow-xl",
            side === "right" ? "right-full mr-2" : "left-full ml-2",
          )}
        >
          {peekText}
          {peek && onDismissPeek && (
            <button type="button" className="ml-2 text-[10px] text-paper-faint hover:text-paper" onClick={onDismissPeek} aria-label="Dismiss">
              ✕
            </button>
          )}
        </div>
      )}
    </div>
  );
}
