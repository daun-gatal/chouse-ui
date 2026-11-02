/**
 * Workload replay on a canary (ADR 0016 §9, unchanged by ADR 0029): the top
 * read-only query shapes of the active connection run on another connection
 * and are compared for result and latency.
 */

import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import { PlayCircle } from "lucide-react";

import type { ReplayOutcome } from "@/api/upgrades";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuthStore } from "@/stores";
import { useMyConnections, useReplay, useUpgradeMutations } from "./hooks";
import { formatAgo, formatCount, TONE_TEXT, type Tone } from "./lib";
import { DataTable, EmptyState, Mono, OBS_LABEL, Panel, StatusPill } from "./ui";

const REPLAY_OUTCOME: Record<ReplayOutcome, { label: string; tone: Tone }> = {
  same: { label: "same", tone: "ok" },
  differs: { label: "differs", tone: "bad" },
  error: { label: "error", tone: "bad" },
  missing: { label: "missing on canary", tone: "warn" },
  slower: { label: "slower", tone: "warn" },
  skipped: { label: "skipped", tone: "muted" },
};

export function UpgradeReplayPanel({ canRun, latestReplayId, assessmentId }: { canRun: boolean; latestReplayId: string | null; assessmentId: string | null }): ReactElement {
  const connectionId = useAuthStore((s) => s.activeConnectionId);
  const connections = useMyConnections(canRun);
  const { replay } = useUpgradeMutations();
  const [canary, setCanary] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useReplay(selected ?? latestReplayId);
  const r = detail.data;

  const run = async (): Promise<void> => {
    try {
      const started = await replay.mutateAsync({ canaryConnectionId: canary, assessmentId });
      setSelected(started.id);
      toast.success("Replay started on the canary");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Replay failed to start");
    }
  };

  return (
    <Panel
      title="Workload replay on a canary"
      meta="Top read-only shapes of this connection, replayed on another one and compared for result and latency"
      actions={canRun ? (
        <div className="flex items-center gap-2">
          <Select value={canary} onValueChange={setCanary}>
            <SelectTrigger className="h-8 w-48 rounded-xs text-[11px]" aria-label="Canary connection"><SelectValue placeholder="Canary connection" /></SelectTrigger>
            <SelectContent>{(connections.data ?? []).filter((c) => c.id !== connectionId).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" className="h-8 rounded-xs text-[11px]" disabled={!canary || replay.isPending} onClick={() => void run()}><PlayCircle className="mr-1.5 h-3 w-3" /> Replay</Button>
        </div>
      ) : undefined}
    >
      {!r ? <EmptyState title="No replays yet" /> : (
        <>
          <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
            {([["Same result", r.same, "ok"], ["Differs", r.differs, "bad"], ["Slower ≥ 1.5×", r.slower, "warn"], ["Missing on canary", r.missing, "warn"], ["Errors", r.errors, "bad"]] as const).map(([label, n, tone]) => (
              <div key={label} className="rounded-xs border border-ink-500 p-2"><p className={OBS_LABEL}>{label}</p><p className={`mt-1 text-[18px] font-semibold tabular-nums ${n > 0 && tone !== "ok" ? (tone === "bad" ? "text-red-500" : "text-amber-500") : "text-paper"}`}>{formatCount(n)}</p></div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-paper-muted">{r.status === "running" ? "Running…" : `${formatCount(r.total)} shapes replayed ${formatAgo(r.finishedAt ?? r.startedAt)}${r.skipped > 0 ? ` · ${formatCount(r.skipped)} skipped (they fail on the baseline too)` : ""}`}</p>
          {r.results.length > 0 && (
            <DataTable label="Replay differences" head={["Shape", "Outcome", "Baseline → canary"]}>
              {r.results.slice(0, 20).map((x) => (
                <tr key={x.fingerprint}>
                  <td className="max-w-[260px]"><Mono className="block truncate text-paper">{x.sampleQuery ?? x.fingerprint}</Mono></td>
                  <td><StatusPill tone={REPLAY_OUTCOME[x.outcome].tone}>{REPLAY_OUTCOME[x.outcome].label}</StatusPill></td>
                  <td className="whitespace-nowrap tabular-nums text-paper-muted">{x.baselineMs ?? "—"} → {x.canaryMs ?? "—"} ms{x.error ? <span className={`block text-[10px] ${TONE_TEXT[REPLAY_OUTCOME[x.outcome].tone]}`}>{x.error}</span> : null}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </>
      )}
    </Panel>
  );
}
