import { useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type PickerMode = "range" | "single";

type DrillView = "days" | "months" | "years";

interface RangePickerDrilldownProps {
  mode: PickerMode;
  range: { from?: Date; to?: Date } | null;
  /** Fired on every selection change. Single-day mode reports both ends on
   * the second click; range mode reports whatever the calendar produced. */
  onChange: (range: { from?: Date; to?: Date } | null) => void;
  /** Fired when single-day picker double-clicks (or completes second click)
   * so the parent can auto-close the popover and apply. */
  onSingleDayApply?: (range: { from: Date; to: Date }) => void;
  /** Year range for the year-grid view. */
  fromYear?: number;
  toYear?: number;
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function dayBounds(d: Date): { from: Date; to: Date } {
  const from = new Date(d);
  from.setHours(0, 0, 0, 0);
  const to = new Date(d);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

function sameDay(a: Date | undefined, b: Date | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function RangePickerDrilldown({
  mode,
  range,
  onChange,
  onSingleDayApply,
  fromYear = 2015,
  toYear = new Date().getFullYear() + 1,
}: RangePickerDrilldownProps) {
  const [view, setView] = useState<DrillView>("days");
  const [displayedMonth, setDisplayedMonth] = useState<Date>(
    () => range?.from ?? new Date()
  );
  // Year-grid view scrolls in chunks of 12; pin the chunk so flipping back
  // and forth feels stable.
  const [yearChunkStart, setYearChunkStart] = useState<number>(() => {
    const cur = (range?.from ?? new Date()).getFullYear();
    return Math.floor(cur / 12) * 12;
  });
  // Single-day staging: first click highlights, second click on the same
  // day commits. Clicking a different day resets the staging.
  const [singleStaged, setSingleStaged] = useState<Date | null>(null);

  // Reset staging if the parent changes mode under us.
  useEffect(() => {
    setSingleStaged(null);
  }, [mode]);

  const handleDayPick = (d: Date | undefined): void => {
    if (mode !== "single") return;
    // d === undefined means DayPicker fired its default deselect on the
    // second click of the same day — treat that as the commit.
    if (!d) {
      if (singleStaged) {
        const { from, to } = dayBounds(singleStaged);
        onChange({ from, to });
        onSingleDayApply?.({ from, to });
        setSingleStaged(null);
      }
      return;
    }
    if (singleStaged && sameDay(singleStaged, d)) {
      const { from, to } = dayBounds(d);
      onChange({ from, to });
      onSingleDayApply?.({ from, to });
      setSingleStaged(null);
      return;
    }
    // First click on a new day — stage it, wait for confirm click.
    setSingleStaged(d);
    onChange({ from: d, to: undefined });
  };

  const currentYear = displayedMonth.getFullYear();
  const currentMonthIdx = displayedMonth.getMonth();

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Header — drill-up + nav */}
      <div className="flex items-center justify-between gap-2">
        <NavButton
          onClick={() => {
            if (view === "days") {
              setDisplayedMonth(
                new Date(currentYear, currentMonthIdx - 1, 1)
              );
            } else if (view === "months") {
              setDisplayedMonth(new Date(currentYear - 1, currentMonthIdx, 1));
            } else {
              setYearChunkStart((y) => Math.max(fromYear, y - 12));
            }
          }}
          label="Previous"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </NavButton>

        <button
          type="button"
          onClick={() => {
            if (view === "days") setView("months");
            else if (view === "months") {
              setYearChunkStart(Math.floor(currentYear / 12) * 12);
              setView("years");
            } else setView("days");
          }}
          className="rounded-xs border border-transparent bg-transparent px-3 py-1 text-[13px] font-medium tracking-tight text-paper transition-colors hover:border-ink-500 hover:bg-ink-200"
        >
          {view === "days"
            ? `${MONTH_LABELS[currentMonthIdx]} ${currentYear}`
            : view === "months"
              ? `${currentYear}`
              : `${yearChunkStart} – ${yearChunkStart + 11}`}
        </button>

        <NavButton
          onClick={() => {
            if (view === "days") {
              setDisplayedMonth(
                new Date(currentYear, currentMonthIdx + 1, 1)
              );
            } else if (view === "months") {
              setDisplayedMonth(new Date(currentYear + 1, currentMonthIdx, 1));
            } else {
              setYearChunkStart((y) => Math.min(toYear - 11, y + 12));
            }
          }}
          label="Next"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </NavButton>
      </div>

      {/* Body — switches per drill view */}
      {view === "days" && (
        <DayPickerSwitcher
          mode={mode}
          range={range}
          singleStaged={singleStaged}
          displayedMonth={displayedMonth}
          onMonthChange={setDisplayedMonth}
          onRangePick={(r) => onChange({ from: r?.from, to: r?.to })}
          onSinglePick={handleDayPick}
        />
      )}

      {view === "months" && (
        <div className="grid grid-cols-3 gap-1.5">
          {MONTH_LABELS.map((label, i) => {
            const active = i === currentMonthIdx;
            return (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setDisplayedMonth(new Date(currentYear, i, 1));
                  setView("days");
                }}
                className={cn(
                  "rounded-xs border px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                  active
                    ? "border-brand bg-brand text-ink-50"
                    : "border-ink-500 bg-ink-200 text-paper-muted hover:border-ink-700 hover:bg-ink-300 hover:text-paper"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {view === "years" && <YearGrid
        start={yearChunkStart}
        currentYear={currentYear}
        fromYear={fromYear}
        toYear={toYear}
        onPick={(y) => {
          setDisplayedMonth(new Date(y, currentMonthIdx, 1));
          setView("months");
        }}
      />}

      {/* Footer hint */}
      {mode === "single" && view === "days" && (
        <p className="border-t border-ink-500 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
          {singleStaged
            ? "Click the same day again to apply for the full 24h."
            : "Click a day, then click it again to apply for the full 24h."}
        </p>
      )}
    </div>
  );
}

interface SwitcherProps {
  mode: PickerMode;
  range: { from?: Date; to?: Date } | null;
  singleStaged: Date | null;
  displayedMonth: Date;
  onMonthChange: (d: Date) => void;
  onRangePick: (r: { from?: Date; to?: Date } | undefined) => void;
  onSinglePick: (d: Date | undefined) => void;
}

const SHARED_CLASSNAMES = {
  months: "flex flex-col",
  month: "space-y-2",
  month_caption: "hidden",
  month_grid: "w-full border-collapse",
  weekdays: "flex",
  weekday:
    "text-paper-faint w-9 font-normal text-[0.75rem] font-mono uppercase tracking-[0.14em]",
  week: "flex w-full mt-1",
  day: "h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
  day_button: cn(
    buttonVariants({ variant: "ghost" }),
    "h-9 w-9 p-0 font-normal hover:bg-ink-200 hover:text-paper"
  ),
  selected:
    "bg-brand text-ink-50 hover:bg-brand-soft focus:bg-brand rounded-xs",
  today: "bg-ink-200 text-paper rounded-xs",
  outside: "text-paper-faint opacity-50",
  disabled: "text-paper-faint opacity-40",
  range_middle: "bg-brand/10 text-brand !rounded-none",
  range_start: "bg-brand text-ink-50 hover:bg-brand-soft rounded-l-xs",
  range_end: "bg-brand text-ink-50 hover:bg-brand-soft rounded-r-xs",
  hidden: "invisible",
};

/**
 * Type-narrows the DayPicker mode prop so TS resolves the `selected`/`onSelect`
 * union correctly. react-day-picker's discriminated union requires separate
 * <DayPicker mode="range" /> vs <DayPicker mode="single" /> call sites.
 */
function DayPickerSwitcher({
  mode,
  range,
  singleStaged,
  displayedMonth,
  onMonthChange,
  onRangePick,
  onSinglePick,
}: SwitcherProps) {
  if (mode === "range") {
    return (
      <DayPicker
        mode="range"
        selected={{ from: range?.from, to: range?.to }}
        onSelect={onRangePick}
        month={displayedMonth}
        onMonthChange={onMonthChange}
        showOutsideDays
        hideNavigation
        classNames={SHARED_CLASSNAMES}
      />
    );
  }
  return (
    <DayPicker
      mode="single"
      selected={singleStaged ?? range?.from}
      // onSelect fires with a Date on first click and with undefined on
      // second click of the same day (default deselect behaviour). Pass it
      // through — the consumer treats undefined as a confirm when a
      // selection is already staged.
      onSelect={onSinglePick}
      month={displayedMonth}
      onMonthChange={onMonthChange}
      showOutsideDays
      hideNavigation
      classNames={SHARED_CLASSNAMES}
    />
  );
}

function NavButton({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-7 w-7 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted transition-colors hover:border-ink-700 hover:bg-ink-300 hover:text-paper"
    >
      {children}
    </button>
  );
}

function YearGrid({
  start,
  currentYear,
  fromYear,
  toYear,
  onPick,
}: {
  start: number;
  currentYear: number;
  fromYear: number;
  toYear: number;
  onPick: (year: number) => void;
}) {
  const years = useMemo(
    () => Array.from({ length: 12 }, (_, i) => start + i),
    [start]
  );
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {years.map((y) => {
        const active = y === currentYear;
        const disabled = y < fromYear || y > toYear;
        return (
          <button
            key={y}
            type="button"
            disabled={disabled}
            onClick={() => onPick(y)}
            className={cn(
              "rounded-xs border px-3 py-2.5 font-mono text-[12px] tabular-nums transition-colors",
              active
                ? "border-brand bg-brand text-ink-50"
                : "border-ink-500 bg-ink-200 text-paper-muted hover:border-ink-700 hover:bg-ink-300 hover:text-paper",
              disabled && "cursor-not-allowed opacity-30"
            )}
          >
            {y}
          </button>
        );
      })}
    </div>
  );
}
