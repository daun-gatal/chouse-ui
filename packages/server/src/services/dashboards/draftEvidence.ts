/**
 * Draft with AI for dashboards (ADR 0021 §10, ADR 0023 §4): what the drafter is
 * shown. Kept apart from the review (draft.ts) so the capability can build its
 * prompt without loading the runner.
 */

import { ROLE_CHARTS, roleOf } from "./layout";
import { CHART_TYPES, COLOR_SCHEMES, REDUCERS, UNITS } from "./spec";
import { TEMPLATES } from "./templates";
import type { DraftRequest } from "./draftSchemas";

/** Example panels shown to the drafter: one template's charts, as the model writes them. */
function examples(): unknown[] {
  const template = TEMPLATES.find((t) => t.id === "query-latency");
  return (template?.dashboard.panels ?? [])
    .flatMap((p) => (p.kind === "chart" ? [p] : []))
    .slice(0, 3)
    .map((p, i) => ({
      title: p.title,
      sql: p.sql,
      viz: p.viz,
      role: roleOf(p.viz.type),
      importance: i === 0 ? "primary" : "secondary",
      section: null,
    }));
}

/**
 * What the drafter is told: the goal, the dashboard it adds to, the draft to
 * revise when the user refines one, and the rules a panel must follow.
 */
export function draftEvidence(request: DraftRequest): Record<string, unknown> {
  return {
    goal: request.goal,
    connectionId: request.connectionId,
    existingDashboard: request.existing,
    // Only present on Refine and Regenerate, so a first draft's evidence is unchanged.
    ...(request.revision ? { revision: request.revision } : {}),
    rules: {
      sql: "One read-only SELECT per panel, no FORMAT clause and no SETTINGS. Bound every system.*_log read with event_time >= {{from}} AND event_time < {{to}}. Bucket time with toStartOfInterval(event_time, INTERVAL {{interval_s}} SECOND). At most 10,000 result rows: aggregate, and keep top-N with ORDER BY … LIMIT. Leave CHouse's own queries out of system.query_log with JSONExtractString(log_comment, 'source') NOT IN ('observe', 'remediation_preflight', 'dashboards').",
      macros: "{{from}} and {{to}} (DateTime), {{interval_s}} (UInt32 bucket seconds) and {{var.NAME}} for a declared variable. Never put a macro inside quotes. A multi variable is a list: use it as col IN {{var.NAME}}.",
      variables: "Optional, at most 10: {name (lowercase, a-z0-9_), label, kind: 'string' | 'identifier' | 'multi', options: {source: 'static', values: [...]} or {source: 'query', sql: one-column SELECT without macros}, default}. An identifier variable holds a database or table name. A multi variable's default is a list of 1 to 100 values; the others' is one string.",
      viz: {
        shape: "{version: 2, type, x, y: [...], series, unit, decimals, thresholds: [{value, severity: 'warning'|'critical'}], colorScheme, reduce, links: [], baseline: null}",
        types: CHART_TYPES,
        units: UNITS,
        colorSchemes: COLOR_SCHEMES,
        reducers: REDUCERS,
        notes: "Always set links to [] and baseline to null. Line/area/bar charts: x plus one or more y; split by series only with exactly one y. pie/donut/treemap/funnel/scatter: x and exactly one y, and at most 8 rows. histogram: x only. stat: no x, one y and a reduce. table: no x, y or series. Thresholds only on line, area, bar and stat. Pick the unit that matches y (ms, bytes, count…). Latency is p50/p95/p99 quantiles over raw durations, never an average of quantiles. Never plot a running total (system.events, system.errors, kafka_consumers counters) as a line without runningDifference. A line or area chart's x must be a Date or DateTime column.",
      },
      role: {
        meaning: "What question the panel answers. CHouse places panels by role; never give sizes or positions.",
        kpi: "What is it right now? One number.",
        trend: "How is it changing over time?",
        breakdown: "What contributes to the whole?",
        ranking: "The top N offenders.",
        distribution: "How are values spread?",
        detail: "The rows themselves, for the on-call.",
        charts: ROLE_CHARTS,
      },
      importance: "primary or secondary. Mark the one trend that answers the goal best as primary (it is drawn full width); everything else is secondary.",
      section: "A short heading (at most 80 characters) grouping related panels, such as 'Throughput' or 'Where it is slow'; null for panels at the top. Panels of one section are drawn together under its heading.",
      rationale: "One short sentence per panel: what it shows and why it matters for the goal.",
    },
    examplePanels: examples(),
  };
}
