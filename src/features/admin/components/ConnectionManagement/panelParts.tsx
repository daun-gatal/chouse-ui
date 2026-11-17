/**
 * Small pieces the connection panel's tabs and the connection list share:
 * section headings, read-only facts, notes and the status pills.
 */

import type { ReactElement, ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { LABEL_CLASS, SECTION_TITLE_CLASS } from "./formStyles";
import type { Pill, PillTone } from "./loginForm";

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }): ReactElement {
  return (
    <section className="flex min-w-0 flex-col gap-2.5" aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <h3 className={SECTION_TITLE_CLASS}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <dt className={LABEL_CLASS}>{label}</dt>
      <dd className="min-w-0 break-all text-right font-mono text-[12px] text-paper">{children}</dd>
    </div>
  );
}

export type NoteTone = "info" | "ok" | "warn" | "bad" | "lock";

const NOTE_CLASS: Record<NoteTone, string> = {
  info: "border-ink-500 bg-ink-200 text-paper-muted",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-200",
  warn: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200",
  bad: "border-red-200 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-200",
  lock: "border-ink-500 bg-ink-200 text-paper-muted",
};

const NOTE_BODY_CLASS: Record<NoteTone, string> = {
  info: "text-paper-muted",
  ok: "text-emerald-700 dark:text-emerald-300",
  warn: "text-amber-700 dark:text-amber-300",
  bad: "text-red-700 dark:text-red-300",
  lock: "text-paper-muted",
};

function NoteIcon({ tone }: { tone: NoteTone }): ReactElement {
  const className = "mt-[3px] h-3.5 w-3.5 shrink-0";
  if (tone === "ok") return <CheckCircle2 className={className} aria-hidden />;
  if (tone === "warn") return <AlertTriangle className={className} aria-hidden />;
  if (tone === "bad") return <AlertCircle className={className} aria-hidden />;
  if (tone === "lock") return <Lock className={className} aria-hidden />;
  return <Info className={className} aria-hidden />;
}

/** A boxed message: a title line, then any body. */
export function Note({ tone, title, children, role }: { tone: NoteTone; title: ReactNode; children?: ReactNode; role?: "alert" | "status" | "note" }): ReactElement {
  return (
    <div role={role ?? (tone === "bad" ? "alert" : "note")} className={cn("rounded-xs border px-3 py-2.5", NOTE_CLASS[tone])}>
      <p className="flex items-start gap-2 text-[13px] font-medium">
        <NoteIcon tone={tone} />
        <span className="min-w-0">{title}</span>
      </p>
      {children && <div className={cn("mt-1 flex flex-col gap-1.5 pl-[22px] text-[12px] leading-[1.5]", NOTE_BODY_CLASS[tone])}>{children}</div>}
    </div>
  );
}

const PILL_CLASS: Record<PillTone, string> = {
  ok: "border-emerald-300 text-emerald-700 dark:border-emerald-500/50 dark:text-emerald-300",
  warn: "border-amber-300 text-amber-800 dark:border-amber-500/50 dark:text-amber-200",
  bad: "border-red-300 text-red-700 dark:border-red-500/50 dark:text-red-300",
  muted: "border-ink-700 text-paper-muted",
};

const DOT_CLASS: Record<PillTone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  muted: "bg-paper-faint",
};

interface StatusPillProps {
  pill: Pill;
  /** A dot before the label, for health. */
  dot?: boolean;
  /** Makes the pill a button that opens something. */
  onClick?: () => void;
  ariaLabel?: string;
  title?: string;
}

export function StatusPill({ pill, dot, onClick, ariaLabel, title }: StatusPillProps): ReactElement {
  const className = cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium",
    PILL_CLASS[pill.tone],
    onClick && "cursor-pointer hover:bg-ink-200",
  );
  const content = (
    <>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASS[pill.tone])} aria-hidden />}
      {pill.label}
      {onClick && <span aria-hidden>›</span>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={ariaLabel} title={title} className={className}>
        {content}
      </button>
    );
  }
  return (
    <span className={className} title={title} aria-label={ariaLabel}>
      {content}
    </span>
  );
}

/** A connection's kind as a small badge. */
export function KindBadge({ label }: { label: string }): ReactElement {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-xs border border-ink-700 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted">
      {label}
    </span>
  );
}

/** "a super admin", or the connection's access contact when it has one. */
export function askWhom(accessContact: string | null | undefined): string {
  const contact = accessContact?.trim();
  return contact ? contact : "a super admin";
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
