/**
 * Shared page anatomy for Monitoring, Data and Agents (ADR 0016 §14): the
 * header row (icon box, mono eyebrow, 18px title), a row of navigation pills
 * with the 1px brand underline, and a right-side controls slot. Extracted
 * from the Monitoring TabPill and DataOps FeaturePill without changing their
 * classes, so existing pages render pixel-identical.
 */

import type { ElementType, ReactElement, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface NavPillProps {
  icon: ElementType;
  label: string;
  isActive: boolean;
  onClick: () => void;
  onboardingId?: string;
  disabled?: boolean;
  /** Keeps the pill from shrinking inside a scrolling row (feature rows). */
  noShrink?: boolean;
  /** Renders the red "Live" badge after the label. */
  liveBadge?: boolean;
  /** Small count after the label (e.g. open incidents). */
  count?: number;
}

export function NavPill({ icon: Icon, label, isActive, onClick, onboardingId, disabled, noShrink, liveBadge, count }: NavPillProps): ReactElement {
  return (
    <button
      type="button"
      data-onboarding-id={onboardingId}
      onClick={onClick}
      disabled={disabled}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        noShrink
          ? "group relative inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap px-3 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors"
          : "group relative inline-flex h-9 items-center gap-2 px-3 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
        isActive ? "text-paper" : "text-paper-muted hover:text-paper",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", isActive ? "text-brand" : "text-paper-dim group-hover:text-paper")} aria-hidden />
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span className="rounded-xs border border-ink-500 bg-ink-200 px-1 py-px font-mono text-[9px] tracking-normal text-paper-muted tabular-nums">
          {count}
        </span>
      )}
      {liveBadge && (
        <span className="inline-flex items-center gap-1 rounded-xs border border-red-300 bg-red-50 px-1 py-px font-mono text-[8px] uppercase tracking-[0.16em] text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <span className="h-1 w-1 rounded-full bg-red-500 motion-safe:animate-pulse dark:bg-red-400" aria-hidden />
          Live
        </span>
      )}
      {isActive && <span className="absolute -bottom-px left-0 right-0 h-px bg-brand" aria-hidden />}
    </button>
  );
}

export interface PageHeaderProps {
  icon: ElementType;
  eyebrow: string;
  title: string;
  /** Accessible name of the pill row. */
  navLabel: string;
  /** NavPill elements. */
  nav: ReactNode;
  /** Right-side controls (status, refresh, run). */
  actions?: ReactNode;
  /**
   * "spread": title, pills and controls spread across the row (Monitoring).
   * "start": title and pills packed left, controls pushed right (Data, Agents).
   */
  layout?: "spread" | "start";
}

export function PageHeader({ icon: Icon, eyebrow, title, navLabel, nav, actions, layout = "spread" }: PageHeaderProps): ReactElement {
  const start = layout === "start";
  return (
    <header className="flex-none border-b border-ink-500 px-6 pt-4">
      {/* One row from lg up: when the pills outgrow it, the pill row scrolls instead of
          wrapping below the title and pushing the page down. Narrow screens still wrap. */}
      <div className={cn("flex flex-wrap items-end pb-0 lg:flex-nowrap", start ? "justify-start gap-6" : "justify-between gap-4")}>
        <div className="flex shrink-0 items-center gap-3 pb-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted">
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </span>
          <div className="flex flex-col gap-0">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-paper-faint">{eyebrow}</span>
            <h1 className="text-[18px] font-semibold leading-tight tracking-tight text-paper">{title}</h1>
          </div>
        </div>

        <nav
          aria-label={navLabel}
          className={cn("scrollbar-hide -mb-px flex min-w-0 items-center overflow-x-auto", start && "max-w-full")}
        >
          {nav}
        </nav>

        {actions !== undefined && <div className={cn("flex shrink-0 items-center gap-2 pb-2", start && "ml-auto")}>{actions}</div>}
      </div>
    </header>
  );
}

export interface SubTabsProps<K extends string> {
  tabs: ReadonlyArray<{ key: K; label: string; icon: ElementType; count?: number }>;
  active: K;
  onChange: (key: K) => void;
  label: string;
  /** Onboarding anchor prefix; each pill gets `${prefix}-${key}`. */
  onboardingPrefix?: string;
  /** Right-side controls on the sub-tab row (DataControls, actions). */
  trailing?: ReactNode;
}

/**
 * Second-level row inside a feature (the Scheduled Queries Overview / Jobs
 * anatomy): the same pill, packed left, with controls on the right.
 */
export function SubTabs<K extends string>({ tabs, active, onChange, label, onboardingPrefix, trailing }: SubTabsProps<K>): ReactElement {
  return (
    <div className="flex min-w-0 items-end justify-between gap-3 border-b border-ink-500 px-6 pt-2">
      <nav className="scrollbar-hide flex min-w-0 items-center gap-1 overflow-x-auto" aria-label={label}>
        {tabs.map((tab) => (
          <NavPill
            key={tab.key}
            icon={tab.icon}
            label={tab.label}
            count={tab.count}
            isActive={tab.key === active}
            onClick={() => onChange(tab.key)}
            onboardingId={onboardingPrefix ? `${onboardingPrefix}-${tab.key}` : undefined}
            noShrink
          />
        ))}
      </nav>
      {trailing}
    </div>
  );
}
