import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, MessageCircle, PanelRight, X } from "lucide-react";

import { useWindowSize } from "@/hooks/useWindowSize";
import { LAYERS, leftOfRail } from "@/lib/layers";
import { cn } from "@/lib/utils";
import type { ChobiSide, ChobiSize, ChobiTab } from "@/stores/chobi";
import { Mascot, MOOD_LABELS, type ChobiMood } from "./Mascot";

const TAB_LABELS: Record<ChobiTab, string> = { now: "Now", chat: "Chat", activity: "Activity" };

const SIZE_OPTIONS: Array<{ size: ChobiSize; label: string; icon: typeof PanelRight }> = [
  { size: "bubble", label: "Bubble", icon: MessageCircle },
  { size: "docked", label: "Docked", icon: PanelRight },
  { size: "focus", label: "Focus", icon: Maximize2 },
];

const LAUNCHER_GAP = 76;
const EDGE = 16;

interface PanelGeometry {
  top?: number;
  bottom?: number;
  /** A CSS length on the left: past the dock rail when it shows. */
  left?: number | string;
  right?: number;
  width?: number;
  height?: number;
}

/** Where the panel sits for a size, next to the launcher's side and height. */
function panelGeometry(size: ChobiSize, side: ChobiSide, y: number, width: number, height: number, mobile: boolean): PanelGeometry {
  if (mobile) return { top: 0, left: 0, right: 0, bottom: 0 };
  if (size === "focus") {
    const w = Math.min(1200, width - 2 * 24);
    return { top: 24, left: Math.round((width - w) / 2), width: w, height: height - 48 };
  }
  if (size === "docked") {
    const w = Math.min(Math.max(Math.round(width * 0.34), 440), 640, width);
    return { top: 0, bottom: 0, ...(side === "left" ? { left: leftOfRail(0) } : { right: 0 }), width: w };
  }
  const w = Math.min(420, width - LAUNCHER_GAP - EDGE);
  const h = Math.min(640, height - 2 * EDGE);
  const top = Math.min(Math.max(Math.round(y * height - h / 2), EDGE), Math.max(EDGE, height - h - EDGE));
  return { top, ...(side === "left" ? { left: leftOfRail(LAUNCHER_GAP) } : { right: LAUNCHER_GAP }), width: w, height: h };
}

interface PanelProps {
  open: boolean;
  size: ChobiSize;
  tab: ChobiTab;
  tabs: readonly ChobiTab[];
  side: ChobiSide;
  y: number;
  mood: ChobiMood;
  plain: boolean;
  pendingApprovals: number;
  /** What the header says under the name (a reply's progress, or the mood). */
  status?: string | null;
  /** Extra header controls (the nudge menu). */
  controls?: ReactNode;
  onClose: () => void;
  onSize: (size: ChobiSize) => void;
  onTab: (tab: ChobiTab) => void;
  /** Renders a tab's content; `width` is the panel's inner width. */
  children: (tab: ChobiTab, width: number) => ReactNode;
}

/**
 * Chobi's panel (ADR 0025 §6): Bubble floats beside the launcher, Docked is a
 * side sheet, Focus fills the screen. Every tab stays mounted while the panel
 * is closed, so a reply in progress keeps streaming.
 */
export function Panel({ open, size, tab, tabs, side, y, mood, plain, pendingApprovals, status, controls, onClose, onSize, onTab, children }: PanelProps): React.JSX.Element {
  const { width: viewportWidth, height: viewportHeight, breakpoint } = useWindowSize();
  const mobile = breakpoint === "mobile";
  const geometry = panelGeometry(size, side, y, viewportWidth, viewportHeight, mobile);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [innerWidth, setInnerWidth] = useState(geometry.width ?? viewportWidth);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured) setInnerWidth(Math.round(measured));
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {open && size === "focus" && !mobile && (
        <div className="fixed inset-0 bg-black/50" style={{ zIndex: LAYERS.chobiPanel }} onClick={onClose} aria-hidden data-testid="chobi-backdrop" />
      )}
      <section
        role="dialog"
        aria-modal="false"
        aria-label="Chobi, the CHouse assistant"
        data-onboarding-surface="ai-chat"
        data-testid="chobi-panel"
        data-size={mobile ? "full" : size}
        hidden={!open}
        className={cn(
          "fixed flex flex-col overflow-hidden border-ink-500 bg-ink-100 shadow-2xl shadow-black/50",
          mobile ? "rounded-none border-0" : size === "docked" ? (side === "right" ? "border-l" : "border-r") : "rounded-lg border",
        )}
        style={{ ...geometry, zIndex: LAYERS.chobiPanel }}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-ink-500 bg-ink-200 px-3 py-2">
          <Mascot mood={mood} plain={plain} size={30} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-tight text-paper">Chobi</p>
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.12em] text-paper-faint" aria-live="polite">
              {status ?? MOOD_LABELS[mood]}
            </p>
          </div>
          {controls}
          {!mobile && (
            <div className="flex items-center gap-0.5" role="group" aria-label="Panel size">
              {SIZE_OPTIONS.map(({ size: option, label, icon: Icon }) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => onSize(option)}
                  aria-pressed={size === option}
                  title={label}
                  aria-label={label}
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-xs transition-colors hover:bg-ink-300 hover:text-paper",
                    size === option ? "text-brand" : "text-paper-dim",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close Chobi"
            className="grid h-7 w-7 place-items-center rounded-xs text-paper-dim transition-colors hover:bg-ink-300 hover:text-paper"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <nav className="flex shrink-0 border-b border-ink-500 bg-ink-100 px-2" role="tablist" aria-label="Chobi">
          {tabs.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              id={`chobi-tab-${option}`}
              aria-selected={tab === option}
              aria-controls={`chobi-tabpanel-${option}`}
              onClick={() => onTab(option)}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                tab === option ? "text-paper" : "text-paper-faint hover:text-paper-muted",
              )}
            >
              {TAB_LABELS[option]}
              {option === "activity" && pendingApprovals > 0 && (
                <span className="rounded-full bg-brand px-1.5 text-[10px] font-semibold text-ink-50" aria-label={`${pendingApprovals} waiting`}>
                  {pendingApprovals}
                </span>
              )}
              {tab === option && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand" aria-hidden />}
            </button>
          ))}
        </nav>
        <div ref={bodyRef} className="relative min-h-0 flex-1">
          {tabs.map((option) => (
            <div
              key={option}
              role="tabpanel"
              id={`chobi-tabpanel-${option}`}
              aria-labelledby={`chobi-tab-${option}`}
              hidden={tab !== option}
              className="absolute inset-0"
            >
              {children(option, innerWidth)}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
