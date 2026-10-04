/**
 * Agent budget preflight (ADR 0016 §10). Pure decision logic: the caller runs
 * `EXPLAIN ESTIMATE`, looks up the policy, today's spend and table health, and
 * this decides allow / warn / block with human-readable reasons.
 */

export type IncidentMode = "off" | "warn" | "block";

export interface AgentPolicy {
  maxBytesPerQuery: number | null;
  dailyBytes: number | null;
  /** Tables at least this large must be read with a partition / key filter. */
  partitionFilterBytes: number | null;
  incidentMode: IncidentMode;
}

export const DEFAULT_AGENT_POLICY: AgentPolicy = {
  maxBytesPerQuery: null,
  dailyBytes: null,
  partitionFilterBytes: null,
  incidentMode: "warn",
};

export interface TableEstimate {
  table: string; // db.table
  estimatedBytes: number;
  /** Fraction of the table's marks the query would read (0..1). */
  markRatio: number;
  totalBytes: number;
}

export interface TableHealth {
  table: string;
  state: "trusted" | "degraded" | "stale" | "learning";
  reason: string | null;
  openIncident: { id: string; severity: "warning" | "critical"; summary: string } | null;
}

export interface BudgetInput {
  policy: AgentPolicy;
  estimates: TableEstimate[];
  usedTodayBytes: number;
  health: TableHealth[];
  paused: boolean;
}

export interface HealthNotice {
  table: string;
  state: TableHealth["state"];
  message: string;
  incidentId: string | null;
}

export interface BudgetDecision {
  decision: "allow" | "warn" | "block";
  estimatedBytes: number;
  reasons: string[];
  notices: HealthNotice[];
}

/** Reading (almost) every mark of a large table means no partition / key filter. */
const FULL_SCAN_MARK_RATIO = 0.9;

export function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function healthNotices(health: TableHealth[]): HealthNotice[] {
  const notices: HealthNotice[] = [];
  for (const h of health) {
    if (h.openIncident) {
      notices.push({ table: h.table, state: h.state, incidentId: h.openIncident.id, message: `${h.table} has an open ${h.openIncident.severity} incident: ${h.openIncident.summary}. Results may be incomplete; say so in the answer.` });
    } else if (h.state === "stale" || h.state === "degraded") {
      notices.push({ table: h.table, state: h.state, incidentId: null, message: `${h.table} is ${h.state}${h.reason ? ` (${h.reason})` : ""}. Results may be incomplete; say so in the answer.` });
    }
  }
  return notices;
}

export function decideBudget(input: BudgetInput): BudgetDecision {
  const { policy } = input;
  const estimatedBytes = input.estimates.reduce((sum, e) => sum + e.estimatedBytes, 0);
  const notices = healthNotices(input.health);
  if (input.paused) {
    return { decision: "block", estimatedBytes, reasons: ["Agent access is paused by an administrator"], notices };
  }
  const blocks: string[] = [];
  const warnings: string[] = [];
  if (policy.maxBytesPerQuery !== null && estimatedBytes > policy.maxBytesPerQuery) {
    blocks.push(`Estimated read ${formatBytes(estimatedBytes)} exceeds the per-query limit of ${formatBytes(policy.maxBytesPerQuery)}`);
  }
  if (policy.dailyBytes !== null && input.usedTodayBytes + estimatedBytes > policy.dailyBytes) {
    blocks.push(`Daily budget ${formatBytes(policy.dailyBytes)} would be exceeded (${formatBytes(input.usedTodayBytes)} used today)`);
  }
  if (policy.partitionFilterBytes !== null) {
    for (const e of input.estimates) {
      if (e.totalBytes >= policy.partitionFilterBytes && e.markRatio >= FULL_SCAN_MARK_RATIO) {
        blocks.push(`${e.table} (${formatBytes(e.totalBytes)}) must be read with a partition or primary-key filter`);
      }
    }
  }
  if (policy.incidentMode !== "off") {
    for (const h of input.health) {
      if (h.openIncident?.severity !== "critical") continue;
      const message = `${h.table} has an open critical incident`;
      if (policy.incidentMode === "block") blocks.push(message);
      else warnings.push(message);
    }
  }
  if (blocks.length > 0) return { decision: "block", estimatedBytes, reasons: [...blocks, ...warnings], notices };
  if (warnings.length > 0 || notices.length > 0) return { decision: "warn", estimatedBytes, reasons: warnings, notices };
  return { decision: "allow", estimatedBytes, reasons: [], notices };
}
