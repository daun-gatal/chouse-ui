/**
 * Data › Coverage: every table is watched from day one by its learned
 * baseline; promises add intent on top. Suggestions turn into pre-filled
 * promise drafts; cold tables show what is ingested but never read.
 */

import { useState, type ReactElement } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ShieldCheck, Snowflake, X } from "lucide-react";

import type { Suggestion } from "@/api/observe";
import { Button } from "@/components/ui/button";
import { PromiseWizard, type PromiseWizardDraft } from "@/features/data-health";
import { RBAC_PERMISSIONS, useRbacStore } from "@/stores";
import { useCoverage, useDismissSuggestion } from "./hooks";
import { formatAgo, formatBytes, formatPercent, humanize } from "./lib";
import { dataPaths } from "./paths";
import { DataTable, EmptyState, ErrorState, Kpi, LoadingGrid, Mono, Panel, RatioBar, StatusPill } from "./ui";

/** A suggestion's server draft in the wizard's draft shape. */
export function suggestionDraft(s: Suggestion): PromiseWizardDraft {
  return {
    databaseName: s.database,
    tableName: s.table,
    name: s.draft.name,
    criticality: s.draft.criticality,
    frequency: s.draft.frequency,
    eventTimeColumn: s.draft.source.eventTimeColumn,
    checks: s.draft.checks,
  };
}

export function CoverageTab(): ReactElement {
  const navigate = useNavigate();
  const { hasPermission } = useRbacStore();
  const canAccept = hasPermission(RBAC_PERMISSIONS.DATA_HEALTH_EDIT);
  const canDismiss = hasPermission(RBAC_PERMISSIONS.OBSERVE_EDIT);
  const { data, isLoading, isError, error } = useCoverage();
  const dismiss = useDismissSuggestion();
  const [draft, setDraft] = useState<PromiseWizardDraft>();

  if (isLoading) return <LoadingGrid count={5} className="lg:grid-cols-5" />;
  if (isError || !data) return <ErrorState title="Coverage could not be loaded." error={error} />;

  const critical = data.byCriticality.find((c) => c.criticality === "critical");
  const coldBytes = data.cold.reduce((s, c) => s + c.totalBytes, 0);

  return (
    <div className="space-y-4" data-onboarding-id="data-coverage">
      <div>
        <h2 className="text-[18px] font-semibold tracking-tight text-paper">Every table watched from day one</h2>
        <p className="mt-1 text-[12px] text-paper-muted">Baselines are learned from system.parts and query_log metadata, so no table is scanned. Promises are where you add intent on top.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Learned baselines" value={`${data.learned} / ${data.tables}`} meta="Freshness and volume, automatic" />
        <Kpi label="Promises" value={data.promised} meta="Checks you defined or accepted" />
        <Kpi label="Critical coverage" value={critical && critical.tables > 0 ? formatPercent(critical.promised / critical.tables) : "—"} meta={critical ? `${critical.promised} of ${critical.tables} critical tables` : undefined} />
        <Kpi label="Read but unprotected" value={data.unprotectedHot} meta="Read ≥ 100× a week, no promise" tone={data.unprotectedHot > 0 ? "warn" : undefined} />
        <Kpi label="Never read · 7d" value={formatBytes(coldBytes)} meta={`${data.cold.length} tables`} />
      </div>

      <Panel title="Coverage by criticality" meta="Criticality comes from real read volume unless pinned">
        <div className="space-y-3">
          {data.byCriticality.map((c) => (
            <div key={c.criticality} className="grid grid-cols-[130px_1fr_110px] items-center gap-3">
              <span className="text-[12px] text-paper">{humanize(c.criticality)} <span className="text-paper-muted">· {c.tables}</span></span>
              <RatioBar ratio={c.tables ? c.promised / c.tables : 0} label={`${c.criticality} tables with a promise`} />
              <span className="text-right font-mono text-[11px] text-paper-muted">{c.promised} promised</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Suggested promises" meta="Ranked by readers × risk">
        {data.suggestions.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No suggestions" body="Every read-heavy table already has a promise, or the baselines are still learning." />
        ) : (
          <DataTable label="Suggested promises" head={["Table", "Why", "Suggested check", "Learned from", ""]}>
            {data.suggestions.map((s) => (
              <tr key={s.key}>
                <td><button type="button" className="text-left font-mono text-[11px] text-paper hover:text-brand" onClick={() => navigate(dataPaths.dataset(s.database, s.table))}>{s.database}.{s.table}</button></td>
                <td className="text-paper-muted">{s.why}</td>
                <td><Mono className="text-paper">{s.check}</Mono></td>
                <td className="text-paper-muted">{s.learnedFrom}</td>
                <td>
                  <div className="flex justify-end gap-1">
                    {canAccept && <Button variant="outline" className="h-7 rounded-xs text-[11px]" onClick={() => setDraft(suggestionDraft(s))}>Accept</Button>}
                    {canDismiss && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Dismiss suggestion for ${s.database}.${s.table}`} disabled={dismiss.isPending} onClick={() => void dismiss.mutateAsync(s.key).then(() => toast.success("Suggestion dismissed"), (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not dismiss"))}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
        {!canAccept && data.suggestions.length > 0 && <p className="mt-2 text-[10px] text-paper-faint">Accepting a suggestion needs data_health:edit.</p>}
      </Panel>

      <Panel title="Cold data · ingested but never read" meta="Reads from query_log vs. writes from part_log">
        {data.cold.length === 0 ? (
          <EmptyState icon={Snowflake} title="Every table with data was read this week" />
        ) : (
          <DataTable label="Cold tables" head={["Table", "Size", "Last write", ""]}>
            {data.cold.map((c) => (
              <tr key={`${c.database}.${c.table}`}>
                <td><Mono className="text-paper">{c.database}.{c.table}</Mono></td>
                <td className="tabular-nums text-paper-muted">{formatBytes(c.totalBytes)}</td>
                <td className="text-paper-muted">{c.lastWriteAt ? <>{formatAgo(c.lastWriteAt)} {Date.now() - c.lastWriteAt < 86_400_000 && <StatusPill tone="warn" dot={false} className="ml-1">still ingesting</StatusPill>}</> : "—"}</td>
                <td className="text-right"><Button variant="ghost" className="h-7 rounded-xs text-[11px]" onClick={() => navigate(dataPaths.lineage(`table:${c.database}.${c.table}`))}>Who writes it</Button></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      <PromiseWizard open={Boolean(draft)} onOpenChange={(open) => !open && setDraft(undefined)} initialDraft={draft} />
    </div>
  );
}
