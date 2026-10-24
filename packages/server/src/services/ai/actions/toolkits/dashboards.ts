/**
 * Dashboards & Context toolkit (ADR 0025 §2): dashboards, their panels and
 * notes, and the curated context of tables.
 */

import { z } from "zod";

import { PERMISSIONS } from "../../../../rbac/schema/base";
import { tableContextId } from "../resources";
import type { ActionDefinition } from "../types";
import { dashboardDocument, idOf, needConnection, panelSchema, quote, record, seg, str } from "./shared";

const TIME_RANGES = ["15m", "1h", "3h", "6h", "12h", "24h", "2d", "7d", "30d"] as const;

export const DASHBOARD_ACTIONS: ActionDefinition[] = [
  {
    name: "create_dashboard",
    title: "Create a dashboard",
    toolkit: "dashboards",
    category: "operations",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.DASHBOARDS_EDIT],
    description: "Create a dashboard on the active connection from panels (title, SQL, chart type and columns).",
    schema: z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      timeRange: z.enum(TIME_RANGES).optional().describe("Default time range, 24h if omitted"),
      panels: z.array(panelSchema).min(1).max(24),
    }),
    describe: (args) => `Create the dashboard ${quote(str(args.title))} with ${Array.isArray(args.panels) ? args.panels.length : 0} panel(s)`,
    execute: async (args, ctx) => ctx.api.post("/api/dashboards", dashboardDocument(args, needConnection(ctx))),
    undo: { mode: "delete-created", resource: "dashboard", id: (result) => idOf(result) },
  },
  {
    name: "update_table_context",
    title: "Update table context",
    toolkit: "dashboards",
    category: "data",
    tier: "t1",
    connectionScoped: true,
    permissions: [PERMISSIONS.CONTEXT_EDIT],
    description: "Set a table's curated context (description, grain, owner, tags) that every agent and person reads. Only the fields given change.",
    schema: z.object({
      database: z.string().min(1).max(64),
      table: z.string().min(1).max(64),
      description: z.string().max(4000).optional(),
      grain: z.string().max(500).optional().describe("What one row is, e.g. one order line"),
      owner: z.string().max(200).optional(),
      tags: z.array(z.string().min(1).max(60)).max(30).optional(),
    }),
    describe: (args) => `Update the context of ${str(args.database)}.${str(args.table)} (${["description", "grain", "owner", "tags"].filter((k) => args[k] !== undefined).join(", ") || "no fields"})`,
    execute: async (args, ctx) => {
      const path = `/api/context/tables/${seg(args.database)}/${seg(args.table)}`;
      const existing = await ctx.api.get<{ curated?: Record<string, unknown> | null }>(path).catch(() => ({ curated: null }));
      const current = record(existing.curated);
      const pick = (key: string): unknown => (args[key] !== undefined ? args[key] : current[key]);
      return ctx.api.put(path, {
        description: pick("description") ?? null,
        grain: pick("grain") ?? null,
        owner: pick("owner") ?? null,
        insteadOf: current.insteadOf ?? null,
        deprecated: current.deprecated === true,
        tags: Array.isArray(pick("tags")) ? pick("tags") : [],
      });
    },
    undo: { mode: "restore", resource: "table_context", id: (args) => tableContextId(str(args.database), str(args.table)) },
  },
];
