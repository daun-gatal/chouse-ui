/**
 * Fleet alerts — v1, client-side.
 *
 * Watches the fleet snapshots the page already polls and fires when a rule
 * crosses its threshold. Three rules:
 *   - node memory %        (aggregate server memory)
 *   - high-memory query    (a single query using > N GB)
 *   - long-running query   (a single query running > N minutes)
 *
 * Edge-triggered per (node, rule): one notification when it *enters* breach,
 * re-armed when it clears (memory % uses a hysteresis margin so it doesn't flap
 * at the boundary). Delivery is a desktop Web Notification (when permitted) plus
 * an in-app toast + feed.
 *
 * Config lives in localStorage. The rule set is easy to extend (add a branch in
 * evaluateNode + a settings row) and the whole thing can later move to a backend
 * evaluator + webhooks without changing the UI contract.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fireAlertToast } from "@/features/fleet/components/fleetAlertToast";

import {
  summaryFromSnapshot,
  longestQueryFromSnapshot,
  topMemoryQueriesFromSnapshot,
  type FleetLongestQuery,
} from "./useFleetMetrics";
import type { FleetConnectionSnapshot } from "@/api";

export interface AlertConfig {
  /** Master switch — off silences every rule. */
  enabled: boolean;
  /** App-level desktop-notification switch — lets the operator mute OS banners
   *  without revoking the browser permission (which JS can't undo anyway). */
  desktopEnabled: boolean;
  memoryEnabled: boolean;
  /** Node memory % above this fires. */
  memoryThresholdPercent: number;
  queryMemoryEnabled: boolean;
  /** A single query using more than this many GB fires. */
  queryMemoryThresholdGb: number;
  longQueryEnabled: boolean;
  /** A single query running longer than this many minutes fires. */
  longQueryThresholdMinutes: number;
}

const DEFAULT_CONFIG: AlertConfig = {
  enabled: true,
  desktopEnabled: true,
  memoryEnabled: true,
  memoryThresholdPercent: 85,
  queryMemoryEnabled: false,
  queryMemoryThresholdGb: 10,
  longQueryEnabled: false,
  longQueryThresholdMinutes: 5,
};

const STORAGE_KEY = "chouse-fleet:alert-config";
/** Re-arm the memory rule only once it drops this far below threshold. */
const HYSTERESIS = 5;
const MAX_FEED = 50;

export interface AlertEvent {
  id: string;
  connectionId: string;
  connectionName: string;
  /** Human metric label, e.g. "memory", "query memory", "long query". */
  metric: string;
  /** Self-describing one-liner, e.g. "34% memory" / "14.2 GB query". */
  summary: string;
  /** Optional extra context (the offending query / user). */
  detail?: string;
  /** Per-instance discriminator (query_id) — unique desktop tag per query. */
  instanceId?: string;
  at: number; // unix ms
}

export interface ActiveBreach {
  key: string; // `${connectionId}:${ruleKey}`
  connectionId: string;
  connectionName: string;
  metric: string;
  summary: string;
}

interface RuleEval {
  ruleKey: string;
  /** Per-instance discriminator (query_id) for query rules — lets each query
   *  over the threshold latch + fire independently. Absent for node rules. */
  instanceId?: string;
  metric: string;
  summary: string;
  detail?: string;
  /** Offending query's user (query rules only) — shown in the toast. */
  user?: string;
  breaching: boolean;
  /** True once the rule has clearly recovered (re-arm point). */
  clearing: boolean;
}

function loadConfig(): AlertConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_CONFIG;
}

function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return "<1s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function queryDetail(q: FleetLongestQuery): string {
  // Strip the leading comment block Redash/BI tools prepend
  // (/* Username:…, query_id:…, Queue:… */) plus line comments, so we surface
  // real SQL instead of metadata noise.
  const sql = q.queryPreview
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const snippet = sql.slice(0, 64);
  if (q.user && snippet) return `${q.user} · ${snippet}`;
  return q.user || snippet;
}

/**
 * Stable identity for a (node, rule[, query]) breach. Query rules append the
 * query_id so each greedy query latches + lists independently; node rules omit
 * it. The 3-vs-2 segment count also lets the effect spot stale query latches.
 */
function breachKey(
  connectionId: string,
  r: { ruleKey: string; instanceId?: string },
): string {
  return r.instanceId
    ? `${connectionId}:${r.ruleKey}:${r.instanceId}`
    : `${connectionId}:${r.ruleKey}`;
}

/**
 * Evaluate every enabled rule for one node. Returns the per-rule state used by
 * BOTH the live breach list (breaching) and the edge-trigger (breaching +
 * clearing). Pure — no firing here.
 */
function evaluateNode(
  snap: FleetConnectionSnapshot | undefined,
  config: AlertConfig,
): RuleEval[] {
  const out: RuleEval[] = [];

  if (config.memoryEnabled) {
    const mem = summaryFromSnapshot(snap)?.memoryPercent;
    if (mem != null) {
      out.push({
        ruleKey: "memory",
        metric: "memory",
        summary: `${mem.toFixed(0)}% memory`,
        breaching: mem > config.memoryThresholdPercent,
        clearing: mem < config.memoryThresholdPercent - HYSTERESIS,
      });
    }
  }

  if (config.queryMemoryEnabled) {
    // One breach per query over the threshold (not just the greediest). Only
    // breaching queries are emitted; a query that drops below / finishes simply
    // stops appearing, which the effect treats as cleared.
    for (const q of topMemoryQueriesFromSnapshot(snap)) {
      const gb = q.memoryUsage / 1e9;
      if (gb > config.queryMemoryThresholdGb) {
        out.push({
          ruleKey: "querymem",
          instanceId: q.queryId,
          metric: "query memory",
          summary: `${gb.toFixed(1)} GB query`,
          detail: queryDetail(q),
          user: q.user || undefined,
          breaching: true,
          clearing: false,
        });
      }
    }
  }

  if (config.longQueryEnabled) {
    const q = longestQueryFromSnapshot(snap);
    if (q) {
      const over = q.elapsedSeconds / 60 > config.longQueryThresholdMinutes;
      out.push({
        ruleKey: "longquery",
        metric: "long query",
        summary: `query running ${fmtDuration(q.elapsedSeconds)}`,
        detail: queryDetail(q),
        user: q.user || undefined,
        breaching: over,
        clearing: !over,
      });
    }
  }

  return out;
}

function fireDesktop(ev: AlertEvent) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    // `renotify` isn't in the DOM lib's NotificationOptions but is a valid,
    // widely-supported field. Collapse repeats for the same node + metric into
    // one OS notification, but renotify so a fresh breach still alerts instead
    // of silently updating the existing banner.
    const options: NotificationOptions & { renotify?: boolean } = {
      body: ev.detail ? `${ev.summary}\n${ev.detail}` : ev.summary,
      icon: "/logo.png",
      tag: `chouse-fleet-${ev.metric}-${ev.connectionId}`,
      renotify: true,
      // Alerts shouldn't auto-dismiss in a few seconds — keep the banner up
      // until the operator acknowledges it.
      requireInteraction: true,
    };
    new Notification(`${ev.connectionName} — ${ev.metric} alert`, options);
  } catch {
    /* notifications can throw in some embedded contexts — ignore */
  }
}

export interface UseFleetAlerts {
  config: AlertConfig;
  setConfig: (next: Partial<AlertConfig>) => void;
  activeBreaches: ActiveBreach[];
  fires: AlertEvent[];
  clearFires: () => void;
  permission: NotificationPermission;
  requestPermission: () => void;
  notificationsSupported: boolean;
}

export function useFleetAlerts(
  connections: { id: string; name: string }[],
  snapshotsByConnection: Map<string, FleetConnectionSnapshot | undefined>,
  /** Open a node's live queries — wired to the toast's clickable row. */
  onInvestigate?: (connectionId: string) => void,
): UseFleetAlerts {
  const notificationsSupported = typeof Notification !== "undefined";
  const [config, setConfigState] = useState<AlertConfig>(loadConfig);
  const [fires, setFires] = useState<AlertEvent[]>([]);
  const [permission, setPermission] = useState<NotificationPermission>(
    notificationsSupported ? Notification.permission : "denied"
  );
  // Per-(node, rule) breach latch — fire only on the healthy → breach edge.
  const armed = useRef<Map<string, boolean>>(new Map());

  const setConfig = useCallback((next: Partial<AlertConfig>) => {
    setConfigState((cur) => {
      const merged = { ...cur, ...next };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch {
        /* ignore */
      }
      return merged;
    });
  }, []);

  const requestPermission = useCallback(() => {
    if (!notificationsSupported) return;
    void Notification.requestPermission().then(setPermission);
  }, [notificationsSupported]);

  // Currently-breaching (node, rule) pairs — derived fresh for the badge/list.
  const activeBreaches = useMemo<ActiveBreach[]>(() => {
    if (!config.enabled) return [];
    const out: ActiveBreach[] = [];
    for (const c of connections) {
      for (const r of evaluateNode(snapshotsByConnection.get(c.id), config)) {
        if (r.breaching) {
          out.push({
            key: breachKey(c.id, r),
            connectionId: c.id,
            connectionName: c.name,
            metric: r.metric,
            summary: r.summary,
          });
        }
      }
    }
    return out;
  }, [connections, snapshotsByConnection, config]);

  // Edge-triggered evaluation on every snapshot change.
  useEffect(() => {
    if (!config.enabled) return;
    // Query-rule keys seen this tick — used to re-arm latches for queries that
    // have finished or dropped below threshold (they stop being emitted).
    const seenQueryKeys = new Set<string>();
    for (const c of connections) {
      for (const r of evaluateNode(snapshotsByConnection.get(c.id), config)) {
        const key = breachKey(c.id, r);
        if (r.instanceId) seenQueryKeys.add(key);
        const wasArmed = armed.current.get(key) ?? false;
        if (r.breaching && !wasArmed) {
          armed.current.set(key, true);
          const ev: AlertEvent = {
            id: `${key}-${Date.now()}`,
            connectionId: c.id,
            connectionName: c.name,
            metric: r.metric,
            summary: r.summary,
            detail: r.detail,
            instanceId: r.instanceId,
            at: Date.now(),
          };
          setFires((prev) => [ev, ...prev].slice(0, MAX_FEED));
          if (config.desktopEnabled) fireDesktop(ev);
          // In-app alert toast — the red twin of the success toast.
          fireAlertToast({
            node: c.name,
            summary: r.summary,
            user: r.user,
            onInvestigate: onInvestigate ? () => onInvestigate(c.id) : undefined,
            dedupeId: `fleet-alert:${key}`,
          });
        } else if (r.clearing && wasArmed) {
          armed.current.set(key, false);
        }
      }
    }
    // Re-arm (drop) query-rule latches whose query is gone — a 3-segment key
    // that's still armed but wasn't emitted this tick. Node-rule latches
    // (2-segment) keep using the hysteresis `clearing` branch above.
    for (const k of [...armed.current.keys()]) {
      if (k.split(":").length === 3 && armed.current.get(k) && !seenQueryKeys.has(k)) {
        armed.current.delete(k);
      }
    }
  }, [snapshotsByConnection, config, connections, onInvestigate]);

  const clearFires = useCallback(() => setFires([]), []);

  return {
    config,
    setConfig,
    activeBreaches,
    fires,
    clearFires,
    permission,
    requestPermission,
    notificationsSupported,
  };
}
