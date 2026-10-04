/**
 * Field specs for the closed remediation catalog (ADR 0016 §8). The server
 * validates every parameter again; this only shapes the form.
 */

import type { ActionParams, ActionType } from "@/api/remediation";

export type FieldKind = "text" | "number" | "boolean" | "datetime" | "select";

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  options?: string[];
  placeholder?: string;
  optional?: boolean;
}

const table: FieldSpec[] = [
  { key: "database", label: "Database", kind: "text", placeholder: "shop" },
  { key: "table", label: "Table", kind: "text", placeholder: "orders" },
];

export const ACTION_META: Record<ActionType, { label: string; summary: string; fields: FieldSpec[] }> = {
  kill_query: { label: "Kill query", summary: "Stop one running query", fields: [{ key: "queryId", label: "Query id", kind: "text", placeholder: "7f3a…" }] },
  pause_scheduled_job: { label: "Pause scheduled job", summary: "Stop a job from firing", fields: [{ key: "jobId", label: "Job id", kind: "text" }] },
  resume_scheduled_job: { label: "Resume scheduled job", summary: "Let a paused job fire again", fields: [{ key: "jobId", label: "Job id", kind: "text" }] },
  delay_scheduled_job: {
    label: "Delay scheduled job",
    summary: "Pause a job until a time, then resume it",
    fields: [{ key: "jobId", label: "Job id", kind: "text" }, { key: "until", label: "Resume at", kind: "datetime" }],
  },
  set_profile_setting: {
    label: "Set profile setting",
    summary: "Change one setting on a user, role or settings profile",
    fields: [
      { key: "targetKind", label: "Target", kind: "select", options: ["user", "role", "profile"] },
      { key: "targetName", label: "Name", kind: "text" },
      { key: "setting", label: "Setting", kind: "text", placeholder: "max_memory_usage" },
      { key: "value", label: "Value", kind: "text" },
    ],
  },
  optimize_partition: {
    label: "Optimize partition",
    summary: "Merge parts of one partition",
    fields: [...table, { key: "partitionId", label: "Partition id", kind: "text", placeholder: "202610" }, { key: "final", label: "FINAL", kind: "boolean", optional: true }],
  },
  restart_replica: { label: "Restart replica", summary: "SYSTEM RESTART REPLICA", fields: table },
  add_skip_index: {
    label: "Add skip index",
    summary: "Add and materialize a data-skipping index",
    fields: [
      ...table,
      { key: "name", label: "Index name", kind: "text", placeholder: "idx_user_id" },
      { key: "expression", label: "Expression", kind: "text", placeholder: "user_id" },
      { key: "indexType", label: "Type", kind: "text", placeholder: "bloom_filter" },
      { key: "granularity", label: "Granularity", kind: "number", optional: true },
    ],
  },
  modify_ttl: { label: "Modify TTL", summary: "Change the table TTL (rollback restores the old one)", fields: [...table, { key: "ttl", label: "TTL", kind: "text", placeholder: "event_time + INTERVAL 30 DAY" }] },
  modify_column_codec: {
    label: "Modify column codec",
    summary: "Recompress one column (rollback restores the old codec)",
    fields: [...table, { key: "column", label: "Column", kind: "text" }, { key: "codec", label: "Codec", kind: "text", placeholder: "ZSTD(3)" }],
  },
  restart_engine_table: { label: "Restart engine table", summary: "DETACH / ATTACH a queue or object-storage engine table", fields: table },
  reload_dictionary: { label: "Reload dictionary", summary: "SYSTEM RELOAD DICTIONARY", fields: [{ key: "database", label: "Database", kind: "text" }, { key: "name", label: "Dictionary", kind: "text" }] },
  refresh_view: { label: "Refresh view", summary: "SYSTEM REFRESH VIEW", fields: [{ key: "database", label: "Database", kind: "text" }, { key: "view", label: "View", kind: "text" }] },
  flush_distributed: { label: "Flush Distributed", summary: "SYSTEM FLUSH DISTRIBUTED", fields: table },
};

export type FormValues = Record<string, string | boolean>;

/** Form values for an existing params object (AI drafts, edits). */
export function valuesFromParams(type: ActionType, params: Record<string, unknown>): FormValues {
  const values: FormValues = {};
  for (const field of ACTION_META[type].fields) {
    const raw = params[field.key];
    if (field.kind === "boolean") values[field.key] = raw === true;
    else if (field.kind === "datetime" && typeof raw === "number") values[field.key] = toLocalInput(raw);
    else values[field.key] = raw == null ? "" : String(raw);
  }
  return values;
}

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Typed params for the API, or the first problem to show. */
export function buildParams(type: ActionType, values: FormValues): { params: ActionParams } | { error: string } {
  const params: ActionParams = { type };
  for (const field of ACTION_META[type].fields) {
    const raw = values[field.key];
    if (field.kind === "boolean") {
      params[field.key] = raw === true;
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      if (field.optional) continue;
      return { error: `${field.label} is required` };
    }
    if (field.kind === "number") {
      const n = Number(text);
      if (!Number.isFinite(n)) return { error: `${field.label} must be a number` };
      params[field.key] = n;
    } else if (field.kind === "datetime") {
      const ms = new Date(text).getTime();
      if (!Number.isFinite(ms)) return { error: `${field.label} is not a valid time` };
      params[field.key] = ms;
    } else if (field.key === "value") {
      // Settings accept numbers and booleans; keep their type.
      params[field.key] = /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text === "true" || text === "false" ? text === "true" : text;
    } else {
      params[field.key] = text;
    }
  }
  return { params };
}
