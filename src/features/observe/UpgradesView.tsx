/**
 * Monitoring › Upgrades (ADR 0016 §9): check a target version against the
 * real workload (rules pack matched to query shapes, types, engines and
 * settings), replay read-only shapes on a canary, and follow rollout gates.
 */

import { useEffect, useState, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpCircle, Loader2, PlayCircle } from "lucide-react";

import type { Finding } from "@/api/upgrades";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DH_PRIMARY } from "@/features/data-health/lib";
import { RBAC_PERMISSIONS, useAuthStore, useRbacStore } from "@/stores";
import { upgradeKeys, useAssessment, useMyConnections, useReplay, useRollout, useUpgradeMutations, useUpgrades } from "./hooks";
import { formatAgo, formatCount, humanize, type Tone } from "./lib";
import { DataTable, EmptyState, ErrorState, Kpi, LoadingGrid, Mono, OBS_LABEL, Panel, StatusPill } from "./ui";

const SEVERITY_TONE: Record<Finding["severity"], Tone> = { blocker: "bad", warning: "warn", info: "info" };
const VERDICT: Record<string, { label: string; tone: Tone }> = {
  not_ready: { label: "Not ready", tone: "bad" },
  ready_with_warnings: { label: "Ready with warnings", tone: "warn" },
  ready: { label: "Ready", tone: "ok" },
};

export function UpgradesView({ refreshKey }: { refreshKey?: number }): ReactElement {
  const client = useQueryClient();
  const connectionId = useAuthStore((s) => s.activeConnectionId);
  const canRun = useRbacStore((s) => s.hasPermission(RBAC_PERMISSIONS.UPGRADES_RUN));
  const list = useUpgrades();
  const rollout = useRollout();
  const connections = useMyConnections(canRun);
  const { assess, replay } = useUpgradeMutations();
  const [target, setTarget] = useState("");
  const [selectedAssessment, setSelectedAssessment] = useState<string | null>(null);
  const [selectedReplay, setSelectedReplay] = useState<string | null>(null);
  const [canary, setCanary] = useState("");

  useEffect(() => {
    if (refreshKey) void client.invalidateQueries({ queryKey: upgradeKeys.all });
  }, [refreshKey, client]);

  const assessmentId = selectedAssessment ?? list.data?.assessments[0]?.id ?? null;
  const assessment = useAssessment(assessmentId);
  const replayId = selectedReplay ?? list.data?.replays[0]?.id ?? null;
  const replayDetail = useReplay(replayId);

  if (list.isLoading) return <LoadingGrid />;
  if (list.isError || !list.data) return <ErrorState title="Upgrade checks could not be loaded." error={list.error} />;

  const runAssess = async (): Promise<void> => {
    try {
      const a = await assess.mutateAsync(target.trim());
      setSelectedAssessment(a.id);
      toast.success(`Checked against ${a.targetVersion}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Assessment failed");
    }
  };
  const runReplay = async (): Promise<void> => {
    try {
      const r = await replay.mutateAsync({ canaryConnectionId: canary, assessmentId });
      setSelectedReplay(r.id);
      toast.success("Replay started on the canary");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Replay failed to start");
    }
  };

  const a = assessment.data;
  const counts = { blocker: 0, warning: 0, info: 0 };
  for (const f of a?.findings ?? []) counts[f.severity]++;
  const verdict = a?.verdict ? VERDICT[a.verdict] : undefined;

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4" data-onboarding-id="monitoring-upgrades-assess">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight text-paper">Upgrade against your real workload</h2>
          <p className="mt-1 text-[12px] text-paper-muted">Query shapes from query_log, table engines and types, settings profiles, and replicas already upgraded.</p>
        </div>
        {canRun && (
          <div className="flex items-end gap-2">
            <div>
              <label htmlFor="upgrade-target" className={OBS_LABEL}>Target version</label>
              <Input id="upgrade-target" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="25.3" className="mt-1 h-9 w-28 rounded-xs font-mono" />
            </div>
            <Button className={DH_PRIMARY} disabled={!/^\d+(\.\d+){1,3}$/.test(target.trim()) || assess.isPending} onClick={() => void runAssess()}>
              {assess.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpCircle className="h-3.5 w-3.5" />} Check
            </Button>
          </div>
        )}
      </div>

      {!a ? (
        <Panel title="Readiness"><EmptyState title="No assessment yet" body={canRun ? "Enter a target version to check it against this cluster's workload." : "Ask someone with upgrades:run to check a target version."} /></Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Verdict" value={verdict?.label ?? humanize(a.status)} meta={`${a.currentVersion ?? "?"} → ${a.targetVersion}`} tone={verdict?.tone} />
            <Kpi label="Blockers" value={counts.blocker} tone={counts.blocker > 0 ? "bad" : "ok"} />
            <Kpi label="Warnings" value={counts.warning} tone={counts.warning > 0 ? "warn" : undefined} />
            <Kpi label="Checked" value={formatAgo(a.finishedAt ?? a.createdAt)} meta={list.data.assessments.length > 1 ? `${list.data.assessments.length} assessments` : undefined} />
          </div>
          <Panel
            title="Findings"
            meta="Only items your workload actually hits"
            actions={list.data.assessments.length > 1 ? (
              <Select value={assessmentId ?? ""} onValueChange={setSelectedAssessment}>
                <SelectTrigger className="h-8 w-56 rounded-xs text-[11px]" aria-label="Assessment"><SelectValue /></SelectTrigger>
                <SelectContent>{list.data.assessments.map((x) => <SelectItem key={x.id} value={x.id}>{x.targetVersion} · {new Date(x.createdAt).toLocaleString()}</SelectItem>)}</SelectContent>
              </Select>
            ) : undefined}
          >
            {(a.findings ?? []).length === 0 ? <EmptyState title="Nothing in your workload is affected" /> : (
              <ul className="divide-y divide-ink-500/60">
                {a.findings.map((f) => (
                  <li key={f.id} className="grid gap-1 py-3 md:grid-cols-[120px_1fr_auto] md:items-start md:gap-4">
                    <span className={OBS_LABEL}>{f.category}</span>
                    <div>
                      <p className="text-[13px] text-paper">{f.title}</p>
                      <p className="mt-0.5 text-[12px] text-paper-muted">{f.detail}</p>
                    </div>
                    <StatusPill tone={SEVERITY_TONE[f.severity]}>{f.severity}</StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Workload replay on a canary"
          meta="Top read-only query shapes, compared result and latency"
          actions={canRun ? (
            <div className="flex items-center gap-2">
              <Select value={canary} onValueChange={setCanary}>
                <SelectTrigger className="h-8 w-48 rounded-xs text-[11px]" aria-label="Canary connection"><SelectValue placeholder="Canary connection" /></SelectTrigger>
                <SelectContent>{(connections.data ?? []).filter((c) => c.id !== connectionId).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
              <Button variant="outline" className="h-8 rounded-xs text-[11px]" disabled={!canary || replay.isPending} onClick={() => void runReplay()}><PlayCircle className="mr-1.5 h-3 w-3" /> Replay</Button>
            </div>
          ) : undefined}
        >
          {!replayDetail.data ? <EmptyState title="No replays yet" /> : (
            <>
              <div className="grid grid-cols-4 gap-2">
                {([["Same result", replayDetail.data.same, "ok"], ["Differs", replayDetail.data.differs, "bad"], ["Slower ≥ 1.5×", replayDetail.data.slower, "warn"], ["Errors", replayDetail.data.errors, "bad"]] as const).map(([label, n, tone]) => (
                  <div key={label} className="rounded-xs border border-ink-500 p-2"><p className={OBS_LABEL}>{label}</p><p className={`mt-1 text-[18px] font-semibold tabular-nums ${n > 0 && tone !== "ok" ? (tone === "bad" ? "text-red-500" : "text-amber-500") : "text-paper"}`}>{formatCount(n)}</p></div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-paper-muted">{replayDetail.data.status === "running" ? "Running…" : `${formatCount(replayDetail.data.total)} shapes replayed ${formatAgo(replayDetail.data.finishedAt ?? replayDetail.data.startedAt)}`}</p>
              {replayDetail.data.results.length > 0 && (
                <DataTable label="Replay differences" head={["Shape", "Outcome", "Baseline → canary"]}>
                  {replayDetail.data.results.slice(0, 20).map((r) => (
                    <tr key={r.fingerprint}>
                      <td className="max-w-[260px]"><Mono className="block truncate text-paper">{r.sampleQuery ?? r.fingerprint}</Mono></td>
                      <td><StatusPill tone={r.outcome === "error" || r.outcome === "differs" ? "bad" : "warn"}>{r.outcome}</StatusPill></td>
                      <td className="whitespace-nowrap tabular-nums text-paper-muted">{r.baselineMs ?? "—"} → {r.canaryMs ?? "—"} ms{r.error ? <span className="block text-[10px] text-red-500">{r.error}</span> : null}</td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </>
          )}
        </Panel>

        <Panel title="Rollout tracker" meta="Your tooling upgrades; CHouse checks each step">
          {rollout.isLoading ? <p className="text-[11px] text-paper-muted">Loading…</p> : (rollout.data ?? []).length === 0 ? <EmptyState title="No connections" /> : (
            <DataTable label="Rollout" head={["Connection", "Version", "Replica lag", "Regressions", "Sick replicas"]}>
              {(rollout.data ?? []).map((n) => (
                <tr key={n.connectionId}>
                  <td className="text-paper">{n.name}</td>
                  <td><Mono className="text-paper-muted">{n.version ?? "unknown"}</Mono></td>
                  <td>{n.gates.replicaLagOk === null ? <span className="text-paper-faint">—</span> : <StatusPill tone={n.gates.replicaLagOk ? "ok" : "bad"} dot={false}>{n.gates.replicaLagSeconds ?? 0}s</StatusPill>}</td>
                  <td><StatusPill tone={n.gates.openRegressions > 0 ? "warn" : "ok"} dot={false}>{n.gates.openRegressions}</StatusPill></td>
                  <td className="tabular-nums text-paper-muted">{n.gates.sickReplicas ?? "—"}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </div>
    </div>
  );
}
