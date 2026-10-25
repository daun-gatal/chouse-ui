/**
 * Overview (ADR 0026 §7): is alerting healthy? What fires, what was sent and
 * failed in the last day, what waits on a person, which channels are failing,
 * and what sends alerts — each tile opens the filtered view behind it.
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { AlertTriangle, Loader2 } from "lucide-react";

import { getAlertingOverview, listChannels, usageTotal, USAGE_LABELS, type ChannelUsage } from "@/api/alerting";
import { ALERTING_KEYS } from "@/features/alerting/ChannelDialog";
import { cn } from "@/lib/utils";
import { errMessage, META, Panel } from "./shared";

const TILE = "rounded-xs border border-ink-500 bg-ink-200 px-3 py-2.5 text-left hover:border-ink-400";

export function OverviewTab(): React.ReactElement {
  const [, setParams] = useSearchParams();
  const overview = useQuery({ queryKey: ALERTING_KEYS.overview, queryFn: getAlertingOverview, refetchInterval: 60_000 });
  const channels = useQuery({ queryKey: ALERTING_KEYS.channels, queryFn: listChannels });

  const go = (view: string, filters: Record<string, string> = {}): void => {
    setParams(new URLSearchParams({ view, ...filters }));
  };

  if (overview.isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-paper-dim" /></div>;
  if (overview.isError || !overview.data) return <p role="alert" className="text-[12px] text-red-300">{errMessage(overview.error)}</p>;
  const o = overview.data;
  const firing = o.firing.fleet + o.firing.dashboards + o.firing.dataHealth;

  // What sends alerts, summed over every channel.
  const totals: ChannelUsage = { fleetRules: 0, dashboardAlerts: 0, dashboardReports: 0, scheduledQueries: 0, dataHealth: 0, triage: 0, chobi: 0, remediation: 0 };
  for (const ch of channels.data ?? []) {
    if (!ch.usedBy) continue;
    for (const key of Object.keys(totals) as Array<keyof ChannelUsage>) totals[key] += ch.usedBy[key];
  }
  const unused = (channels.data ?? []).filter((ch) => usageTotal(ch.usedBy) === 0).length;
  const sendKind: Record<keyof ChannelUsage, string> = { fleetRules: "fleet", dashboardAlerts: "dashboard", dashboardReports: "", scheduledQueries: "scheduled", dataHealth: "dataHealth", triage: "triage", chobi: "", remediation: "remediation" };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Firing now" value={firing} tone={firing > 0 ? "bad" : "ok"} detail={`${o.firing.fleet} fleet · ${o.firing.dashboards} dashboard · ${o.firing.dataHealth} Data Health`} onClick={() => go("rules", { state: "firing" })} />
        <Stat label="Sent, last 24h" value={o.sent24h} onClick={() => go("activity", { range: "24h" })} />
        <Stat label="Failed sends, 24h" value={o.failed24h} tone={o.failed24h > 0 ? "warn" : "ok"} onClick={() => go("activity", { range: "24h", result: "failed" })} />
        <Stat label="Waiting on someone" value={o.waiting} detail="AI requests to approve" link="/ai/approvals" />
      </div>

      {o.failing.map((f) => (
        <div key={f.id} role="alert" className="flex items-start gap-2 rounded-xs border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="flex-1">{f.name} failed {f.failed24h} time{f.failed24h === 1 ? "" : "s"} in the last day{f.lastError ? `: ${f.lastError}` : ""}.</span>
          <button type="button" className="underline" onClick={() => go("channels", { health: "failing" })}>Fix channel</button>
        </div>
      ))}

      <Panel title="What sends alerts">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(USAGE_LABELS) as Array<keyof ChannelUsage>).map((key) => (
            <button key={key} type="button" className={TILE} onClick={() => (sendKind[key] ? go("rules", { kind: sendKind[key] }) : go("channels"))}>
              <span className="block text-[13px] text-paper">{USAGE_LABELS[key]}</span>
              <span className={META}>{totals[key]} link{totals[key] === 1 ? "" : "s"} to channels</span>
            </button>
          ))}
        </div>
        {unused > 0 && (
          <p className="mt-3 text-[12px] text-paper-faint">
            {unused} channel{unused === 1 ? "" : "s"} {unused === 1 ? "is" : "are"} not used by anything.{" "}
            <button type="button" className="underline" onClick={() => go("channels", { used: "unused" })}>Show</button>
          </p>
        )}
      </Panel>
    </div>
  );
}

function Stat({ label, value, detail, tone = "ok", onClick, link }: { label: string; value: number; detail?: string; tone?: "ok" | "warn" | "bad"; onClick?: () => void; link?: string }): React.ReactElement {
  const body = (
    <>
      <span className={META}>{label}</span>
      <span className={cn("block text-[22px] font-semibold tracking-tight", tone === "bad" ? "text-red-400" : tone === "warn" ? "text-amber-400" : "text-paper")}>{value}</span>
      {detail && <span className="block text-[11px] text-paper-faint">{detail}</span>}
    </>
  );
  if (link) return <Link to={link} className={TILE}>{body}</Link>;
  return <button type="button" className={TILE} onClick={onClick}>{body}</button>;
}
