/**
 * A dashboard view in the URL (ADR 0021 §12, ADR 0023 §5, §7, §8): time range,
 * variable values (a multi-value variable repeats its parameter once per
 * value), compare, and the annotation sources the viewer hid — so a link, from
 * an alert, a report, a chat or a colleague, opens the same view. The
 * connection is not part of it: dashboards follow the active connection, like
 * every other page. A parameter the dashboard does not understand is reported,
 * and the dashboard's own setting is used for it.
 */

import { ANNOTATION_SOURCES, RELATIVE_RANGE_KEYS, type AnnotationSource, type RelativeRange, type TimeRange, type Variable, type VariableValues } from "@/lib/viz/spec";

export const COMPARE_OPTIONS = { "1d": 86_400, "7d": 604_800 } as const;
export type CompareKey = keyof typeof COMPARE_OPTIONS;

export interface ViewState {
  range: TimeRange;
  values: VariableValues;
  /** Compare with this long ago (ADR 0023 §8), or not at all. */
  compare: CompareKey | null;
  /** Annotation sources the viewer turned off for this view. */
  hidden: AnnotationSource[];
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

export function parseView(params: URLSearchParams, dashboard: { timeRange: RelativeRange; variables: Variable[] }): ParsedView {
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
  const values: VariableValues = {};
  for (const [key, value] of params.entries()) {
    if (!key.startsWith(VAR_PREFIX)) continue;
    const name = key.slice(VAR_PREFIX.length);
    const variable = declared.get(name);
    if (!variable) {
      if (!problems.some((p) => p.includes(` ${name},`))) problems.push(`The link sets ${name}, which is not a variable of this dashboard`);
      continue;
    }
    if (variable.kind === "multi") {
      const list = values[name];
      values[name] = Array.isArray(list) ? [...list, value] : [value];
    } else if (name in values) {
      problems.push(`The link sets ${variable.label} more than once; it takes one value`);
    } else {
      values[name] = value;
    }
  }

  let compare: CompareKey | null = null;
  const cmp = params.get("cmp");
  if (cmp !== null) {
    if (cmp in COMPARE_OPTIONS) compare = cmp as CompareKey;
    else problems.push(`The link's compare "${cmp}" is not one of ${Object.keys(COMPARE_OPTIONS).join(", ")}`);
  }

  const hidden: AnnotationSource[] = [];
  const off = params.get("ann-off");
  if (off !== null && off !== "") {
    for (const source of off.split(",")) {
      if ((ANNOTATION_SOURCES as readonly string[]).includes(source)) hidden.push(source as AnnotationSource);
      else problems.push(`The link hides "${source}", which is not an annotation source`);
    }
  }

  return { view: { range, values, compare, hidden }, problems };
}

/** The search params for a view, keeping unrelated params (such as `edit`). */
export function writeView(current: URLSearchParams, view: ViewState): URLSearchParams {
  const next = new URLSearchParams();
  for (const [key, value] of current.entries()) {
    if (key === "range" || key === "from" || key === "to" || key === "cmp" || key === "ann-off" || key.startsWith(VAR_PREFIX)) continue;
    next.append(key, value);
  }
  if (view.range.kind === "relative") next.set("range", view.range.value);
  else {
    next.set("from", String(view.range.from));
    next.set("to", String(view.range.to));
  }
  for (const [name, value] of Object.entries(view.values)) {
    if (Array.isArray(value)) for (const item of value) next.append(`${VAR_PREFIX}${name}`, item);
    else next.set(`${VAR_PREFIX}${name}`, value);
  }
  if (view.compare !== null) next.set("cmp", view.compare);
  if (view.hidden.length > 0) next.set("ann-off", view.hidden.join(","));
  return next;
}
