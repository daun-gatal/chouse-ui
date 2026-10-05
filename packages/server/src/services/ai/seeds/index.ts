/**
 * Built-in registry rows (ADR 0019 §8): harnesses, skills, agents and feature
 * bindings.
 *
 * Seed data only — the runtime reads the registry, never this module. The
 * startup seed sync (registry/seedSync.ts) inserts missing rows and upgrades
 * built-in rows an administrator has not customized. Every structured-feature
 * agent reproduces the pre-registry capability exactly (prompt, task framing,
 * tools in order, skills, harness, tuning); registry/parity.test.ts proves it.
 */

import { createHash } from "crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentKind, AgentTuning, GeneralPurposeConfig, SkillLinkMode } from "../registry/types";
import {
  CHAT_PROMPT,
  DEBUGGER_PROMPT,
  ERROR_DIAGNOSE_PROMPT,
  EVALUATOR_PROMPT,
  EVIDENCE_PROMPTS,
  FLEET_DOCTOR_PROMPT,
  LOG_OPTIMIZER_PROMPT,
  OPTIMIZER_PROMPT,
  PARTS_DIAGNOSE_PROMPT,
  SCHEMA_DIAGNOSE_PROMPT,
} from "./prompts";
import {
  ACCESS_AUDITOR_PROMPT,
  CHOUSE_ADMIN_PROMPT,
  OPERATIONS_ANALYST_PROMPT,
  PLATFORM_AUDITOR_PROMPT,
  ROUTER_PROMPT,
} from "./chatPrompts";

const SKILLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "skills");

// ============================================
// Seed shapes
// ============================================

export interface SeedHarness {
  id: string;
  slug: string;
  name: string;
  description: string;
  excludedTools: string[];
  generalPurpose: GeneralPurposeConfig;
  promptSuffix: string | null;
  toolDescriptionOverrides: Record<string, string>;
}

export interface SeedSkill {
  id: string;
  name: string;
  path: string;
  description: string;
  skillMd: string;
  files: Record<string, string>;
}

export interface SeedSkillLink {
  /** Skill name (resolved to the seeded skill id). */
  skill: string;
  mode: SkillLinkMode;
  pinnedFile: string | null;
}

export interface SeedAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: AgentKind;
  systemPrompt: string;
  taskTemplate: string | null;
  harness: string;
  tuning: AgentTuning;
  requiredPermissions: string[];
  tools: string[];
  skills: SeedSkillLink[];
  /** Child agent slugs. */
  subagents: string[];
}

export function seedHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

// ============================================
// Harnesses
// ============================================

const ASYNC_TASK_TOOLS = ["start_async_task", "check_async_task", "update_async_task", "cancel_async_task", "list_async_tasks"];

export const SEED_HARNESSES: SeedHarness[] = [
  {
    id: "builtin-harness-focused",
    slug: "focused",
    name: "Focused",
    description: "Tool-first and bounded: no planning, no delegation, no filesystem beyond reading skills. Every built-in AI feature and the ClickHouse chat agent use it.",
    excludedTools: ["task", "write_todos", "ls", "write_file", "edit_file", "glob", "grep", "execute", ...ASYNC_TASK_TOOLS],
    generalPurpose: { enabled: false },
    promptSuffix: "For Chouse AI runs, use the concrete tools directly. Do not plan or delegate work to subagents; each capability already has focused instructions and a bounded tool set.",
    toolDescriptionOverrides: {},
  },
  {
    id: "builtin-harness-delegating",
    slug: "delegating",
    name: "Delegating",
    description: "For agents with subagents: keeps the task tool so the agent can delegate, reads skills, and hides planning and file-writing tools.",
    excludedTools: ["write_todos", "ls", "write_file", "edit_file", "glob", "grep", "execute", ...ASYNC_TASK_TOOLS],
    generalPurpose: { enabled: false },
    promptSuffix: "Delegate each focused sub-question to the matching subagent with the task tool and give it the full context it needs; subagents do not see this conversation. Use your own tools directly for simple lookups.",
    toolDescriptionOverrides: {},
  },
  {
    id: "builtin-harness-router",
    slug: "router",
    name: "Router",
    description: "Only the task tool: the agent routes requests to its subagents and combines their answers.",
    excludedTools: ["write_todos", "ls", "read_file", "write_file", "edit_file", "glob", "grep", "execute", ...ASYNC_TASK_TOOLS],
    generalPurpose: { enabled: false },
    promptSuffix: null,
    toolDescriptionOverrides: {},
  },
];

// ============================================
// Skills (read from seeds/skills)
// ============================================

function frontMatterField(skillMd: string, field: string): string {
  const match = /^---\s*\n([\s\S]*?)\n---/.exec(skillMd);
  if (!match) return "";
  const line = match[1].split("\n").find((l) => l.startsWith(`${field}:`));
  return line ? line.slice(field.length + 1).trim() : "";
}

function loadSeedSkills(): SeedSkill[] {
  const skills: SeedSkill[] = [];
  for (const group of readdirSync(SKILLS_DIR).sort()) {
    const groupDir = path.join(SKILLS_DIR, group);
    if (!statSync(groupDir).isDirectory()) continue;
    for (const dir of readdirSync(groupDir).sort()) {
      const skillDir = path.join(groupDir, dir);
      const skillMdPath = path.join(skillDir, "SKILL.md");
      if (!statSync(skillDir).isDirectory()) continue;
      const skillMd = readFileSync(skillMdPath, "utf-8");
      const files: Record<string, string> = {};
      for (const file of readdirSync(skillDir).sort()) {
        if (file === "SKILL.md") continue;
        files[file] = readFileSync(path.join(skillDir, file), "utf-8");
      }
      const name = frontMatterField(skillMd, "name");
      skills.push({ id: `builtin-skill-${name}`, name, path: `${group}/${dir}`, description: frontMatterField(skillMd, "description"), skillMd, files });
    }
  }
  return skills;
}

export const SEED_SKILLS: SeedSkill[] = loadSeedSkills();

/** Every built-in skill, progressively disclosed — what each pre-registry agent was offered. */
const ALL_SKILLS: SeedSkillLink[] = SEED_SKILLS.map((s) => ({ skill: s.name, mode: "progressive", pinnedFile: null }));

const PINNED_PLAYBOOK: SeedSkillLink = { skill: "clickhouse-playbook", mode: "pinned", pinnedFile: "reference.md" };

// ============================================
// Agents
// ============================================

const CORE_SESSION_TOOLS = [
  "list_databases", "list_tables", "get_table_schema", "get_table_ddl", "get_table_size", "get_table_sample",
  "run_select_query", "explain_query", "get_database_info", "get_running_queries", "get_server_info",
  "search_columns", "analyze_query", "validate_sql", "export_query_result", "get_slow_queries",
];

const EVIDENCE_TASK = "<evidence>\n{{ctx.evidence}}\n</evidence>";

function featureAgent(spec: Omit<SeedAgent, "kind" | "harness" | "requiredPermissions" | "subagents" | "skills"> & { skills?: SeedSkillLink[] }): SeedAgent {
  return { kind: "agent", harness: "focused", requiredPermissions: [], subagents: [], skills: spec.skills ?? ALL_SKILLS, ...spec };
}

function evidenceAgent(id: string, slug: string, name: string, description: string, feature: string, tuning: AgentTuning, tools: string[] = []): SeedAgent {
  return featureAgent({ id, slug, name, description, systemPrompt: EVIDENCE_PROMPTS[feature], taskTemplate: EVIDENCE_TASK, tuning, tools });
}

const FLEET_TUNING: AgentTuning = { stepBudget: 8, maxOutputTokens: 8000 };

export const SEED_AGENTS: SeedAgent[] = [
  // --- SQL editor ---------------------------------------------------------------------
  featureAgent({
    id: "builtin-agent-sql-optimizer", slug: "sql-optimizer", name: "SQL Optimizer",
    description: "Rewrites a SELECT for speed and memory from its DDL and EXPLAIN plan (SQL editor › Optimize).",
    systemPrompt: OPTIMIZER_PROMPT,
    taskTemplate: "Optimize this ClickHouse SQL query:\n\n```sql\n{{ctx.query}}\n```\n\nUse your tools to:\n1. Follow the native `query-optimizer` skill instructions.\n2. Use the `clickhouse-playbook` and `types-codecs-compression` reference skills when relevant.\n3. Fetch the DDL for all tables referenced in the query using `get_table_ddl`.\n4. Run `explain_query` to understand the current execution plan.\n5. Produce the optimized query as a JSON response matching the exact schema specified in the optimizer skill.{{#ctx.additionalPrompt}}\n\nAdditional instructions from the user:\n{{ctx.additionalPrompt}}{{/ctx.additionalPrompt}}",
    tools: CORE_SESSION_TOOLS, tuning: { stepBudget: 10 },
  }),
  featureAgent({
    id: "builtin-agent-sql-debugger", slug: "sql-debugger", name: "SQL Debugger",
    description: "Explains why a query failed and returns a validated fix (SQL editor › Debug).",
    systemPrompt: DEBUGGER_PROMPT,
    taskTemplate: "Debug this failed ClickHouse SQL query:\n\n```sql\n{{ctx.query}}\n```\n\nError:\n```\n{{ctx.error}}\n```\n\nUse your tools to:\n1. Follow the native `query-debugger` skill instructions.\n2. Use the `clickhouse-playbook` reference skill when the fix is performance-related.\n3. Fetch the DDL for tables referenced in the query using `get_table_ddl`.\n4. Validate the corrected query with `validate_sql`.\n5. Produce the fixed query as a JSON response matching the exact schema specified in the debugger skill.{{#ctx.additionalPrompt}}\n\nAdditional instructions from the user:\n{{ctx.additionalPrompt}}{{/ctx.additionalPrompt}}",
    tools: CORE_SESSION_TOOLS, tuning: { stepBudget: 10 },
  }),
  featureAgent({
    id: "builtin-agent-query-evaluator", slug: "query-evaluator", name: "Query Evaluator",
    description: "Quick, silent pre-screen: is this query worth optimizing? (SQL editor).",
    systemPrompt: EVALUATOR_PROMPT,
    taskTemplate: "Evaluate this query:\n```sql\n{{ctx.query}}\n```",
    tools: ["analyze_query", "get_table_ddl", "get_table_schema"], tuning: { stepBudget: 4 },
  }),
  // --- Doctor / diagnostics -----------------------------------------------------------------
  featureAgent({
    id: "builtin-agent-log-query-optimizer", slug: "log-query-optimizer", name: "Heavy Query Optimizer",
    description: "Optimizes one heavy query picked from the Query Logs, proven with a before→after EXPLAIN estimate.",
    systemPrompt: LOG_OPTIMIZER_PROMPT,
    taskTemplate: "Node id: \"{{ctx.node.id}}\" (name: {{ctx.node.name}}). Observed peak memory: {{ctx.peakMemory}}. Investigate this query's tables with query_node (connectionId=\"{{ctx.node.id}}\") and produce the optimized version.\n\n```sql\n{{ctx.query}}\n```",
    tools: ["query_node"], tuning: { stepBudget: 8, maxOutputTokens: 16000 },
    skills: [...ALL_SKILLS, PINNED_PLAYBOOK],
  }),
  featureAgent({
    id: "builtin-agent-error-diagnostician", slug: "error-diagnostician", name: "Error Diagnostician",
    description: "Explains one server error from system.errors and gives a concrete fix.",
    systemPrompt: ERROR_DIAGNOSE_PROMPT,
    taskTemplate: "Node id: \"{{ctx.node.id}}\" (name: {{ctx.node.name}}). Diagnose this ClickHouse error and give a solution.\n\nCode: {{ctx.error.code}}\nName: {{ctx.error.name}}\nLast message: {{ctx.error.message}}\n\nInvestigate with query_node (connectionId=\"{{ctx.node.id}}\") if useful, then return the structured diagnosis.",
    tools: ["query_node"], tuning: FLEET_TUNING, skills: [...ALL_SKILLS, PINNED_PLAYBOOK],
  }),
  featureAgent({
    id: "builtin-agent-parts-diagnostician", slug: "parts-diagnostician", name: "Parts Diagnostician",
    description: "Diagnoses part and partition health of one MergeTree table.",
    systemPrompt: PARTS_DIAGNOSE_PROMPT,
    taskTemplate: "Node id: \"{{ctx.node.id}}\" (name: {{ctx.node.name}}). Diagnose the part/partition health of table `{{ctx.database}}.{{ctx.table}}` and give a solution. Investigate with query_node (connectionId=\"{{ctx.node.id}}\"), then return the structured diagnosis.",
    tools: ["query_node"], tuning: FLEET_TUNING, skills: [...ALL_SKILLS, PINNED_PLAYBOOK],
  }),
  featureAgent({
    id: "builtin-agent-schema-diagnostician", slug: "schema-diagnostician", name: "Schema Diagnostician",
    description: "Turns one Schema Advisor finding into a concrete ALTER TABLE fix.",
    systemPrompt: SCHEMA_DIAGNOSE_PROMPT,
    taskTemplate: "Node id: \"{{ctx.node.id}}\" (name: {{ctx.node.name}}). Database: {{ctx.database}}. Table: {{ctx.table}}. Column: `{{ctx.column}}` (type: {{ctx.columnType}}). Issue category: {{ctx.category}}.\n{{ctx.sizeLine}}\nInvestigate with query_node (connectionId=\"{{ctx.node.id}}\") and produce the structured diagnosis with a concrete ALTER TABLE fix.",
    tools: ["query_node"], tuning: FLEET_TUNING, skills: [...ALL_SKILLS, PINNED_PLAYBOOK],
  }),
  featureAgent({
    id: "builtin-agent-fleet-doctor", slug: "fleet-doctor", name: "Fleet Doctor",
    description: "Reviews every node's health, deep-dives heavy queries and writes the Doctor report.",
    systemPrompt: FLEET_DOCTOR_PROMPT,
    taskTemplate: "Current ClickHouse fleet overview (one object per node). Investigation window: last {{ctx.hours}} hours (the `recentHeavyQueries` field covers this window; scope your system.query_log tool queries to it too). Investigate and produce the structured health report.\n\n```json\n{{ctx.overview}}\n```",
    tools: ["query_node"], tuning: { stepBudget: 12, maxOutputTokens: 16000 },
  }),
  // --- DataOps ----------------------------------------------------------------------------
  evidenceAgent("builtin-agent-scheduled-query-drafter", "scheduled-query-drafter", "Scheduled Query Drafter", "Turns an operator's intent into an editable scheduled query draft.", "draft-scheduled-query",
    { stepBudget: 7, maxOutputTokens: 4500 }, ["list_databases", "list_tables", "get_table_schema", "get_table_ddl", "analyze_query"]),
  evidenceAgent("builtin-agent-scheduled-query-reviewer", "scheduled-query-reviewer", "Scheduled Query Reviewer", "Preflight risk review of a scheduled query before it is saved.", "assess-scheduled-query",
    { stepBudget: 6, maxOutputTokens: 3000 }, ["analyze_query", "validate_sql", "get_table_schema", "get_table_ddl", "explain_query"]),
  evidenceAgent("builtin-agent-scheduled-query-briefer", "scheduled-query-briefer", "Scheduled Query Briefer", "Operational brief for one scheduled query.", "summarize-scheduled-query",
    { stepBudget: 3, maxOutputTokens: 2500 }),
  evidenceAgent("builtin-agent-scheduled-run-investigator", "scheduled-run-investigator", "Scheduled Run Investigator", "Ranks the likely causes of one failed or slow scheduled run.", "diagnose-scheduled-run",
    { stepBudget: 5, maxOutputTokens: 4000 }),
  evidenceAgent("builtin-agent-recovery-planner", "recovery-planner", "Recovery Planner", "Assesses a bounded backfill / recovery plan before it runs.", "plan-scheduled-recovery",
    { stepBudget: 3, maxOutputTokens: 2500 }),
  evidenceAgent("builtin-agent-health-promise-advisor", "health-promise-advisor", "Health Promise Advisor", "Recommends Data Health checks for one table from bounded aggregates.", "recommend-health-promise",
    { stepBudget: 8, maxOutputTokens: 5000 }, ["get_table_schema", "get_table_ddl", "run_bounded_aggregate"]),
  evidenceAgent("builtin-agent-data-health-briefer", "data-health-briefer", "Data Health Briefer", "Operational brief for one protected dataset.", "summarize-data-health",
    { stepBudget: 3, maxOutputTokens: 2500 }),
  evidenceAgent("builtin-agent-health-incident-investigator", "health-incident-investigator", "Health Incident Investigator", "Diagnoses a Data Health incident: monitor failure or bad data.", "diagnose-health-incident",
    { stepBudget: 5, maxOutputTokens: 4000 }),
  evidenceAgent("builtin-agent-health-promise-tuner", "health-promise-tuner", "Health Promise Tuner", "Tunes noisy or insensitive Data Health checks from their history.", "tune-health-promise",
    { stepBudget: 4, maxOutputTokens: 3500 }),
  evidenceAgent("builtin-agent-incident-correlator", "incident-correlator", "Incident Correlator", "Groups Data Health incidents that share a credible cause.", "correlate-health-incidents",
    { stepBudget: 4, maxOutputTokens: 3000 }),
  // --- Observe ----------------------------------------------------------------------------
  evidenceAgent("builtin-agent-incident-explainer", "incident-explainer", "Incident Explainer", "Narrates an incident's stored root-cause chain and drafts catalog fixes.", "explain-incident",
    { stepBudget: 3, maxOutputTokens: 3000 }),
  evidenceAgent("builtin-agent-watcher-compiler", "watcher-compiler", "Watcher Compiler", "Compiles a sentence into one Data Health check.", "compile-watcher",
    { stepBudget: 3, maxOutputTokens: 2500 }),
  evidenceAgent("builtin-agent-table-context-drafter", "table-context-drafter", "Table Context Drafter", "Drafts a table's curated context from metadata and an aggregate-only profile.", "draft-table-context",
    { stepBudget: 3, maxOutputTokens: 2500 }),
  // --- Chat -------------------------------------------------------------------------------
  {
    id: "builtin-agent-clickhouse-data", slug: "clickhouse-data", name: "ClickHouse Data",
    description: "Answers questions about ClickHouse data: databases, tables, columns, SQL, query performance, server state and charts.",
    kind: "agent", systemPrompt: CHAT_PROMPT, taskTemplate: null, harness: "focused", tuning: { stepBudget: 12 },
    requiredPermissions: [], tools: [...CORE_SESSION_TOOLS, "render_chart", "generate_query", "optimize_query"], skills: ALL_SKILLS, subagents: [],
  },
  {
    id: "builtin-agent-chouse-admin", slug: "chouse-admin", name: "CHouse Admin",
    description: "Answers read-only questions about CHouse itself: users, roles, permissions, data access, connections, scheduled jobs, data health, alerts, incidents, Doctor reports, AI models, external agents and the audit log.",
    kind: "agent", systemPrompt: CHOUSE_ADMIN_PROMPT, taskTemplate: null, harness: "delegating", tuning: { stepBudget: 10 },
    requiredPermissions: [], tools: ["whoami"], skills: [], subagents: ["access-auditor", "operations-analyst", "platform-auditor"],
  },
  {
    id: "builtin-agent-access-auditor", slug: "access-auditor", name: "Access Auditor",
    description: "Users, roles, permissions, data access policies, personal access tokens, SSO, and ClickHouse users and roles.",
    kind: "agent", systemPrompt: ACCESS_AUDITOR_PROMPT, taskTemplate: null, harness: "focused", tuning: { stepBudget: 8 },
    requiredPermissions: [], skills: [], subagents: [],
    tools: ["whoami", "list_users", "get_user", "list_roles", "get_role", "list_permissions", "list_data_access_policies", "list_my_access_tokens", "list_clickhouse_users", "list_clickhouse_roles", "get_sso_settings"],
  },
  {
    id: "builtin-agent-operations-analyst", slug: "operations-analyst", name: "Operations Analyst",
    description: "Scheduled jobs and runs, Data Health promises and incidents, alerting, observability incidents, Doctor reports and fleet health.",
    kind: "agent", systemPrompt: OPERATIONS_ANALYST_PROMPT, taskTemplate: null, harness: "focused", tuning: { stepBudget: 8 },
    requiredPermissions: [], skills: [], subagents: [],
    tools: ["list_scheduled_jobs", "get_scheduled_job", "list_scheduled_runs", "list_health_checks", "get_health_check", "list_health_incidents", "list_alerting", "list_observe_incidents", "list_doctor_reports", "fleet_snapshots"],
  },
  {
    id: "builtin-agent-platform-auditor", slug: "platform-auditor", name: "Platform Auditor",
    description: "Connections, AI models, external agents and MCP settings, and the audit log.",
    kind: "agent", systemPrompt: PLATFORM_AUDITOR_PROMPT, taskTemplate: null, harness: "focused", tuning: { stepBudget: 8 },
    requiredPermissions: [], skills: [], subagents: [],
    tools: ["whoami", "list_connections", "list_ai_models", "list_agent_sessions", "get_agent_governance", "audit_log"],
  },
  {
    id: "builtin-agent-chouse-assistant", slug: "chouse-assistant", name: "CHouse Assistant",
    description: "Routes each chat request to ClickHouse Data or CHouse Admin, and combines their answers for questions that span both.",
    kind: "router", systemPrompt: ROUTER_PROMPT, taskTemplate: null, harness: "router", tuning: { stepBudget: 10, timeoutMs: 180_000 },
    requiredPermissions: [], tools: [], skills: [], subagents: ["clickhouse-data", "chouse-admin"],
  },
];

// ============================================
// Bindings
// ============================================

export const SEED_BINDINGS: Record<string, string> = {
  "optimize-query": "sql-optimizer",
  "debug-query": "sql-debugger",
  "check-optimize": "query-evaluator",
  "optimize-log": "log-query-optimizer",
  "diagnose-error": "error-diagnostician",
  "diagnose-parts": "parts-diagnostician",
  "diagnose-schema": "schema-diagnostician",
  "fleet-scan": "fleet-doctor",
  "chat": "clickhouse-data",
  "draft-scheduled-query": "scheduled-query-drafter",
  "assess-scheduled-query": "scheduled-query-reviewer",
  "summarize-scheduled-query": "scheduled-query-briefer",
  "diagnose-scheduled-run": "scheduled-run-investigator",
  "plan-scheduled-recovery": "recovery-planner",
  "recommend-health-promise": "health-promise-advisor",
  "summarize-data-health": "data-health-briefer",
  "diagnose-health-incident": "health-incident-investigator",
  "tune-health-promise": "health-promise-tuner",
  "correlate-health-incidents": "incident-correlator",
  "explain-incident": "incident-explainer",
  "compile-watcher": "watcher-compiler",
  "draft-table-context": "table-context-drafter",
};
