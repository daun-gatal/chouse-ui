/**
 * AiDiagnoseButton — a reusable "Chouse AI: diagnose & solve" control for the
 * Monitoring surfaces (Errors, Parts, …). It runs a caller-supplied diagnosis
 * (so each surface decides WHAT to diagnose), then renders the structured
 * result — summary, cause, impact, ordered solution steps — in a dialog, with
 * an optional model picker. Gated by ai:optimize.
 */

import { useState } from "react";
import { Sparkles, Loader2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRbacStore, RBAC_PERMISSIONS } from "@/stores";
import { fetchOptimizeModels, type ErrorDiagnosis } from "@/api/query";
import { cn } from "@/lib/utils";

function DiagSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">{label}</span>
      <p className="mt-1 text-[12px] leading-[1.65] text-paper-muted">{children}</p>
    </div>
  );
}

/** Renders a structured Chouse AI diagnosis: summary + cause + impact + steps. */
export function DiagnosisView({ d }: { d: ErrorDiagnosis }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] font-medium leading-[1.5] text-paper">{d.summary}</p>
      <DiagSection label="Likely cause">{d.cause}</DiagSection>
      <DiagSection label="Impact">{d.impact}</DiagSection>
      <div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand">Solution</span>
        <ol className="mt-2 flex flex-col gap-2">
          {d.solutions.map((s, i) => (
            <li
              key={i}
              className="flex gap-2.5 rounded-xs border border-ink-500 bg-ink-200 p-3 text-[12px] text-paper"
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand/15 font-mono text-[10px] text-brand">
                {i + 1}
              </span>
              <span className="whitespace-pre-wrap leading-[1.6]">{s}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

interface AiDiagnoseButtonProps {
  /** Trigger button text (e.g. "Fix", "Diagnose"). */
  label: string;
  /** Dialog title. */
  title: string;
  /** Small chip in the dialog header (e.g. "210 · NETWORK_ERROR" or "db.table"). */
  badge?: string;
  /** Dialog description line. */
  subtitle?: string;
  /** Runs the diagnosis; the surface decides what to diagnose. */
  runDiagnosis: (modelId?: string) => Promise<ErrorDiagnosis>;
  /** Icon-only trigger for dense table rows. */
  compact?: boolean;
  /** Label for the primary "run" button in the idle state. */
  runLabel?: string;
}

export function AiDiagnoseButton({
  label,
  title,
  badge,
  subtitle,
  runDiagnosis,
  compact = false,
  runLabel = "Run diagnosis",
}: AiDiagnoseButtonProps) {
  const { hasPermission } = useRbacStore();
  const canUse = hasPermission(RBAC_PERMISSIONS.AI_OPTIMIZE);
  const [open, setOpen] = useState(false);
  const [modelId, setModelId] = useState<string | undefined>(undefined);
  const modelsQuery = useQuery({
    queryKey: ["optimize-models"],
    queryFn: fetchOptimizeModels,
    enabled: open && canUse,
    staleTime: 5 * 60_000,
  });
  const mutation = useMutation({ mutationFn: (mid?: string) => runDiagnosis(mid) });

  if (!canUse) return null;

  const models = modelsQuery.data ?? [];
  // Just open — do NOT auto-run, so the user can pick a model first.
  const start = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={start}
        title={`${title}`}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-xs border border-brand/40 bg-brand/10 font-mono text-[9px] uppercase tracking-[0.14em] text-brand transition-colors hover:bg-brand/20",
          compact ? "px-1.5" : "px-2",
        )}
      >
        <Sparkles className="h-3 w-3" aria-hidden /> {label}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[88vh] max-w-3xl flex-col overflow-hidden rounded-xs border-ink-500 bg-ink-100 p-0">
          <DialogHeader className="flex-shrink-0 border-b border-ink-500 px-6 pb-4 pt-6">
            <DialogTitle asChild>
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand" aria-hidden />
                <span className="text-[15px] font-semibold text-paper">{title}</span>
                {badge && (
                  <span className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[10px] text-paper-muted">
                    {badge}
                  </span>
                )}
              </div>
            </DialogTitle>
            <DialogDescription className="mt-1 text-[12px] text-paper-muted">
              {subtitle ??
                "Chouse AI investigates this node read-only (system.*) and proposes a concrete fix. Review before acting."}
            </DialogDescription>
            {models.length > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">Model</span>
                <select
                  value={modelId ?? ""}
                  onChange={(e) => setModelId(e.target.value || undefined)}
                  disabled={mutation.isPending}
                  className="h-8 max-w-[280px] rounded-xs border border-ink-500 bg-ink-200 px-2 text-[11px] text-paper focus:border-brand focus:outline-none disabled:opacity-50"
                  title="Model used for the diagnosis"
                >
                  <option value="">Default model</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} · {m.model}
                      {m.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
                {mutation.data && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => mutation.mutate(modelId)}
                    disabled={mutation.isPending}
                    className="h-8 gap-1.5 rounded-xs border-ink-500 px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-muted hover:bg-ink-200 hover:text-paper"
                  >
                    <Sparkles className="h-3 w-3" /> Re-run
                  </Button>
                )}
              </div>
            )}
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
            {mutation.isPending ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Loader2 className="h-7 w-7 animate-spin text-brand" aria-hidden />
                <p className="text-[13px] text-paper-muted">Chouse AI is investigating…</p>
                <p className="text-[11px] text-paper-faint">A grounded diagnosis can take ~20–40s.</p>
              </div>
            ) : mutation.isError ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <AlertTriangle className="h-7 w-7 text-red-400" aria-hidden />
                <p className="max-w-md text-[13px] text-paper-muted">
                  {mutation.error instanceof Error ? mutation.error.message : "Diagnosis failed."}
                </p>
                <Button variant="outline" size="sm" onClick={() => mutation.mutate(modelId)} className="rounded-xs">
                  Try again
                </Button>
              </div>
            ) : mutation.data ? (
              <DiagnosisView d={mutation.data} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <Sparkles className="h-8 w-8 text-brand/70" aria-hidden />
                <p className="max-w-md text-[13px] text-paper-muted">
                  {models.length > 1
                    ? "Pick a model above (or keep the default), then run."
                    : "Chouse AI investigates this node read-only and proposes a fix."}
                </p>
                <Button
                  onClick={() => mutation.mutate(modelId)}
                  className="h-9 gap-2 rounded-xs bg-brand px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 hover:bg-brand-soft"
                >
                  <Sparkles className="h-3.5 w-3.5" /> {runLabel}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
