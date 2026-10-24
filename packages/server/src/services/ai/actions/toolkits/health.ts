/**
 * Data Health toolkit (ADR 0025 §2): promises, their checks and incidents.
 */

import { z } from "zod";

import { PERMISSIONS } from "../../../../rbac/schema/base";
import type { ActionDefinition } from "../types";
import { idOf, needConnection, quote, scheduleBody, scheduleFields, scheduleText, str } from "./shared";

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
      criticality: z.enum(["standard", "important", "critical"]).optional(),
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
        ...(typeof args.eventTimeColumn === "string" && args.eventTimeColumn ? { eventTimeColumn: args.eventTimeColumn } : {}),
      },
      ...(typeof args.criticality === "string" ? { criticality: args.criticality } : {}),
      ...scheduleBody(args),
      checks: args.checks,
    }),
    undo: { mode: "delete-created", resource: "health_promise", id: (result) => idOf(result) },
  },
];
