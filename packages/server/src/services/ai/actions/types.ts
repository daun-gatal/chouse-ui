/**
 * Shared types for AI write actions (ADR 0025).
 *
 * A write tool is checked by its tier, decided per call:
 * - t1: reversible — runs at once and is recorded with an undo;
 * - t2: has effects undo cannot reverse — one confirmation where the user is;
 * - t3: privileged or irreversible — a second person approves in CHouse.
 */

import type { z } from "zod";

import type { Permission } from "../../../rbac/schema/base";

export const TIERS = ["t1", "t2", "t3"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABELS: Record<Tier, string> = {
  t1: "Runs at once, with undo",
  t2: "Asks once",
  t3: "Second approver",
};

/** Where a write came from; recorded on every action. */
export const ACTION_ORIGINS = ["chat", "mcp", "cli", "background"] as const;
export type ActionOrigin = (typeof ACTION_ORIGINS)[number];

/** Toolkits group tools by the part of CHouse they belong to (ADR 0025 §2). */
export const TOOLKITS = ["data", "scheduling", "health", "observe", "dashboards", "access", "platform"] as const;
export type Toolkit = (typeof TOOLKITS)[number];

export const TOOLKIT_LABELS: Record<Toolkit, string> = {
  data: "Data & Query",
  scheduling: "Scheduling",
  health: "Data Health",
  observe: "Observe & Ops",
  dashboards: "Dashboards & Context",
  access: "Access",
  platform: "Platform & Audit",
};

export function isToolkit(value: unknown): value is Toolkit {
  return typeof value === "string" && (TOOLKITS as readonly string[]).includes(value);
}

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/**
 * The API an action calls: the app's own routes, in-process, as the caller.
 * Chat and the CLI use the user's token; MCP uses the caller's PAT.
 */
export interface ActionApi {
  get<T = unknown>(path: string, query?: Record<string, string | undefined>): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body: unknown): Promise<T>;
  patch<T = unknown>(path: string, body: unknown): Promise<T>;
  delete<T = unknown>(path: string, body?: unknown): Promise<T>;
}

export interface ActionContext {
  api: ActionApi;
  /** The caller's active connection, the default for every connection-scoped action. */
  connectionId: string | null;
  /** The caller (the person the action runs as). */
  userId: string;
}

/** Resources an action can undo; each has an adapter in resources.ts. */
export const RESOURCE_KINDS = [
  "saved_query",
  "scheduled_query",
  "health_promise",
  "dashboard",
  "table_context",
  "alert_rule",
  "metric",
  "notebook_cell",
  "table_criticality",
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/**
 * How a T1 call is undone:
 * - restore: put the object back as it was before the call;
 * - delete-created: delete the object the call created;
 * - recreate-deleted: create the deleted object again (it gets a new id).
 */
export type UndoSpec =
  | { mode: "restore"; resource: ResourceKind; id: (args: Record<string, unknown>, ctx: ActionContext) => string | null }
  | { mode: "delete-created"; resource: ResourceKind; id: (result: unknown, args: Record<string, unknown>) => string | null }
  | { mode: "recreate-deleted"; resource: ResourceKind; id: (args: Record<string, unknown>, ctx: ActionContext) => string | null };

/** What is stored to undo an executed action. */
export interface UndoRecord {
  mode: UndoSpec["mode"];
  resource: ResourceKind;
  id: string;
  /** The object before the call (restore, recreate-deleted). */
  before?: Record<string, unknown> | null;
  /** Fingerprint of the object right after the call: undo refuses once it differs. */
  afterHash?: string | null;
}

export type TierRule = Tier | ((args: Record<string, unknown>, ctx: ActionContext) => Tier | Promise<Tier>);

export interface ActionDefinition {
  name: string;
  title: string;
  toolkit: Toolkit;
  category: string;
  /** Base tier; the production bump is applied on top (tiers.ts). */
  tier: TierRule;
  /** The caller needs one of these for the tool to be offered; the route still decides. */
  permissions: Permission[];
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  /** One line for the approval card and the activity feed. */
  describe(args: Record<string, unknown>): string;
  execute(args: Record<string, unknown>, ctx: ActionContext): Promise<unknown>;
  /** T1 tools that can be undone. */
  undo?: UndoSpec;
  /** Whether the action works on the caller's active connection (the production bump applies). */
  connectionScoped: boolean;
  /** Only files a proposal that another queue (Fixes) decides; it changes nothing by itself. */
  proposalOnly?: boolean;
}
