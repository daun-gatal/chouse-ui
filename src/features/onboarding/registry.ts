import {
  ADMIN_ACCESS_PERMISSIONS,
  DATAOPS_ACCESS_PERMISSIONS,
  EXPLORER_ACCESS_PERMISSIONS,
  MONITORING_ACCESS_PERMISSIONS,
} from "@/lib/navAccess";
import { RBAC_PERMISSIONS } from "@/stores";

import type { OnboardingChapter, OnboardingEligibility, OnboardingStep } from "./types";

const p = RBAC_PERMISSIONS;

export const AUTHENTICATED_ROUTE_INVENTORY = [
  "/fleet",
  "/doctor/:reportId?",
  "/overview",
  "/monitoring/:tab?",
  "/dataops/:feature?/:sub?",
  "/explorer",
  "/admin/:tab?",
  "/admin/users/create",
  "/admin/users/edit/:userId",
  "/preferences",
] as const;

export const NON_GUIDED_ROUTE_INVENTORY = [
  "/",
  "/login",
  "/auth/sso/callback",
  "/login/sso-complete",
  "/explain-popout",
  "/logs",
  "/metrics",
  "/settings",
  "*",
] as const;

export const REQUIRED_ONBOARDING_SURFACES = [
  "shell.navigation", "shell.connection", "shell.command-palette", "shell.ai-chat", "shell.preferences",
  "fleet.nodes", "fleet.inventory", "fleet.trends", "fleet.exceptions", "fleet.alerts",
  "doctor.run", "doctor.history", "doctor.report", "doctor.schedule",
  "overview.status", "overview.quick-actions", "overview.quick-access", "overview.saved", "overview.activity",
  "explorer.navigation", "explorer.objects", "explorer.import", "explorer.workspace", "explorer.results",
  "explorer.table-info", "explorer.explain",
  "monitoring.live-queries", "monitoring.logs.queries", "monitoring.logs.patterns", "monitoring.logs.tables",
  "monitoring.logs.redash", "monitoring.logs.histogram", "monitoring.metrics.overview",
  "monitoring.metrics.performance", "monitoring.metrics.storage", "monitoring.metrics.merges",
  "monitoring.metrics.parts", "monitoring.metrics.errors", "monitoring.metrics.memory",
  "monitoring.metrics.cpu", "monitoring.metrics.zookeeper", "monitoring.metrics.network",
  "monitoring.parts.log", "monitoring.parts.projections", "monitoring.parts.skip-indexes",
  "monitoring.schema.nullable", "monitoring.schema.integers", "monitoring.schema.compression",
  "monitoring.cluster.mutations", "monitoring.cluster.replication", "monitoring.cluster.topology",
  "monitoring.cluster.inserts", "monitoring.cluster.ddl", "monitoring.cluster.simulator",
  "monitoring.errors.counters", "monitoring.errors.crashes",
  "dataops.scheduled.overview", "dataops.scheduled.jobs", "dataops.scheduled.wizard",
  "dataops.scheduled.runs", "dataops.scheduled.lineage", "dataops.scheduled.macros",
  "dataops.health.overview", "dataops.health.datasets", "dataops.health.promise-wizard",
  "dataops.health.detail", "dataops.health.evidence", "dataops.health.incidents",
  "admin.users", "admin.user-create", "admin.user-edit", "admin.roles", "admin.data-access",
  "admin.connections", "admin.clickhouse-users", "admin.clickhouse-roles", "admin.ai-models",
  "admin.sso", "admin.audit", "admin.alerting",
  "preferences.appearance", "preferences.identity", "preferences.connection",
  "preferences.data-access", "preferences.functional-access", "preferences.logout",
] as const;

type RequiredSurface = (typeof REQUIRED_ONBOARDING_SURFACES)[number];

function step(
  id: RequiredSurface,
  title: string,
  body: string,
  route: string,
  options: Omit<OnboardingStep, "id" | "title" | "body" | "route"> = {},
): OnboardingStep {
  return { id, title, body, route, ...options };
}

export const ONBOARDING_CHAPTERS: OnboardingChapter[] = [
  {
    id: "shell",
    title: "Navigate CHouse",
    summary: "Learn the dock, connection context, command palette, AI assistant, and personal settings.",
    estimatedMinutes: 3,
    steps: [
      step("shell.navigation", "Your product map", "The dock follows your permissions. Move it, switch between floating and sidebar modes, or hide it without losing your place.", "/overview", { target: "app-navigation" }),
      step("shell.connection", "Always know the active node", "The connection selector controls which ClickHouse node Explorer, Overview, and monitoring actions use. Verify it before running queries or changing objects.", "/overview", { target: "connection-selector" }),
      step("shell.command-palette", "Jump anywhere", "Press Ctrl or Command + K to navigate, open saved work, start a query, change dock mode, or find help.", "/overview", { target: "app-navigation" }),
      step("shell.ai-chat", "Ask with context", "The AI assistant can use permitted schema and operational context. Model availability and your AI permissions determine what it can do.", "/overview", { target: "ai-assistant", requiredAny: [p.AI_CHAT] }),
      step("shell.preferences", "Make the workspace yours", "Preferences shows identity, effective access, active ClickHouse details, theme, and result-row limits.", "/preferences", { target: "preferences-header" }),
    ],
  },
  {
    id: "fleet",
    title: "Operate the fleet",
    summary: "Read node health, fleet-wide trends, exceptions, alerts, and AI health reports.",
    estimatedMinutes: 5,
    requiredAny: [p.FLEET_VIEW, p.DOCTOR_VIEW],
    steps: [
      step("fleet.nodes", "Compare every node", "Multi-node fleets add health filters, search, sorting, and card or compact-row density controls. Open any node to make it the active connection.", "/fleet", { target: "fleet-controls", requiredAny: [p.FLEET_VIEW], requiresConnection: true }),
      step("fleet.inventory", "Understand fleet scale", "Inventory totals databases, tables, views, rows, and storage across reachable nodes.", "/fleet", { target: "fleet-inventory", requiredAny: [p.FLEET_VIEW], requiresConnection: true }),
      step("fleet.trends", "Choose the signal and window", "Compare memory, CPU, query volume, or replica lag over 1h, 6h, or 24h without losing live status.", "/fleet", { target: "fleet-trends", requiredAny: [p.FLEET_VIEW], requiresConnection: true }),
      step("fleet.exceptions", "Triage recent exceptions", "The exception feed consolidates node errors for the selected history window so recurring failures stand out.", "/fleet", { target: "fleet-exceptions", requiredAny: [p.FLEET_VIEW], requiresConnection: true }),
      step("fleet.alerts", "Separate active breaches from history", "The bell shows browser-side fleet thresholds and recent notifications. Shared notification channels and rules live in Admin → Alerting.", "/fleet", { target: "fleet-alerts", requiredAny: [p.FLEET_VIEW], requiresConnection: true }),
      step("doctor.run", "Run a bounded health check", "Choose model, nodes, and investigation window before starting. View-only users can read reports without running a scan.", "/doctor?guide=doctor-run", { target: "doctor-run", requiredAny: [p.DOCTOR_VIEW] }),
      step("doctor.history", "Return to prior evidence", "Health checks are durable and shareable. Browse history while another scan runs, or select reports for cleanup when permitted.", "/doctor?guide=doctor-history", { target: "doctor-history", requiredAny: [p.DOCTOR_VIEW] }),
      step("doctor.report", "Read facts before recommendations", "Reports separate node vitals, heavy queries, findings, and recommended actions. Confirm evidence before changing production.", "/doctor?guide=doctor-report", { target: "doctor-report", requiredAny: [p.DOCTOR_VIEW] }),
      step("doctor.schedule", "Automate health checks", "Daily, weekly, or monthly scans run server-side and save reports to history. Scheduling requires Doctor run permission and an enabled AI provider.", "/doctor?guide=doctor-schedule", { target: "doctor-schedule", requiredAny: [p.DOCTOR_RUN] }),
    ],
  },
  {
    id: "overview",
    title: "Use the cluster home",
    summary: "Turn connection status and recent work into the next useful action.",
    estimatedMinutes: 3,
    requiresConnection: true,
    steps: [
      step("overview.status", "Confirm cluster context", "The header and system summary tell you which node is active and whether it is ready before you act.", "/overview", { target: "overview-status" }),
      step("overview.quick-actions", "Start common work", "Create a query, import data, explore objects, or open query history from one launch area.", "/overview", { target: "overview-quick-actions" }),
      step("overview.quick-access", "Return to useful objects", "Favorites are deliberate pins; Recent records the tables you actually visited on this connection.", "/overview", { target: "overview-quick-access" }),
      step("overview.saved", "Reuse reviewed SQL", "Saved queries are scoped to the active connection. Opening one creates a workspace tab without overwriting current work.", "/overview", { target: "overview-saved-queries", requiredAny: [p.SAVED_QUERIES_VIEW] }),
      step("overview.activity", "See what just happened", "Recent activity summarizes successful and failed executions so you can continue an investigation quickly.", "/overview", { target: "overview-activity", requiredAny: [p.QUERY_HISTORY_VIEW, p.QUERY_HISTORY_VIEW_ALL] }),
    ],
  },
  {
    id: "explorer",
    title: "Explore data and write SQL",
    summary: "Navigate objects, import data, run safe queries, inspect results, and understand execution plans.",
    estimatedMinutes: 8,
    requiredAny: EXPLORER_ACCESS_PERMISSIONS,
    requiresConnection: true,
    steps: [
      step("explorer.navigation", "Find databases and saved work", "Use database search, pinned and recent objects, query history, and saved queries without leaving the workspace.", "/explorer", { target: "explorer-sidebar" }),
      step("explorer.objects", "Use object actions in context", "Database and table menus expose create, describe, alter, query, import, and drop actions according to RBAC permissions.", "/explorer", { target: "explorer-sidebar" }),
      step("explorer.import", "Import with a review boundary", "Upload CSV, TSV, or JSON; review inferred schema and sample data; adjust mappings and engine; then watch import progress.", "/explorer", { target: "explorer-sidebar", requiredAny: [p.TABLE_INSERT] }),
      step("explorer.workspace", "Work in durable tabs", "Open multiple SQL and table-info tabs. Run a selection or statement, format SQL, use completion, and save reusable queries.", "/explorer", { target: "workspace-tabs", requiredAny: [p.QUERY_EXECUTE] }),
      step("explorer.results", "Separate output from cost", "After a query runs, workspace tabs keep returned rows separate from Statistics such as time and data read, with Explain available when supported.", "/explorer", { target: "workspace-tabs", requiredAny: [p.QUERY_EXECUTE] }),
      step("explorer.table-info", "Inspect before querying", "Open a table information tab here to review its overview, schema, and bounded sample data before writing SQL.", "/explorer", { target: "workspace-tabs", requiredAny: [p.TABLE_VIEW] }),
      step("explorer.explain", "Read how ClickHouse executes", "From a SQL tab, request Explain to compare the plan, AST, optimized query, pipeline, cost, and visual layouts. Pop out dense plans when needed.", "/explorer", { target: "workspace-tabs", requiredAny: [p.QUERY_EXECUTE] }),
    ],
  },
  {
    id: "monitoring",
    title: "Investigate cluster behavior",
    summary: "Use every Monitoring view, from live work to logs, metrics, schema advice, cluster queues, and crashes.",
    estimatedMinutes: 12,
    requiredAny: MONITORING_ACCESS_PERMISSIONS,
    requiresConnection: true,
    steps: [
      step("monitoring.live-queries", "Live queries", "Watch active work, refresh cadence, resource use, and query details. Cancellation is permission-gated and always requires intent.", "/monitoring/live-queries", { target: "monitoring-section-live-queries", requiredAny: [p.LIVE_QUERIES_VIEW] }),
      step("monitoring.logs.queries", "Query executions", "Filter by time, outcome, user, and role; page through executions; open details or send SQL back to the workspace.", "/monitoring/logs?guide=queries", { target: "monitoring-logs-queries", requiredAny: [p.LOGS_VIEW] }),
      step("monitoring.logs.patterns", "Repeated query shapes", "Patterns groups equivalent SQL so frequent or expensive shapes become visible even when literals differ.", "/monitoring/logs?guide=patterns", { target: "monitoring-logs-patterns", requiredAny: [p.LOGS_VIEW] }),
      step("monitoring.logs.tables", "Hot tables", "By table attributes query count, duration, rows, bytes, and peak memory to the objects receiving the load.", "/monitoring/logs?guide=tables", { target: "monitoring-logs-tables", requiredAny: [p.LOGS_VIEW] }),
      step("monitoring.logs.redash", "Redash workload", "Group executions by Redash query ID and user to connect dashboard activity with database cost.", "/monitoring/logs?guide=redash", { target: "monitoring-logs-redash", requiredAny: [p.LOGS_VIEW] }),
      step("monitoring.logs.histogram", "Distribution, not just averages", "Plot duration, memory, rows, or bytes to spot long tails and choose useful drill-down ranges.", "/monitoring/logs?guide=histogram", { target: "monitoring-logs-histogram", requiredAny: [p.LOGS_VIEW] }),
      step("monitoring.metrics.overview", "Metrics overview", "Start with current health and the broad trend before opening a specialist metric panel.", "/monitoring/metrics?guide=overview", { target: "monitoring-metrics-overview", requiredAny: [p.METRICS_VIEW, p.METRICS_VIEW_ADVANCED] }),
      step("monitoring.metrics.performance", "Performance", "Compare throughput, latency, reads, inserts, and execution pressure over a common time range.", "/monitoring/metrics?guide=performance", { target: "monitoring-metrics-performance", requiredAny: [p.METRICS_VIEW_ADVANCED] }),
      step("monitoring.metrics.storage", "Storage", "Inspect disks, table footprint, and capacity pressure before storage becomes an outage.", "/monitoring/metrics?guide=storage", { target: "monitoring-metrics-storage", requiredAny: [p.METRICS_VIEW_ADVANCED] }),
      step("monitoring.metrics.merges", "Merges", "Relate background merge load to queue depth, throughput, and resource use.", "/monitoring/metrics?guide=merges", { target: "monitoring-metrics-merges", requiredAny: [p.METRICS_VIEW_ADVANCED] }),
      step("monitoring.metrics.parts", "Part pressure", "Track active parts and unhealthy growth that can degrade inserts and queries.", "/monitoring/metrics?guide=parts", { target: "monitoring-metrics-parts", requiredAny: [p.METRICS_VIEW_ADVANCED] }),
      step("monitoring.metrics.errors", "Metric errors", "Use error-rate metrics for trend context, then open the Errors page for counters and crash detail.", "/monitoring/metrics?guide=errors", { target: "monitoring-metrics-errors", requiredAny: [p.METRICS_VIEW_ADVANCED] }),
      step("monitoring.metrics.memory", "Memory", "Separate server memory categories, caches, and query pressure before choosing a response.", "/monitoring/metrics?guide=memory", { target: "monitoring-metrics-memory", requiredAny: [p.METRICS_VIEW_ADVANCED] }),
      step("monitoring.metrics.cpu", "CPU", "Compare load and utilization with query and merge activity instead of treating CPU as an isolated signal.", "/monitoring/metrics?guide=cpu", { target: "monitoring-metrics-cpu", requiredAny: [p.METRICS_VIEW_ADVANCED] }),
      step("monitoring.metrics.zookeeper", "ZooKeeper", "Inspect coordination health and latency where replicated clusters depend on Keeper or ZooKeeper.", "/monitoring/metrics?guide=zookeeper", { target: "monitoring-metrics-zookeeper", requiredAny: [p.METRICS_VIEW_ADVANCED] }),
      step("monitoring.metrics.network", "Network", "Read receive/send throughput and connection behavior alongside distributed-query pressure.", "/monitoring/metrics?guide=network", { target: "monitoring-metrics-network", requiredAny: [p.METRICS_VIEW_ADVANCED] }),
      step("monitoring.parts.log", "Part log", "Review MergeTree part events, merges, mutations, and movements with adjustable pagination.", "/monitoring/parts?guide=log", { target: "monitoring-parts-log", requiredAny: [p.PARTS_VIEW] }),
      step("monitoring.parts.projections", "Projections", "Inventory precomputed reorder and aggregate structures and verify where they can accelerate queries.", "/monitoring/parts?guide=projections", { target: "monitoring-parts-projections", requiredAny: [p.PARTS_VIEW] }),
      step("monitoring.parts.skip-indexes", "Skip indexes", "Review data-skipping indexes and connect them to filter patterns rather than adding them blindly.", "/monitoring/parts?guide=skipindex", { target: "monitoring-parts-skipindex", requiredAny: [p.PARTS_VIEW] }),
      step("monitoring.schema.nullable", "Nullable columns", "Find nullable columns whose storage and query semantics deserve review.", "/monitoring/schema?guide=nullable", { target: "monitoring-schema-nullable", requiredAny: [p.SCHEMA_ADVISOR_VIEW] }),
      step("monitoring.schema.integers", "Oversized integers", "Find integer types wider than observed values require and evaluate safe schema changes.", "/monitoring/schema?guide=oversized", { target: "monitoring-schema-oversized", requiredAny: [p.SCHEMA_ADVISOR_VIEW] }),
      step("monitoring.schema.compression", "Compression", "Compare codecs and compression outcomes before recommending changes to large columns.", "/monitoring/schema?guide=compression", { target: "monitoring-schema-compression", requiredAny: [p.SCHEMA_ADVISOR_VIEW] }),
      step("monitoring.cluster.mutations", "Mutations", "Track active, completed, failing, and killed mutations and inspect their progress.", "/monitoring/cluster?guide=mutations", { target: "monitoring-cluster-mutations", requiredAny: [p.CLUSTER_VIEW] }),
      step("monitoring.cluster.replication", "Replication queue", "Use queue age and failure detail to separate transient lag from stuck replication.", "/monitoring/cluster?guide=replication", { target: "monitoring-cluster-replication", requiredAny: [p.CLUSTER_VIEW] }),
      step("monitoring.cluster.topology", "Topology", "Understand shards, replicas, and reachability before investigating distributed behavior.", "/monitoring/cluster?guide=topology", { target: "monitoring-cluster-topology", requiredAny: [p.CLUSTER_VIEW] }),
      step("monitoring.cluster.inserts", "Insert backlog", "Watch delayed or distributed inserts and identify which destination is falling behind.", "/monitoring/cluster?guide=distribution", { target: "monitoring-cluster-distribution", requiredAny: [p.CLUSTER_VIEW] }),
      step("monitoring.cluster.ddl", "DDL queue", "Inspect distributed DDL status per host and distinguish pending execution from failure.", "/monitoring/cluster?guide=ddl", { target: "monitoring-cluster-ddl", requiredAny: [p.CLUSTER_VIEW] }),
      step("monitoring.cluster.simulator", "DDL simulator", "Preview distributed DDL impact and affected nodes before running production changes.", "/monitoring/cluster?guide=simulator", { target: "monitoring-cluster-simulator", requiredAny: [p.CLUSTER_VIEW] }),
      step("monitoring.errors.counters", "Error counters", "Compare server error codes and counts to see which failures are increasing.", "/monitoring/errors?guide=errors", { target: "monitoring-errors-errors", requiredAny: [p.ERRORS_VIEW] }),
      step("monitoring.errors.crashes", "Crashes", "Review crash records and stack context separately from ordinary query exceptions.", "/monitoring/errors?guide=crashes", { target: "monitoring-errors-crashes", requiredAny: [p.ERRORS_VIEW] }),
    ],
  },
  {
    id: "dataops",
    title: "Automate data operations",
    summary: "Schedule reliable jobs and define measurable Data Health promises.",
    estimatedMinutes: 10,
    requiredAny: DATAOPS_ACCESS_PERMISSIONS,
    steps: [
      step("dataops.scheduled.overview", "Scheduled Queries overview", "Start with job state, run outcomes, and schedule health before opening one job.", "/dataops/scheduled-queries/overview", { target: "dataops-scheduled-overview", requiredAny: [p.SCHEDULED_QUERIES_VIEW] }),
      step("dataops.scheduled.jobs", "Jobs and detail", "Search jobs, open definitions, pause or run when permitted, and keep run evidence beside configuration.", "/dataops/scheduled-queries/jobs", { target: "dataops-scheduled-jobs", requiredAny: [p.SCHEDULED_QUERIES_VIEW] }),
      step("dataops.scheduled.wizard", "Create with five review points", "Use New job to review Source, Schedule, Actions, Output, and Review before activation.", "/dataops/scheduled-queries/jobs", { target: "dataops-scheduled-create", requiredAny: [p.SCHEDULED_QUERIES_EDIT], requiresConnection: true }),
      step("dataops.scheduled.runs", "Run history", "Open a job to filter bounded history, compare outcomes, and inspect failure evidence before retrying.", "/dataops/scheduled-queries/jobs", { target: "dataops-scheduled-jobs", requiredAny: [p.SCHEDULED_QUERIES_VIEW] }),
      step("dataops.scheduled.lineage", "Runtime lineage", "Open a job to trace source and destination objects, including column-level edges where evidence is available.", "/dataops/scheduled-queries/jobs", { target: "dataops-scheduled-jobs", requiredAny: [p.SCHEDULED_QUERIES_VIEW] }),
      step("dataops.scheduled.macros", "Schedule macros", "New job documents deterministic time-window macros for reruns and recovery slot boundaries.", "/dataops/scheduled-queries/jobs", { target: "dataops-scheduled-create", requiredAny: [p.SCHEDULED_QUERIES_EDIT], requiresConnection: true }),
      step("dataops.health.overview", "Data Health overview", "Read protected datasets, current health, open incidents, and evaluation recency as one system.", "/dataops/data-health/overview", { target: "dataops-health-overview", requiredAny: [p.DATA_HEALTH_VIEW] }),
      step("dataops.health.datasets", "Protected datasets", "Search and filter promises, open detail, pause evaluation, or edit expectations when permitted.", "/dataops/data-health/datasets", { target: "dataops-health-datasets", requiredAny: [p.DATA_HEALTH_VIEW] }),
      step("dataops.health.promise-wizard", "Define health in three steps", "Use New promise to choose a table or read-only query, define checks and cadence, and review the generated monitor.", "/dataops/data-health/datasets", { target: "dataops-health-create", requiredAny: [p.DATA_HEALTH_EDIT], requiresConnection: true }),
      step("dataops.health.detail", "Promise detail", "Open a protected dataset to compare observed values with the expected bounds for every check.", "/dataops/data-health/datasets", { target: "dataops-health-datasets", requiredAny: [p.DATA_HEALTH_VIEW] }),
      step("dataops.health.evidence", "Inspect evidence", "Open a protected dataset to inspect bounded diagnostic evidence; an AI explanation is not the underlying measurement.", "/dataops/data-health/datasets", { target: "dataops-health-datasets", requiredAny: [p.DATA_HEALTH_VIEW] }),
      step("dataops.health.incidents", "Incident lifecycle", "Separate active from recovered incidents and return to the affected promise for evidence and remediation.", "/dataops/data-health/incidents", { target: "dataops-health-incidents", requiredAny: [p.DATA_HEALTH_VIEW] }),
    ],
  },
  {
    id: "admin",
    title: "Administer CHouse safely",
    summary: "Configure identities, access, connections, AI, SSO, audit retention, and alert delivery.",
    estimatedMinutes: 12,
    requiredAny: ADMIN_ACCESS_PERMISSIONS,
    steps: [
      step("admin.users", "CHouse users", "Search and change layout, create accounts, manage status, and use row actions without confusing CHouse identities with ClickHouse users.", "/admin/users", { target: "admin-section-users", requiredAny: [p.USERS_VIEW, p.USERS_CREATE] }),
      step("admin.user-create", "Create a user", "Set identity and initial roles, deliver the generated or chosen password securely, and review the success summary.", "/admin/users/create", { target: "admin-user-form", requiredAny: [p.USERS_CREATE] }),
      step("admin.user-edit", "Edit details, roles, and security", "Open a user row to separate profile details, role assignment, and security actions such as reset password and session revocation.", "/admin/users", { target: "admin-section-users", requiredAny: [p.USERS_UPDATE] }),
      step("admin.roles", "Roles and permissions", "Create or edit a role, search the permission tree, and review effective scope before assigning users.", "/admin/roles", { target: "admin-section-roles", requiredAny: [p.ROLES_VIEW] }),
      step("admin.data-access", "Database and table policies", "Attach allow/deny rules to roles and keep object scope separate from functional permissions.", "/admin/data-access", { target: "admin-section-data-access", requiredAny: [p.DATA_ACCESS_VIEW] }),
      step("admin.connections", "ClickHouse connections", "Add, test, edit, activate, and choose defaults. Credentials stay server-side and never appear in onboarding state.", "/admin/connections", { target: "admin-section-connections", requiredAny: [p.CONNECTIONS_VIEW] }),
      step("admin.clickhouse-users", "Native ClickHouse users", "Use Identity, Roles, and Review to create database accounts, then sync or inspect their grants.", "/admin/clickhouse-users", { target: "admin-section-clickhouse-users", requiredAny: [p.CH_USERS_VIEW] }),
      step("admin.clickhouse-roles", "Native ClickHouse roles", "Use Details, Privileges, Databases & tables, and Review to construct scoped native grants.", "/admin/clickhouse-roles", { target: "admin-section-clickhouse-roles", requiredAny: [p.CH_ROLES_VIEW] }),
      step("admin.ai-models", "Providers, base models, configurations", "Configure credentials at provider level, model capabilities and parameters at base-model level, and user-facing deployments as configurations. Test before enabling AI workflows.", "/admin/ai-models", { target: "admin-section-ai-models", requiredAny: [p.AI_MODELS_VIEW] }),
      step("admin.sso", "Single sign-on", "Configure global behavior and provider mappings, test the provider, and preserve break-glass access before disabling password login.", "/admin/sso", { target: "admin-section-sso", requiredAny: [p.SSO_VIEW] }),
      step("admin.audit", "Audit history", "Filter security and administration events, export within permission, and prune only with an explicit retention decision.", "/admin/audit", { target: "admin-section-audit", requiredAny: [p.AUDIT_VIEW] }),
      step("admin.alerting", "Channels, rules, and recent alerts", "Separate delivery destinations from detection rules, test channels, attach rules, and use recent events to validate behavior.", "/admin/alerting", { target: "admin-section-alerting", requiredAny: [p.ALERTING_VIEW] }),
    ],
  },
  {
    id: "preferences",
    title: "Understand your access and preferences",
    summary: "Review personal settings and the exact capabilities available to your account.",
    estimatedMinutes: 3,
    steps: [
      step("preferences.identity", "Identity and roles", "Confirm your CHouse identity and assigned roles. Roles grant functions; data policies control which objects those functions can reach.", "/preferences", { target: "preferences-identity" }),
      step("preferences.connection", "Active ClickHouse node", "Review endpoint and version for the current database session before sharing diagnostics.", "/preferences", { target: "preferences-connection" }),
      step("preferences.data-access", "Effective data access", "Inspect resolved connection, database, and table rules instead of guessing access from a role name.", "/preferences", { target: "preferences-data-access" }),
      step("preferences.functional-access", "Effective functional permissions", "Review the concrete operations your account can perform across CHouse.", "/preferences", { target: "preferences-functional-access" }),
      step("preferences.appearance", "Appearance and query limits", "Choose automatic, system, light, or dark theme and set the default maximum result rows for the SQL editor.", "/preferences", { target: "preferences-appearance" }),
      step("preferences.logout", "End the session", "Log out when switching operators or leaving a shared workstation. Session state and user-specific workspace data are cleaned up.", "/preferences", { target: "preferences-logout" }),
    ],
  },
];

function hasAnyPermission(required: string[] | undefined, permissions: Set<string>): boolean {
  return required === undefined || required.length === 0 || required.some((permission) => permissions.has(permission));
}

export function getEligibleSteps(
  chapter: OnboardingChapter,
  eligibility: OnboardingEligibility,
): OnboardingStep[] {
  const permissions = new Set(eligibility.permissions);
  if (!hasAnyPermission(chapter.requiredAny, permissions)) return [];
  if (chapter.requiresConnection && !eligibility.hasConnection) return [];
  return chapter.steps.filter((candidate) =>
    hasAnyPermission(candidate.requiredAny, permissions)
      && (!candidate.requiresConnection || eligibility.hasConnection),
  );
}

export function getEligibleChapters(eligibility: OnboardingEligibility): OnboardingChapter[] {
  return ONBOARDING_CHAPTERS
    .map((chapter) => ({ ...chapter, steps: getEligibleSteps(chapter, eligibility) }))
    .filter((chapter) => chapter.steps.length > 0);
}

export function findChapter(chapterId: string): OnboardingChapter | undefined {
  return ONBOARDING_CHAPTERS.find((chapter) => chapter.id === chapterId);
}
