// Example content for every area of CHouse UI, so the lab looks like a team's
// install rather than an empty one: teammates with different roles, a data
// access policy, saved queries, dashboards, an alert rule, a scheduled report,
// data-health promises (one of which breaks on purpose), and table context.
//
// Each area is its own step. Every step looks for what it would create (by
// name) first, so running the loader again changes nothing. These steps are
// optional: a failure is reported, but the lab still starts.

import { LAB_CONNECTION_NAME, LabError, arrayField, objectField, runStep, stringField } from "./lib.ts";
import type { ChouseApi, StepResult } from "./lib.ts";

/** Demo teammates. They sign in with the lab's admin password. */
export const TEAM: ReadonlyArray<{ username: string; displayName: string; role: string }> = [
  { username: "maya", displayName: "Maya Lin", role: "analyst" },
  { username: "devon", displayName: "Devon Park", role: "developer" },
  { username: "vic", displayName: "Vic Reyes", role: "viewer" },
];

export const ANALYST_POLICY = "Analysts: sample shop data";

export const SAVED_QUERIES: ReadonlyArray<{ name: string; description: string; query: string }> = [
  {
    name: "Revenue by country, last 7 days",
    description: "Reads the daily rollup the materialized view keeps up to date.",
    query: "SELECT country, sum(orders) AS orders, sum(revenue) AS revenue\nFROM analytics.orders_daily\nWHERE day >= today() - 7\nGROUP BY country\nORDER BY revenue DESC",
  },
  {
    name: "Top customers this month",
    description: "Joins raw orders to customers.",
    query: "SELECT c.name, c.country, count() AS orders, sum(o.amount) AS spent\nFROM shop.orders_raw AS o\nINNER JOIN shop.customers AS c ON o.customer_id = c.customer_id\nWHERE o.created_at >= toStartOfMonth(now())\nGROUP BY c.name, c.country\nORDER BY spent DESC\nLIMIT 20",
  },
  {
    name: "Orders per minute, last hour",
    description: "Shows the lab's live ingest (a batch every 30 seconds).",
    query: "SELECT toStartOfMinute(created_at) AS minute, count() AS orders\nFROM shop.orders_raw\nWHERE created_at >= now() - INTERVAL 1 HOUR\nGROUP BY minute\nORDER BY minute",
  },
  {
    name: "Slow query to optimize",
    description: "The query the lab runs every 2 minutes. It scans every row because customer_id is not in the sort key. Try Explain, or Optimize with AI.",
    query: "SELECT customer_id, count() AS orders, sum(amount) AS spent\nFROM shop.orders_raw\nWHERE lower(currency) = 'eur' AND toString(customer_id) LIKE '%42%'\nGROUP BY customer_id\nORDER BY spent DESC\nLIMIT 20",
  },
];

export const DASHBOARD_TEMPLATES: ReadonlyArray<{ id: string; title: string }> = [
  { id: "clickhouse-overview", title: "ClickHouse overview" },
  { id: "query-latency", title: "Query latency" },
  { id: "disk-and-tables", title: "Disk and tables" },
];

export const SHOP_DASHBOARD = "Shop sales";
export const ALERT_RULE = "Lab fleet thresholds";
export const SCHEDULED_REPORT = "Daily revenue by country";
export const FRESHNESS_PROMISE = "Orders keep arriving";
export const CURRENCY_PROMISE = "Shop orders are in EUR";

function chartPanel(title: string, sql: string, viz: Record<string, unknown>, layout: { x: number; y: number; w: number; h: number }): Record<string, unknown> {
  return {
    id: crypto.randomUUID(),
    kind: "chart",
    title,
    sql,
    viz: { version: 2, series: null, decimals: null, thresholds: [], colorScheme: "blue", reduce: null, links: [], baseline: null, ...viz },
    fleet: false,
    layout,
  };
}

/** The custom "Shop sales" dashboard, scoped to the lab connection. */
export function shopDashboard(connectionId: string): Record<string, unknown> {
  return {
    title: SHOP_DASHBOARD,
    description: "Orders and revenue from the lab's sample shop. Built from the shop and analytics databases.",
    timeRange: "24h",
    refreshSeconds: 60,
    connectionScope: { kind: "only", connectionIds: [connectionId] },
    variables: [],
    annotations: ["ddl", "alerts", "incidents", "notes"],
    panels: [
      chartPanel(
        "Orders over time",
        "SELECT toStartOfInterval(created_at, INTERVAL {{interval_s}} SECOND) AS t, count() AS orders\nFROM shop.orders_raw WHERE created_at >= {{from}} AND created_at < {{to}} GROUP BY t ORDER BY t",
        { type: "line", x: "t", y: ["orders"], unit: "count", decimals: 0 },
        { x: 0, y: 0, w: 24, h: 9 },
      ),
      chartPanel(
        "Revenue by country",
        "SELECT country, sum(amount) AS revenue\nFROM shop.orders_raw WHERE created_at >= {{from}} AND created_at < {{to}} GROUP BY country ORDER BY revenue DESC",
        { type: "horizontal_bar", x: "country", y: ["revenue"], unit: "count", colorScheme: "violet" },
        { x: 0, y: 9, w: 12, h: 9 },
      ),
      chartPanel(
        "Orders by currency",
        "SELECT currency, count() AS orders\nFROM shop.orders_raw WHERE created_at >= {{from}} AND created_at < {{to}} GROUP BY currency ORDER BY orders DESC",
        { type: "donut", x: "currency", y: ["orders"], unit: "count", colorScheme: "orange" },
        { x: 12, y: 9, w: 12, h: 9 },
      ),
    ],
  };
}

function names(items: unknown[], key = "name"): Set<string> {
  return new Set(items.map((item) => stringField(item, key)).filter((name): name is string => Boolean(name)));
}

/** Creates the demo teammates, each with one built-in role. */
export async function ensureTeam(api: ChouseApi, password: string): Promise<string> {
  const roles = arrayField(await api.request("GET", "/api/rbac/roles"), "roles");
  const roleId = (name: string): string | undefined => stringField(roles.find((r) => stringField(r, "name") === name), "id");
  const created: string[] = [];
  for (const member of TEAM) {
    const found = arrayField(await api.request("GET", `/api/rbac/users?search=${encodeURIComponent(member.username)}`), "users");
    if (found.some((u) => stringField(u, "username") === member.username)) continue;
    const id = roleId(member.role);
    if (!id) throw new Error(`role ${member.role} not found`);
    await api.request("POST", "/api/rbac/users", {
      email: `${member.username}@lab.local`,
      username: member.username,
      displayName: member.displayName,
      password,
      roleIds: [id],
    });
    created.push(member.username);
  }
  return created.length > 0 ? `added ${created.join(", ")}` : "teammates already present";
}

/** A data access policy for analysts: the sample databases on the lab connection, nothing else. */
export async function ensureAnalystPolicy(api: ChouseApi, connectionId: string): Promise<string> {
  const policies = await api.request("GET", "/api/rbac/data-access-policies");
  const list = Array.isArray(policies) ? policies : [];
  let policyId = stringField(list.find((p) => stringField(p, "name") === ANALYST_POLICY), "id");
  const created = !policyId;
  if (!policyId) {
    const policy = await api.request("POST", "/api/rbac/data-access-policies", {
      name: ANALYST_POLICY,
      description: "Analysts can read the shop and analytics databases on the lab connection.",
      rules: [
        { connectionId, databasePattern: "shop", tablePattern: "*", isAllowed: true, priority: 10, description: "Raw orders and customers" },
        { connectionId, databasePattern: "analytics", tablePattern: "*", isAllowed: true, priority: 10, description: "Daily rollups" },
      ],
    });
    policyId = stringField(policy, "id");
    if (!policyId) throw new Error("the policy response had no id");
  }
  const roles = arrayField(await api.request("GET", "/api/rbac/roles"), "roles");
  const analystId = stringField(roles.find((r) => stringField(r, "name") === "analyst"), "id");
  if (!analystId) throw new Error("role analyst not found");
  // Setting a role's policies replaces the whole list, so keep what it has.
  const current = await api.request("GET", `/api/rbac/data-access-policies/role/${encodeURIComponent(analystId)}`);
  const currentIds = (Array.isArray(current) ? current : []).map((p) => stringField(p, "id")).filter((id): id is string => Boolean(id));
  if (!currentIds.includes(policyId)) {
    await api.request("POST", `/api/rbac/data-access-policies/role/${encodeURIComponent(analystId)}`, { policyIds: [...currentIds, policyId] });
  }
  return created ? `created "${ANALYST_POLICY}" for analysts` : `"${ANALYST_POLICY}" already present`;
}

/** Shared saved queries on the lab connection. */
export async function ensureSavedQueries(api: ChouseApi, connectionId: string): Promise<string> {
  const existing = names(await savedList(api));
  let added = 0;
  for (const q of SAVED_QUERIES) {
    if (existing.has(q.name)) continue;
    await api.request("POST", "/api/saved-queries", { ...q, connectionId, connectionName: LAB_CONNECTION_NAME, isPublic: true });
    added++;
  }
  return added > 0 ? `added ${added} saved queries` : "saved queries already present";
}

async function savedList(api: ChouseApi): Promise<unknown[]> {
  const data = await api.request("GET", "/api/saved-queries");
  return Array.isArray(data) ? data : [];
}

/** Built-in dashboard templates plus the custom shop dashboard. */
export async function ensureDashboards(api: ChouseApi, connectionId: string): Promise<string> {
  const listed = await api.request("GET", "/api/dashboards");
  const existing = names(Array.isArray(listed) ? listed : [], "title");
  const scope = { kind: "only", connectionIds: [connectionId] };
  const added: string[] = [];
  for (const template of DASHBOARD_TEMPLATES) {
    if (existing.has(template.title)) continue;
    await api.request("POST", `/api/dashboards/templates/${template.id}/instantiate`, { connectionScope: scope });
    added.push(template.title);
  }
  if (!existing.has(SHOP_DASHBOARD)) {
    await api.request("POST", "/api/dashboards", shopDashboard(connectionId));
    added.push(SHOP_DASHBOARD);
  }
  return added.length > 0 ? `added ${added.join(", ")}` : "dashboards already present";
}

/** An enabled fleet threshold rule, unless one already exists (only one may be enabled). */
export async function ensureAlertRule(api: ChouseApi): Promise<string> {
  const rules = await api.request("GET", "/api/alerting/rules");
  const list = Array.isArray(rules) ? rules : [];
  if (list.some((r) => stringField(r, "sourceType") === "fleet_threshold" || stringField(r, "name") === ALERT_RULE)) {
    return "fleet alert rule already present";
  }
  await api.request("POST", "/api/alerting/rules", {
    name: ALERT_RULE,
    severity: "warning",
    enabled: true,
    sourceType: "fleet_threshold",
    config: { memoryPercent: 85, queryMemoryGb: 1, longQueryMin: 5, partsEtaMin: 60 },
    channelIds: [],
  });
  return `added "${ALERT_RULE}"`;
}

/** A daily report, run once now so its history is not empty. */
export async function ensureScheduledReport(api: ChouseApi, connectionId: string): Promise<string> {
  const jobs = arrayField(await api.request("GET", "/api/scheduled-queries"), "jobs");
  if (names(jobs).has(SCHEDULED_REPORT)) return "scheduled report already present";
  const job = await api.request("POST", "/api/scheduled-queries", {
    name: SCHEDULED_REPORT,
    description: "Yesterday's orders and revenue per country.",
    connectionId,
    query: "SELECT country, sum(orders) AS orders, sum(revenue) AS revenue FROM analytics.orders_daily WHERE day = yesterday() GROUP BY country ORDER BY revenue DESC",
    enabled: true,
    frequency: "daily",
    hour: 8,
    timezone: "UTC",
    outputMode: "none",
  });
  const id = stringField(job, "id") ?? stringField(objectField(job, "job"), "id");
  if (id) await api.request("POST", `/api/scheduled-queries/${encodeURIComponent(id)}/run`);
  return `added "${SCHEDULED_REPORT}"${id ? " and ran it once" : ""}`;
}

/** Two data-health promises: one that holds, and one that breaks on purpose so Data has an incident to show. */
export async function ensureDataHealth(api: ChouseApi, connectionId: string): Promise<string> {
  const promises = arrayField(await api.request("GET", "/api/data-health"), "promises");
  const existing = names(promises);
  const source = { sourceType: "table", databaseName: "shop", tableName: "orders_raw", eventTimeColumn: "created_at", eventTimeEncoding: "native" };
  const base = { connectionId, timezone: "UTC", enabled: true, frequency: "daily", hour: 8, runNow: true, breachAfter: 1, recoverAfter: 1 };
  const added: string[] = [];
  if (!existing.has(FRESHNESS_PROMISE)) {
    await api.request("POST", "/api/data-health", {
      ...base,
      name: FRESHNESS_PROMISE,
      description: "New orders land at least every 15 minutes (the lab ingests a batch every 30 seconds).",
      source,
      criticality: "important",
      checks: [
        { checkKey: "fresh_orders", name: "Newest order is under 15 minutes old", type: "freshness", severity: "critical", config: { eventTimeColumn: "created_at", maxAgeSeconds: 900 } },
        { checkKey: "has_orders", name: "Table is not empty", type: "row_count", severity: "warning", config: { min: 1 } },
      ],
    });
    added.push(FRESHNESS_PROMISE);
  }
  if (!existing.has(CURRENCY_PROMISE)) {
    await api.request("POST", "/api/data-health", {
      ...base,
      name: CURRENCY_PROMISE,
      description: "The shop only sells in euros. About one order in ten is in USD, so this promise breaks and opens an incident to investigate.",
      source: { ...source, rowFilter: "currency != 'EUR'" },
      criticality: "standard",
      checks: [
        { checkKey: "no_foreign_currency", name: "No orders outside EUR", type: "row_count", severity: "warning", config: { max: 0 } },
      ],
    });
    added.push(CURRENCY_PROMISE);
  }
  return added.length > 0 ? `added ${added.map((n) => `"${n}"`).join(", ")}` : "data-health promises already present";
}

/** Descriptions, owners and a metric for the sample tables (what AI and the catalog read). */
export async function ensureTableContext(api: ChouseApi, connectionId: string): Promise<string> {
  const tables: ReadonlyArray<{ database: string; table: string; body: Record<string, unknown> }> = [
    {
      database: "shop",
      table: "orders_raw",
      body: { description: "One row per order, as placed in the web shop. Append-only; a batch arrives every 30 seconds.", grain: "one row per order", owner: "Shop team", tags: ["orders", "raw"] },
    },
    {
      database: "shop",
      table: "customers",
      body: { description: "Customer master data. ReplacingMergeTree: read with FINAL for the latest version of each customer.", grain: "one row per customer", owner: "Shop team", tags: ["customers", "dimension"] },
    },
    {
      database: "analytics",
      table: "orders_daily",
      body: { description: "Orders and revenue per day and country, kept up to date by shop.mv_orders_agg.", grain: "one row per day and country", owner: "Analytics", insteadOf: "shop.orders_raw for daily totals", tags: ["orders", "rollup"] },
    },
  ];
  const query = `?connectionId=${encodeURIComponent(connectionId)}`;
  let described = 0;
  let metrics = 0;
  for (const t of tables) {
    const path = `/api/context/tables/${t.database}/${t.table}`;
    // Never overwrite context the visitor has written since.
    // 404 until CHouse UI's catalog first sees the table, a few seconds after
    // start: nothing is written yet, so the description can go in.
    const current = await api.request("GET", `${path}${query}`).catch((error: unknown) => {
      if (error instanceof LabError && error.status === 404) return null;
      throw error;
    });
    if (!objectField(current, "curated")) {
      await api.request("PUT", `${path}${query}`, t.body);
      described++;
    }
    if (t.table === "orders_raw" && !names(arrayField(current, "metrics")).has("revenue")) {
      await api.request("PUT", `${path}/metrics${query}`, {
        name: "revenue",
        expression: "sum(amount)",
        description: "Gross order value in the order's currency.",
        owner: "Shop team",
      });
      metrics++;
    }
  }
  return described + metrics > 0 ? `described ${described} tables, added ${metrics} metric` : "table context already present";
}

/** Names of the showcase steps, all optional in the loader's report. */
export const SHOWCASE_STEPS = ["team", "data access", "saved queries", "dashboards", "alert rule", "scheduled report", "data health", "table context"] as const;

/** Runs every showcase step and returns one result per area. */
export async function runShowcase(api: ChouseApi, connectionId: string, password: string): Promise<StepResult[]> {
  return [
    await runStep("team", () => ensureTeam(api, password)),
    await runStep("data access", () => ensureAnalystPolicy(api, connectionId)),
    await runStep("saved queries", () => ensureSavedQueries(api, connectionId)),
    await runStep("dashboards", () => ensureDashboards(api, connectionId)),
    await runStep("alert rule", () => ensureAlertRule(api)),
    await runStep("scheduled report", () => ensureScheduledReport(api, connectionId)),
    await runStep("data health", () => ensureDataHealth(api, connectionId)),
    await runStep("table context", () => ensureTableContext(api, connectionId)),
  ];
}
