/**
 * Save-time checks for a dashboard document (ADR 0021 §1–§3), shared by the
 * routes, imports and AI drafts: every panel's SQL compiles with the
 * dashboard's variables and is a single read-only SELECT, and fleet panels use
 * a chart the connection can become the series of.
 *
 * Data access is NOT checked here: it belongs to whoever runs a panel, and is
 * checked on every run (runner.ts).
 */

import { validateReadOnlySelect } from "../scheduledQueries/validation";
import { codeOnly } from "./lint";
import { compileSql, defaultValues, resolveWindow, scanMacros } from "./macros";
import { panelLabel, type ChartPanelInput, type DashboardInput, type Variable, type VizSpec } from "./spec";

/** Chart types a fleet panel can draw: one series (or row, or stat) per connection. */
const FLEET_TYPES = new Set<VizSpec["type"]>([
  "bar", "horizontal_bar", "grouped_bar", "stacked_bar",
  "line", "multi_line", "area", "stacked_area", "stat", "table",
]);

export function fleetProblems(viz: VizSpec): string[] {
  if (!FLEET_TYPES.has(viz.type)) return [`a ${viz.type} chart cannot run across the fleet; use a line, area, bar, stat or table`];
  if (viz.series !== null) return ["a fleet panel splits by connection, so it cannot also split by series"];
  if (viz.type !== "table" && viz.y.length !== 1) return ["a fleet panel plots exactly one y column per connection"];
  if (viz.baseline !== null) return ["a fleet panel has one series per connection, so it cannot draw an expected-range band"];
  return [];
}

const FORMAT_RE = /\bformat\s+\w+\s*;?\s*$/i;

/** Problems with one panel's SQL and shape (empty when it can be saved). */
export function panelProblems(panel: Pick<ChartPanelInput, "sql" | "viz" | "fleet">, variables: Variable[]): string[] {
  const problems: string[] = [];
  const compiled = compileSql(panel.sql, variables, defaultValues(variables), resolveWindow({ kind: "relative", value: "1h" }, Date.now()));
  if (FORMAT_RE.test(codeOnly(panel.sql))) problems.push("Remove the FORMAT clause: panels always read the result as JSON");
  if (!compiled.ok) {
    problems.push(compiled.error);
  } else {
    const readOnly = validateReadOnlySelect(compiled.compiled.validationSql);
    if (!readOnly.ok) problems.push(readOnly.error ?? "Only a single read-only SELECT is allowed");
  }
  if (panel.fleet) problems.push(...fleetProblems(panel.viz));
  return problems;
}

/** Problems with a variable's options query (empty when it can be saved). */
export function variableProblems(variable: Variable): string[] {
  if (variable.options.source !== "query") return [];
  const scan = scanMacros(variable.options.sql);
  if (!scan.ok) return [`${variable.label}: ${scan.error}`];
  if (scan.tokens.length > 0) return [`${variable.label}: an options query cannot use macros`];
  const readOnly = validateReadOnlySelect(variable.options.sql);
  return readOnly.ok ? [] : [`${variable.label}: ${readOnly.error ?? "only a single read-only SELECT is allowed"}`];
}

/** Every problem with the document, prefixed with the panel or variable it is about. */
export function dashboardProblems(input: DashboardInput): string[] {
  const problems: string[] = [];
  for (const variable of input.variables) problems.push(...variableProblems(variable));
  input.panels.forEach((panel, i) => {
    if (panel.kind !== "chart") return;
    for (const problem of panelProblems(panel, input.variables)) problems.push(`${panelLabel(panel, i)}: ${problem}`);
  });
  return problems;
}
