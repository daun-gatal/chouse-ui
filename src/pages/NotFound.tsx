/**
 * 404 — editorial-styled not-found page.
 *
 * Reached when a URL doesn't match any defined route. Offers two recovery
 * paths: jump to the fleet view (the new primary landing) or go back in the
 * browser history. Mirrors the dock/chrome chip + title pattern used across
 * the app so the page doesn't feel orphaned from the rest of the design.
 */

import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Globe2, Signpost } from "lucide-react";
import { cn } from "@/lib/utils";

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-ink-50 px-6 py-12">
      <div className="w-full max-w-[460px]">
        <div className="overflow-hidden rounded-md border border-ink-500 bg-ink-100">
          {/* Header — chip + mono code + title */}
          <div className="flex flex-col gap-3 border-b border-ink-500 px-7 py-6">
            <span className="inline-flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">
              <span className="text-paper-faint">404</span>
              <span className="h-px w-6 bg-ink-700" aria-hidden />
              Page not found
            </span>
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper-muted">
                <Signpost className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <h1 className="text-[20px] font-semibold leading-tight tracking-tight text-paper">
                  Lost in the cluster.
                </h1>
                <p className="mt-1 text-[13px] text-paper-muted">
                  The page you're looking for doesn't exist or was moved when
                  the fleet view took over as the home of this app.
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 px-7 py-5">
            <Link
              to="/fleet"
              className={cn(
                "inline-flex h-10 items-center justify-between gap-3 rounded-xs bg-brand px-4 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-50 transition-colors",
                "hover:bg-brand-soft",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink-100",
              )}
            >
              <span className="inline-flex items-center gap-2">
                <Globe2 className="h-3.5 w-3.5" aria-hidden />
                Take me to fleet
              </span>
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className={cn(
                "inline-flex h-10 items-center justify-between gap-3 rounded-xs border border-ink-500 bg-ink-100 px-4 font-mono text-[11px] uppercase tracking-[0.14em] text-paper transition-colors",
                "hover:border-ink-700 hover:bg-ink-200",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-ink-100",
              )}
            >
              <span className="inline-flex items-center gap-2">
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                Go back
              </span>
              <span className="text-paper-dim">history.back</span>
            </button>
          </div>

          {/* Footer hint */}
          <div className="border-t border-ink-500 bg-ink-200/60 px-7 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-dim">
              Hint · press <kbd className="rounded-xs border border-ink-500 bg-ink-100 px-1 text-paper">⌘</kbd>
              {" "}
              <kbd className="rounded-xs border border-ink-500 bg-ink-100 px-1 text-paper">K</kbd>
              {" "}
              anywhere to jump to a page
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
