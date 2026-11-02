/**
 * One upgrade-check finding (ADR 0029): what changes, where the workload hits
 * it, the sources it came from, and the SQL to fix it or keep today's
 * behaviour. Collapsed to its title until opened.
 */

import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import { ChevronRight, Copy, Sparkles } from "lucide-react";

import type { Finding, Severity } from "@/api/upgrades";
import { log } from "@/lib/log";
import { prUrl, SEVERITY_LABEL } from "@/lib/upgrades";
import { cn } from "@/lib/utils";
import { humanize, type Tone } from "./lib";
import { DataTable, OBS_LABEL, StatusPill } from "./ui";

const SEVERITY_TONE: Record<Severity, Tone> = { blocker: "bad", warning: "warn", info: "info", note: "muted" };
const STRIPE: Record<Severity, string> = { blocker: "bg-red-500", warning: "bg-amber-500", info: "bg-sky-500", note: "bg-ink-500" };

export async function copyText(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch (error) {
    log.warn("[Upgrades] Copy to clipboard failed", { err: error instanceof Error ? error.message : String(error) });
    toast.error("Your browser blocked copying");
  }
}

function SqlBlock({ title, sql }: { title: string; sql: string }): ReactElement {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className={OBS_LABEL}>{title}</span>
        <button type="button" className="inline-flex h-6 items-center gap-1 rounded-xs border border-ink-500 px-2 text-[11px] text-paper-muted hover:text-paper" onClick={() => void copyText(sql, sql.startsWith("<!--") ? "Config" : "SQL")}>
          <Copy className="h-3 w-3" aria-hidden /> Copy
        </button>
      </div>
      <pre className="overflow-x-auto rounded-xs border border-ink-500 bg-ink-200 p-2.5 font-mono text-[11px] leading-relaxed text-paper">{sql}</pre>
    </div>
  );
}

export function UpgradeFinding({ finding, defaultOpen = false }: { finding: Finding; defaultOpen?: boolean }): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const f = finding;
  const e = f.evidence;
  const isAi = f.category === "ai-note";
  const notes = e.source.notes ?? [];
  const prs = [...new Set(notes.flatMap((n) => n.prs))];
  return (
    <div className="rounded-xs border border-ink-500 bg-ink-100">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="grid w-full grid-cols-[4px_minmax(0,1fr)_auto] items-start gap-3 py-3 pr-3 text-left md:grid-cols-[4px_120px_minmax(0,1fr)_auto_auto]">
        <span className={cn("h-full min-h-8 rounded-r-xs", STRIPE[f.severity])} aria-hidden />
        <span className={cn(OBS_LABEL, "hidden pt-0.5 md:block")}>{isAi ? "Release note" : humanize(f.category.replace(/-/g, " "))}</span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-paper">{f.title}</span>
          <span className="mt-0.5 block text-[12px] text-paper-muted">{f.detail}</span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <StatusPill tone={SEVERITY_TONE[f.severity]}>{SEVERITY_LABEL[f.severity]}</StatusPill>
          {isAi && <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.12em] text-brand"><Sparkles className="h-3 w-3" aria-hidden />Chouse AI</span>}
        </span>
        <ChevronRight className={cn("mt-0.5 hidden h-4 w-4 text-paper-faint transition-transform md:block", open && "rotate-90")} aria-hidden />
      </button>
      {open && (
        <div className="grid gap-4 border-t border-ink-500/60 px-4 py-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-paper-faint">
              {e.source.diff && <span><span className="mr-1 rounded-xs border border-ink-500 px-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-muted">Diff</span>{e.source.diff}</span>}
              {e.source.check && <span><span className="mr-1 rounded-xs border border-ink-500 px-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-muted">CHouse</span>{e.source.check}</span>}
              {notes.length > 0 && (
                <span>
                  <span className="mr-1 rounded-xs border border-ink-500 px-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-paper-muted">Note</span>
                  {[...new Set(notes.map((n) => n.line))].sort((x, y) => { const [a1, a2] = x.split(".").map(Number); const [b1, b2] = y.split(".").map(Number); return a1 - b1 || a2 - b2; }).join(", ")}
                  {prs.slice(0, 6).map((pr) => <a key={pr} className="ml-1.5 text-brand hover:underline" href={prUrl(pr)} target="_blank" rel="noreferrer">#{pr}</a>)}
                </span>
              )}
              {e.source.ai && <span className="text-brand">Matched by Chouse AI · {e.source.ai.model} · citation checked</span>}
            </div>
            {e.rows.length > 0 && (
              <>
                <p className={OBS_LABEL}>Where your workload hits it</p>
                <DataTable label={`Evidence for ${f.title}`} head={e.head}>
                  {e.rows.map((r, i) => (
                    <tr key={`${f.id}-${i}`}>
                      {r.cells.map((cell, j) => <td key={j} className={cn(j === 0 && "font-mono text-[11px] text-paper", "max-w-[280px] truncate")} title={cell}>{cell}</td>)}
                    </tr>
                  ))}
                </DataTable>
              </>
            )}
            {(e.totalRows > e.rows.length || (e.hiddenRows ?? 0) > 0) && (
              <p className="text-[11px] text-paper-muted">
                {e.totalRows > e.rows.length ? `Showing ${e.rows.length} of ${e.totalRows}. ` : ""}
                {(e.hiddenRows ?? 0) > 0 ? `${e.hiddenRows} more on tables you don't have access to.` : ""}
              </p>
            )}
            {e.matched && e.matched.length > 0 && <p className="text-[12px] text-paper-muted">Concerns what your workload uses: {e.matched.map((m) => <code key={m} className="mr-1 rounded-xs bg-ink-200 px-1 font-mono text-[11px] text-paper">{m}</code>)}</p>}
            {e.noteText && (
              <blockquote className="border-l-2 border-ink-500 pl-3 text-[12px] text-paper-muted">
                <span className={cn(OBS_LABEL, "mb-1 block")}>What the release note says</span>
                {e.noteText}
              </blockquote>
            )}
          </div>
          <div className="min-w-0 space-y-3">
            {e.action && <p className="text-[12px] text-paper"><span className={cn(OBS_LABEL, "mb-1 block")}>Before upgrading</span>{e.action}</p>}
            {e.fix?.sql ? <SqlBlock title={e.fix.title} sql={e.fix.sql} /> : e.fix ? <p className="text-[12px] text-paper-muted">{e.fix.title}</p> : null}
            {e.keep && <SqlBlock title={e.keep.title} sql={e.keep.sql} />}
          </div>
        </div>
      )}
    </div>
  );
}
