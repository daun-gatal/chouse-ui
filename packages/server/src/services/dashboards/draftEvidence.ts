/**
 * Draft with AI for dashboards (ADR 0021 §10): what the drafter is shown.
 * Kept apart from the review (draft.ts) so the capability can build its
 * prompt without loading the runner.
 */

import { CHART_TYPES, COLOR_SCHEMES, REDUCERS, UNITS } from "./spec";
import { TEMPLATES } from "./templates";
import type { DraftRequest } from "./draftSchemas";

/** Example panels shown to the drafter: one template, as saved. */
function examples(): unknown[] {
  const template = TEMPLATES.find((t) => t.id === "query-latency");
  return (template?.dashboard.panels ?? []).slice(0, 3).map((p) => ({ title: p.title, sql: p.sql, viz: p.viz, width: p.width, height: p.height }));
}

/** What the drafter is told: the goal, the dashboard it adds to, and the rules a panel must follow. */
export function draftEvidence(request: DraftRequest): Record<string, unknown> {
  return {
    goal: request.goal,
    connectionId: request.connectionId,
    existingDashboard: request.existing,
    rules: {
      sql: "One read-only SELECT per panel, no FORMAT clause and no SETTINGS. Bound every system.*_log read with event_time >= {{from}} AND event_time < {{to}}. Bucket time with toStartOfInterval(event_time, INTERVAL {{interval_s}} SECOND). At most 10,000 result rows: aggregate, and keep top-N with ORDER BY … LIMIT. Leave CHouse's own queries out of system.query_log with JSONExtractString(log_comment, 'source') NOT IN ('observe', 'remediation_preflight', 'dashboards').",
      macros: "{{from}} and {{to}} (DateTime), {{interval_s}} (UInt32 bucket seconds) and {{var.NAME}} for a declared variable. Never put a macro inside quotes.",
      variables: "Optional, at most 10: {name (lowercase, a-z0-9_), label, kind: 'string' | 'identifier', options: {source: 'static', values: [...]} or {source: 'query', sql: one-column SELECT without macros}, default}. An identifier variable holds a database or table name.",
      viz: {
        shape: "{version: 1, type, x, y: [...], series, unit, decimals, thresholds: [{value, severity: 'warning'|'critical'}], colorScheme, reduce}",
        types: CHART_TYPES,
        units: UNITS,
        colorSchemes: COLOR_SCHEMES,
        reducers: REDUCERS,
        notes: "Line/area/bar charts: x plus one or more y; split by series only with exactly one y. pie/donut/treemap/funnel/scatter: x and exactly one y. histogram: x only. stat: no x, one y and a reduce. table: no x, y or series. Thresholds only on line, area, bar and stat. Pick the unit that matches y (ms, bytes, count…). Never plot a running total (system.events, system.errors, kafka_consumers counters) as a line without runningDifference.",
      },
      size: "width 3, 4, 6, 8 or 12 (of 12 columns); height s, m or l.",
      rationale: "One short sentence per panel: what it shows and why it matters for the goal.",
    },
    examplePanels: examples(),
  };
}
