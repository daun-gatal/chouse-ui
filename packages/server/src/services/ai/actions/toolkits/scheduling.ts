/**
 * Scheduling toolkit (ADR 0025 §2): scheduled report queries.
 */

import { z } from "zod";

import { PERMISSIONS } from "../../../../rbac/schema/base";
import type { ActionDefinition } from "../types";
import { idOf, needConnection, quote, scheduleBody, scheduleFields, scheduleText, str } from "./shared";

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
];
