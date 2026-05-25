/**
 * fireAlertToast — the in-app surface for a fired fleet alert.
 *
 * The red twin of the app's success toast: we recolor the global editorial
 * toast wrapper into a soft red card (so it inherits Sonner's default width,
 * edge offset and shadow — i.e. the exact sizing that makes the success toast
 * look tidy) and drop in a one-liner — `(!) node · value · user`. The row is
 * clickable to open the node's live queries; a round ✕ dismisses. A stable id
 * per node+rule means a fresh breach replaces the toast instead of stacking.
 */

import { toast } from "sonner";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

export function fireAlertToast(opts: {
  /** Node name, e.g. "clickhouse-bi.paysera.net". */
  node: string;
  /** Self-describing value, e.g. "34.8 GB query" / "57% memory". */
  summary: string;
  /** Offending query's user (query rules only). */
  user?: string;
  /** Open the node's live queries. */
  onInvestigate?: () => void;
  /** Stable id (node+rule) so re-fires replace rather than stack. */
  dedupeId?: string;
}) {
  toast.custom(
    (id) => (
      <div className="flex w-full items-center gap-2.5">
        {/* filled severity dot — the red twin of the success check */}
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-red-500 shadow-sm">
          <span className="text-[11px] font-bold leading-none text-white">!</span>
        </span>
        <button
          type="button"
          aria-label={`Alert: ${opts.node}, ${opts.summary}`}
          title={opts.onInvestigate ? "Open live queries on this node" : undefined}
          onClick={
            opts.onInvestigate
              ? () => {
                  opts.onInvestigate?.();
                  toast.dismiss(id);
                }
              : undefined
          }
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 text-left text-[12px]",
            opts.onInvestigate && "cursor-pointer",
          )}
        >
          <span className="min-w-0 truncate font-medium text-red-900 dark:text-red-100">
            {opts.node}
          </span>
          <span className="shrink-0 text-red-300 dark:text-red-500/60">·</span>
          <span className="shrink-0 whitespace-nowrap text-red-700 dark:text-red-300">
            {opts.summary}
          </span>
          {opts.user && (
            <>
              <span className="shrink-0 text-red-300 dark:text-red-500/60">·</span>
              <span className="shrink-0 font-mono text-[11px] text-red-500 dark:text-red-400">
                {opts.user}
              </span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => toast.dismiss(id)}
          aria-label="Dismiss"
          className="grid h-6 w-6 shrink-0 self-center place-items-center rounded-full text-red-400 transition-colors hover:bg-red-100 hover:text-red-700 dark:text-red-400/70 dark:hover:bg-red-900/50 dark:hover:text-red-200"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    ),
    {
      id: opts.dedupeId,
      duration: 60_000,
      closeButton: false,
      // Recolor the editorial wrapper into a soft red card + pin the width.
      // `toast.custom` sizes to its content (unlike regular toasts which get a
      // fixed 356px), so without an explicit width a long one-liner overflows to
      // the edge. 356px matches the success toast exactly.
      classNames: {
        toast:
          "!w-[356px] !max-w-[calc(100vw-2rem)] !items-center !gap-0 !rounded-lg !border-red-200 !bg-red-50 !p-3 !shadow-lg dark:!border-red-900/60 dark:!bg-red-950/40",
      },
    },
  );
}
