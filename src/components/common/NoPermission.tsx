/**
 * NoPermission — shown when an authenticated user lacks the permission for a
 * page or tab, instead of silently redirecting them away.
 *
 * Renders as a full-page state (route-level denial, via AdminRoute) or inline
 * inside another page (e.g. a denied Monitoring tab) when `inline` is set.
 */

import { ShieldOff, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

interface NoPermissionProps {
  /** Human-readable feature / tab name the user tried to reach. */
  feature?: string;
  /**
   * Exact permission to request (e.g. "Run Chouse AI Doctor Scan"), surfaced so
   * an admin knows precisely what to grant.
   */
  permission?: string;
  /**
   * Rendered inside another page (e.g. a Monitoring tab) rather than as a full
   * route. Drops the heading level to h2 and hides the "Back to home" action.
   */
  inline?: boolean;
}

export default function NoPermission({ feature, permission, inline = false }: NoPermissionProps) {
  const Heading = inline ? "h2" : "h1";
  return (
    <div
      role="status"
      className="flex h-full w-full flex-col items-center justify-center gap-4 bg-ink-50 p-8 text-center"
    >
      <span className="grid h-16 w-16 place-items-center rounded-full border border-ink-500 bg-ink-200 text-paper-dim">
        <ShieldOff className="h-7 w-7" aria-hidden />
      </span>
      <div>
        <Heading className="text-[16px] font-semibold text-paper">
          You don't have permission for this page
        </Heading>
        <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-paper-muted">
          {feature ? (
            <>
              Access to <strong className="text-paper">{feature}</strong> isn't enabled for your role.{" "}
            </>
          ) : (
            <>Your role doesn't include access to this page. </>
          )}
          Ask an administrator to grant{" "}
          {permission ? <strong className="text-paper">{permission}</strong> : "it"}{" "}
          <span className="whitespace-nowrap text-paper-faint">(Admin → Roles)</span>.
        </p>
      </div>
      {!inline && (
        <Link
          to="/"
          className="mt-1 inline-flex items-center gap-1.5 rounded-xs border border-ink-500 bg-ink-100 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-paper transition-colors hover:border-ink-700 hover:bg-ink-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to home
        </Link>
      )}
    </div>
  );
}
