/**
 * The version text on a Fleet card (ADR 0029 §7). It stays where it was and
 * as short as it was; it only gains a colour when it needs attention (red out
 * of support, amber when a newer patch is out on its line), a tooltip that
 * says why, and a link to Monitoring › Upgrades for that connection.
 */

import type { ReactElement } from "react";

import type { FleetUpgradeNode } from "@/api/upgrades";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { checkVerdict, versionStatusText, versionTone } from "@/lib/upgrades";
import { cn } from "@/lib/utils";

/** The Upgrades path for a card: the last checked target, or the newer patch, or the tab's own pick. */
export function upgradesPath(node: FleetUpgradeNode | undefined): string {
  const target = node?.lastCheck?.targetVersion ?? (node?.status?.newerPatch ? node.status.latestPatch : null);
  return target ? `/monitoring/upgrades?target=${encodeURIComponent(target)}` : "/monitoring/upgrades";
}

export function FleetVersion({ version, node, onOpen, disabled }: { version: string; node: FleetUpgradeNode | undefined; onOpen: (path: string) => void; disabled?: boolean }): ReactElement {
  if (!node) return <span className="shrink-0">{version}</span>;
  const status = node.status;
  const tone = versionTone(status);
  const verdict = node.lastCheck ? checkVerdict({ mode: node.lastCheck.mode === "exact" ? "exact" : "notes", counts: node.lastCheck.counts ?? undefined }) : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onOpen(upgradesPath(node))}
          aria-label={`${version}${status ? `: ${versionStatusText(status)}` : ""}. Open Upgrades`}
          className={cn(
            "shrink-0 rounded-xs font-mono uppercase tracking-[0.16em] underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed",
            tone === "bad" && "border border-red-500/50 px-1 text-red-500 dark:text-red-400",
            tone === "warn" && "text-amber-600 dark:text-amber-400",
          )}
        >
          {version}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-xs font-sans text-[11px] normal-case leading-relaxed tracking-normal">
        <p className="font-medium">{status ? versionStatusText(status) : "Support status unavailable"}</p>
        {node.lastCheck && verdict && (
          <p className="mt-0.5 text-paper-muted">
            Last check, {node.lastCheck.targetVersion}: {verdict.breaks} break{verdict.breaks === 1 ? "" : "s"}, {verdict.changes} change{verdict.changes === 1 ? "" : "s"}
            {verdict.toJudge > 0 ? `, ${verdict.toJudge} notes to judge` : ""}
          </p>
        )}
        <p className="mt-0.5 text-brand">Click to open Upgrades</p>
      </TooltipContent>
    </Tooltip>
  );
}
