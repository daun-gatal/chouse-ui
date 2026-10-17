/**
 * A dashboard view in the URL (ADR 0021 §12): time range, variable values and
 * connection, so a link — from an alert, a chat or a colleague — opens the
 * exact view. A parameter the dashboard does not understand is reported, and
 * the dashboard's own setting is used for it.
 */

import { RELATIVE_RANGE_KEYS, type RelativeRange, type TimeRange, type Variable } from "@/lib/viz/spec";

export interface ViewState {
  range: TimeRange;
  values: Record<string, string>;
  connectionId: string | null;
}

export interface ParsedView {
  view: ViewState;
  /** What in the link was not usable, in words. */
  problems: string[];
}

const VAR_PREFIX = "var-";
const MAX_RANGE_SECONDS = 400 * 86_400;

function isRelative(value: string): value is RelativeRange {
  return (RELATIVE_RANGE_KEYS as string[]).includes(value);
}

export function parseView(params: URLSearchParams, dashboard: { timeRange: RelativeRange; connectionId: string | null; variables: Variable[] }): ParsedView {
  const problems: string[] = [];
  let range: TimeRange = { kind: "relative", value: dashboard.timeRange };
  const rel = params.get("range");
  const from = params.get("from");
  const to = params.get("to");
  if (from !== null || to !== null) {
    const f = Number(from);
    const t = Number(to);
    if (Number.isInteger(f) && Number.isInteger(t) && f > 0 && t > f && t - f <= MAX_RANGE_SECONDS) {
      range = { kind: "absolute", from: f, to: t };
    } else {
      problems.push("The link's time range is not valid (from and to must be unix seconds, at most 400 days apart)");
    }
  } else if (rel !== null) {
    if (isRelative(rel)) range = { kind: "relative", value: rel };
    else problems.push(`The link's time range "${rel}" is not one of ${RELATIVE_RANGE_KEYS.join(", ")}`);
  }

  const declared = new Map(dashboard.variables.map((v) => [v.name, v]));
  const values: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (!key.startsWith(VAR_PREFIX)) continue;
    const name = key.slice(VAR_PREFIX.length);
    if (declared.has(name)) values[name] = value;
    else problems.push(`The link sets ${name}, which is not a variable of this dashboard`);
  }

  const connection = params.get("connection");
  return { view: { range, values, connectionId: connection ?? dashboard.connectionId }, problems };
}

/** The search params for a view, keeping unrelated params (such as `edit`). */
export function writeView(current: URLSearchParams, view: ViewState, dashboardConnectionId: string | null): URLSearchParams {
  const next = new URLSearchParams();
  for (const [key, value] of current.entries()) {
    if (key === "range" || key === "from" || key === "to" || key === "connection" || key.startsWith(VAR_PREFIX)) continue;
    next.append(key, value);
  }
  if (view.range.kind === "relative") next.set("range", view.range.value);
  else {
    next.set("from", String(view.range.from));
    next.set("to", String(view.range.to));
  }
  for (const [name, value] of Object.entries(view.values)) next.set(`${VAR_PREFIX}${name}`, value);
  if (view.connectionId !== null && view.connectionId !== dashboardConnectionId) next.set("connection", view.connectionId);
  return next;
}
