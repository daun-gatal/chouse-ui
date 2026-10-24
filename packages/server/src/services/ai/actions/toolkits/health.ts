/**
 * Data Health toolkit (ADR 0025 §2): promises, their checks and incidents.
 * The edit route takes the whole promise, so edits read it, change the given
 * fields and send it back.
 */

import { z } from "zod";

import { PERMISSIONS } from "../../../../rbac/schema/base";
import { healthPromiseBody } from "../resources";
import type { ActionContext, ActionDefinition } from "../types";
import { given, idOf, needConnection, optionalScheduleFields, quote, scheduleBody, scheduleFields, SCHEDULE_KEYS, scheduleText, seg, str } from "./shared";

const CRITICALITY = ["standard", "important", "critical"] as const;
/** The stored formats a person can pick (the route refuses "auto" with an event-time column). */
const EVENT_TIME_ENCODINGS = ["native", "unix_seconds", "unix_milliseconds", "unix_microseconds", "unix_nanoseconds", "string"] as const;
const EDIT_KEYS = ["name", "description", "criticality", "graceSecs", "breachAfter", "recoverAfter", "checks"] as const;

async function editPromise(ctx: ActionContext, id: string, change: Record<string, unknown>): Promise<unknown> {
  const promise = await ctx.api.get<Record<string, unknown>>(`/api/data-health/${seg(id)}`);
  return ctx.api.patch(`/api/data-health/${seg(id)}`, { ...healthPromiseBody(promise), ...change });
}

/** Promises always run in UTC, so their schedule has no timezone. */
const PROMISE_SCHEDULE_KEYS = SCHEDULE_KEYS.filter((k) => k !== "timezone");
const { timezone: _timezone, ...promiseScheduleFields } = optionalScheduleFields;

const promiseId = z.string().min(1).describe("Data Health promise id (from list_health_checks)");
const incidentId = z.string().min(1).describe("Data Health incident id (from list_health_incidents)");

export const HEALTH_ACTIONS: ActionDefinition[] = [
  {
    name: "create_health_promise",
    title: "Create a data health promise",
    toolkit: "health",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DATA_HEALTH_EDIT],
    description: "Create a data health promise on a table of the active connection: checks (freshness, volume, nulls…) evaluated on a schedule. Use the check definitions recommend_health_promise or the data health docs describe.",
    schema: z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
      database: z.string().min(1).max(64),
      table: z.string().min(1).max(64),
      eventTimeColumn: z.string().max(64).optional().describe("Column holding each row's event time, for freshness and slot checks"),
      eventTimeEncoding: z.enum(EVENT_TIME_ENCODINGS).optional().describe("How the event time is stored: native (a Date or DateTime column, the default), unix_* numbers, or string"),
      eventTimeTimezone: z.string().max(100).optional().describe("IANA timezone of string event-time values (string only)"),
      criticality: z.enum(CRITICALITY).optional(),
      ...scheduleFields,
      checks: z.array(z.record(z.string(), z.unknown())).min(1).max(20).describe("Check definitions, each with a type and its settings"),
    }),
    describe: (args) => `Promise ${quote(str(args.name))} on ${str(args.database)}.${str(args.table)} with ${Array.isArray(args.checks) ? args.checks.length : 0} check(s), ${scheduleText(args)}`,
    execute: async (args, ctx) => ctx.api.post("/api/data-health", {
      connectionId: needConnection(ctx),
      name: str(args.name),
      description: typeof args.description === "string" ? args.description : null,
      source: {
        sourceType: "table",
        databaseName: str(args.database),
        tableName: str(args.table),
        ...(typeof args.eventTimeColumn === "string" && args.eventTimeColumn ? {
          eventTimeColumn: args.eventTimeColumn,
          eventTimeEncoding: str(args.eventTimeEncoding, "native"),
          ...(typeof args.eventTimeTimezone === "string" ? { eventTimeTimezone: args.eventTimeTimezone } : {}),
        } : {}),
      },
      ...(typeof args.criticality === "string" ? { criticality: args.criticality } : {}),
      ...scheduleBody(args),
      checks: args.checks,
    }),
    undo: { mode: "delete-created", resource: "health_promise", id: (result) => idOf(result) },
  },
  {
    name: "update_health_promise",
    title: "Edit a data health promise",
    toolkit: "health",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DATA_HEALTH_EDIT],
    description: "Change a promise's name, description, criticality, schedule, thresholds (grace, breach/recover after) or its whole list of checks. Only the fields given change.",
    schema: z.object({
      id: promiseId,
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).optional(),
      criticality: z.enum(CRITICALITY).optional(),
      ...promiseScheduleFields,
      graceSecs: z.number().int().min(0).max(7 * 24 * 60 * 60).optional(),
      breachAfter: z.number().int().min(1).max(20).optional(),
      recoverAfter: z.number().int().min(1).max(20).optional(),
      checks: z.array(z.record(z.string(), z.unknown())).min(1).max(100).optional().describe("Replaces every check"),
    }),
    describe: (args) => `Edit the promise ${quote(str(args.id))} (${[...EDIT_KEYS, ...PROMISE_SCHEDULE_KEYS].filter((k) => args[k] !== undefined).join(", ") || "no fields"})`,
    execute: async (args, ctx) => editPromise(ctx, str(args.id), { ...given(args, EDIT_KEYS), ...given(args, PROMISE_SCHEDULE_KEYS) }),
    undo: { mode: "restore", resource: "health_promise", id: (args) => str(args.id) },
  },
  {
    name: "pause_health_promise",
    title: "Pause a data health promise",
    toolkit: "health",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DATA_HEALTH_EDIT],
    description: "Stop a promise's checks from running until it is resumed.",
    schema: z.object({ id: promiseId }),
    describe: (args) => `Pause the promise ${quote(str(args.id))}`,
    execute: async (args, ctx) => editPromise(ctx, str(args.id), { enabled: false }),
    undo: { mode: "restore", resource: "health_promise", id: (args) => str(args.id) },
  },
  {
    name: "resume_health_promise",
    title: "Resume a data health promise",
    toolkit: "health",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DATA_HEALTH_EDIT],
    description: "Let a paused promise's checks run on their schedule again.",
    schema: z.object({ id: promiseId }),
    describe: (args) => `Resume the promise ${quote(str(args.id))}`,
    execute: async (args, ctx) => editPromise(ctx, str(args.id), { enabled: true }),
    undo: { mode: "restore", resource: "health_promise", id: (args) => str(args.id) },
  },
  {
    name: "run_health_check",
    title: "Run a data health promise now",
    toolkit: "health",
    category: "operations",
    // Only evaluates the checks (it may open or close an incident); nothing to undo.
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DATA_HEALTH_RUN],
    description: "Evaluate a promise's checks once, now.",
    schema: z.object({ id: promiseId }),
    describe: (args) => `Run the promise ${quote(str(args.id))} now`,
    execute: async (args, ctx) => ctx.api.post(`/api/data-health/${seg(args.id)}/run`, {}),
  },
  {
    name: "acknowledge_health_incident",
    title: "Acknowledge a data health incident",
    toolkit: "health",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DATA_HEALTH_EDIT],
    description: "Mark a data health incident as acknowledged (someone is on it).",
    schema: z.object({ id: incidentId }),
    describe: (args) => `Acknowledge the incident ${quote(str(args.id))}`,
    execute: async (args, ctx) => ctx.api.post(`/api/data-health/incidents/${seg(args.id)}/acknowledge`, {}),
  },
  {
    name: "snooze_health_incident",
    title: "Snooze a data health incident",
    toolkit: "health",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DATA_HEALTH_EDIT],
    description: "Silence a data health incident's notifications for a number of hours.",
    schema: z.object({ id: incidentId, hours: z.number().min(0.25).max(168).describe("How long, in hours (up to a week)") }),
    describe: (args) => `Snooze the incident ${quote(str(args.id))} for ${typeof args.hours === "number" ? args.hours : 0} hour(s)`,
    execute: async (args, ctx) => ctx.api.post(`/api/data-health/incidents/${seg(args.id)}/snooze`, {
      until: Date.now() + Math.round((typeof args.hours === "number" ? args.hours : 1) * 3_600_000),
    }),
  },
  {
    name: "delete_health_promise",
    title: "Delete a data health promise",
    toolkit: "health",
    category: "operations",
    tier: "t2",
    connectionScoped: true,
    permissions: [PERMISSIONS.DATA_HEALTH_DELETE],
    description: "Delete a promise with its checks, samples and incident history.",
    schema: z.object({ id: promiseId }),
    describe: (args) => `Delete the promise ${quote(str(args.id))} and its history`,
    execute: async (args, ctx) => ctx.api.delete(`/api/data-health/${seg(args.id)}`),
  },
];
