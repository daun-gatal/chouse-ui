/**
 * Scheduling toolkit (ADR 0025 §2): scheduled report queries. The edit route
 * takes the whole job, so edits read the job, change the given fields and
 * send it back.
 */

import { z } from "zod";

import { PERMISSIONS } from "../../../../rbac/schema/base";
import { scheduledJobBody } from "../resources";
import type { ActionContext, ActionDefinition } from "../types";
import { given, idOf, needConnection, optionalScheduleFields, quote, scheduleBody, scheduleFields, SCHEDULE_KEYS, scheduleText, seg, str } from "./shared";

const EDIT_KEYS = ["name", "description", "query", ...SCHEDULE_KEYS, "maxRows", "timeoutSecs"] as const;

async function editJob(ctx: ActionContext, id: string, change: Record<string, unknown>): Promise<unknown> {
  const job = await ctx.api.get<Record<string, unknown>>(`/api/scheduled-queries/${seg(id)}`);
  return ctx.api.patch(`/api/scheduled-queries/${seg(id)}`, { ...scheduledJobBody(job), ...change });
}

const jobId = z.string().min(1).describe("Scheduled query id (from list_scheduled_jobs)");

export const SCHEDULING_ACTIONS: ActionDefinition[] = [
  {
    name: "create_scheduled_query",
    title: "Schedule a query",
    toolkit: "scheduling",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.SCHEDULED_QUERIES_EDIT],
    description: "Create a scheduled report query (read-only SELECT, no materialization) on the active connection.",
    schema: z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
      query: z.string().min(1).describe("Read-only SELECT"),
      ...scheduleFields,
    }),
    describe: (args) => `Schedule ${quote(str(args.name))} ${scheduleText(args)}`,
    execute: async (args, ctx) => ctx.api.post("/api/scheduled-queries", {
      connectionId: needConnection(ctx),
      name: str(args.name),
      description: typeof args.description === "string" ? args.description : null,
      query: str(args.query),
      ...scheduleBody(args),
      timezone: str(args.timezone, "UTC"),
      outputMode: "none",
    }),
    undo: { mode: "delete-created", resource: "scheduled_query", id: (result) => idOf(result) },
  },
  {
    name: "update_scheduled_job",
    title: "Edit a scheduled query",
    toolkit: "scheduling",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.SCHEDULED_QUERIES_EDIT],
    description: "Change a scheduled query's name, description, SQL, schedule, row limit or timeout. Only the fields given change; its connection and output never do.",
    schema: z.object({
      id: jobId,
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).optional(),
      query: z.string().min(1).optional().describe("Read-only SELECT"),
      ...optionalScheduleFields,
      maxRows: z.number().int().min(1).max(10000).optional(),
      timeoutSecs: z.number().int().min(1).max(3600).optional(),
    }),
    describe: (args) => `Edit the scheduled query ${quote(str(args.id))} (${EDIT_KEYS.filter((k) => args[k] !== undefined).join(", ") || "no fields"})`,
    execute: async (args, ctx) => editJob(ctx, str(args.id), given(args, EDIT_KEYS)),
    undo: { mode: "restore", resource: "scheduled_query", id: (args) => str(args.id) },
  },
  {
    name: "pause_scheduled_job",
    title: "Pause a scheduled query",
    toolkit: "scheduling",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.SCHEDULED_QUERIES_EDIT],
    description: "Stop a scheduled query from running until it is resumed.",
    schema: z.object({ id: jobId }),
    describe: (args) => `Pause the scheduled query ${quote(str(args.id))}`,
    execute: async (args, ctx) => editJob(ctx, str(args.id), { enabled: false }),
    undo: { mode: "restore", resource: "scheduled_query", id: (args) => str(args.id) },
  },
  {
    name: "resume_scheduled_job",
    title: "Resume a scheduled query",
    toolkit: "scheduling",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.SCHEDULED_QUERIES_EDIT],
    description: "Let a paused scheduled query run on its schedule again.",
    schema: z.object({ id: jobId }),
    describe: (args) => `Resume the scheduled query ${quote(str(args.id))}`,
    execute: async (args, ctx) => editJob(ctx, str(args.id), { enabled: true }),
    undo: { mode: "restore", resource: "scheduled_query", id: (args) => str(args.id) },
  },
  {
    name: "run_scheduled_job",
    title: "Run a scheduled query now",
    toolkit: "scheduling",
    category: "operations",
    tier: "t2",
    connectionScoped: true,
    permissions: [PERMISSIONS.SCHEDULED_QUERIES_RUN],
    description: "Run a scheduled query once, now, outside its schedule (it may write to its destination and notify its channels).",
    schema: z.object({ id: jobId }),
    describe: (args) => `Run the scheduled query ${quote(str(args.id))} now`,
    execute: async (args, ctx) => ctx.api.post(`/api/scheduled-queries/${seg(args.id)}/run`, {}),
  },
  {
    name: "delete_scheduled_job",
    title: "Delete a scheduled query",
    toolkit: "scheduling",
    category: "operations",
    tier: "t2",
    connectionScoped: true,
    permissions: [PERMISSIONS.SCHEDULED_QUERIES_DELETE],
    description: "Delete a scheduled query and its run history.",
    schema: z.object({ id: jobId }),
    describe: (args) => `Delete the scheduled query ${quote(str(args.id))} and its run history`,
    execute: async (args, ctx) => ctx.api.delete(`/api/scheduled-queries/${seg(args.id)}`),
  },
];
