/**
 * Small building blocks shared by the Agents › Assistant views.
 */

import type { ReactElement, ReactNode } from "react";

import type { ToolContextKind } from "@/api/aiAgents";
import { StatusPill } from "@/features/observe/ui";
import { Label } from "@/components/ui/label";
import { agentOrigin, CONTEXT_HINTS, CONTEXT_LABELS } from "./lib";

export const SWITCH_CLASS = "data-[state=checked]:bg-brand data-[state=unchecked]:bg-ink-500";
export const TAB_CLASS = "h-8 rounded-xs px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim data-[state=active]:bg-ink-100 data-[state=active]:text-paper";
export const TEXTAREA_CLASS = "min-h-[120px] rounded-xs border-ink-500 bg-ink-200/40 font-mono text-[12px] leading-relaxed text-paper";
export const INPUT_CLASS = "h-8 rounded-xs border-ink-500 bg-ink-200/40 text-[12px]";

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function OriginBadge({ row }: { row: { isSystem: boolean; customized: boolean; updateAvailable?: boolean } }): ReactElement {
  const origin = agentOrigin(row);
  return (
    <span className="inline-flex items-center gap-1">
      <StatusPill tone={origin === "custom" ? "brand" : origin === "customized" ? "warn" : "muted"} dot={false}>{origin}</StatusPill>
      {row.updateAvailable && <StatusPill tone="warn" dot={false}>update available</StatusPill>}
    </span>
  );
}

export function ContextBadge({ kind }: { kind: ToolContextKind }): ReactElement {
  return (
    <span title={CONTEXT_HINTS[kind]} className="rounded-xs border border-ink-500 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted">
      {CONTEXT_LABELS[kind]}
    </span>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }): ReactElement {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-[11px] uppercase tracking-[0.12em] text-paper-dim">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-paper-faint">{hint}</p>}
    </div>
  );
}

export function ProblemList({ problems }: { problems: string[] }): ReactElement | null {
  if (problems.length === 0) return null;
  return (
    <ul role="alert" className="space-y-1 rounded-xs border border-red-500/40 bg-red-500/5 p-3 text-[12px] text-red-400">
      {problems.map((p, i) => <li key={i}>• {p}</li>)}
    </ul>
  );
}
