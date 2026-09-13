/**
 * Docs manifest — single source of truth for the /docs static site.
 * Consumed by scripts/build-docs.ts (SSG), the sidebar, docs home and sitemap.
 */

export interface DocPage {
  slug: string;
  title: string;
  /** Meta description + card blurb. */
  description: string;
}

export interface DocGroup {
  id: string;
  label: string;
  pages: DocPage[];
}

export const DOCS_HOME_SLUG = "overview";

export const DOC_GROUPS: DocGroup[] = [
  {
    id: "getting-started",
    label: "Getting started",
    pages: [
      { slug: "overview", title: "Introduction", description: "What CHouse UI is, the full capability matrix, and how this documentation is organized." },
      { slug: "quick-start", title: "Quick start", description: "Run CHouse UI with Docker Compose in under five minutes — UI on port 5521, ClickHouse on 8123, default admin login." },
      { slug: "first-login", title: "First login", description: "Sign in with the seeded admin account, rotate the password, and take the first-run tour." },
      { slug: "concepts", title: "Core concepts", description: "How CHouse UI RBAC differs from ClickHouse users, what a connection is, and how queries are proxied and checked." },
      { slug: "compatibility", title: "Compatibility matrix", description: "Tested ClickHouse, PostgreSQL and SQLite versions, plus browser and runtime requirements." },
    ],
  },
  {
    id: "configuration",
    label: "Configuration",
    pages: [
      { slug: "configuration-yaml", title: "YAML configuration", description: "Configure the server with a grouped YAML file via CHOUSE_CONFIG_PATH — precedence rules and a full example." },
      { slug: "configuration-env", title: "Environment variables", description: "Every environment variable: server, ClickHouse defaults, RBAC database, JWT, encryption, fleet, doctor, scheduled queries and SSO." },
      { slug: "configuration-secrets", title: "Secrets generation", description: "Generate JWT secrets and AES-256 encryption keys/salts with openssl, and what each secret protects." },
      { slug: "production-checklist", title: "Production checklist", description: "The pre-production gate: unique secrets, rotated admin password, CORS, HTTPS, PostgreSQL and backups." },
    ],
  },
  {
    id: "access-security",
    label: "Access & security",
    pages: [
      { slug: "rbac-roles", title: "Users & roles", description: "The six built-in roles from Super Admin to Guest, what each can do, and how role assignment works." },
      { slug: "data-access-rules", title: "Data access rules", description: "Per-user and per-role database/table rules with wildcards, regex patterns, deny precedence and priority ordering." },
      { slug: "permissions", title: "Permission catalog", description: "Every permission string in CHouse UI — user, role, connection, table, query, monitoring, fleet, AI, alerting and system grants." },
      { slug: "sso", title: "Single sign-on (SSO)", description: "Delegate authentication to OIDC, OAuth2 or SAML identity providers with role mapping, JIT provisioning and config-file/env layering." },
      { slug: "personal-access-tokens", title: "Personal access tokens", description: "Mint ch_pat_… tokens in Preferences to authenticate the CLI, MCP agents and CI — scoped, revocable, verified live." },
      { slug: "audit-log", title: "Audit logging", description: "Every user action and query recorded with actor, connection and timestamp; filter, export and retention behavior." },
      { slug: "sessions-jwt", title: "Sessions & JWT", description: "Short-lived access tokens, long-lived refresh tokens, session expiry recovery and issuer/audience overrides." },
    ],
  },
  {
    id: "explorer",
    label: "Database Explorer",
    pages: [
      { slug: "explorer-connections", title: "Connections", description: "Add and manage multiple ClickHouse servers, connection presets, encrypted credentials and quick switching." },
      { slug: "explorer-databases", title: "Databases & tables", description: "Tree-view schema inspection, create/drop databases, create/alter/drop tables across MergeTree engine families." },
      { slug: "explorer-upload", title: "Upload & preview", description: "Load CSV, TSV and JSON files into existing tables and sample data with pagination." },
      { slug: "explorer-export", title: "Exports", description: "Download result sets and table samples as CSV, JSON or TSV from the workspace and explorer." },
    ],
  },
  {
    id: "workspace",
    label: "Query workspace",
    pages: [
      { slug: "workspace-overview", title: "Overview dashboard", description: "Per-cluster home: system stats, recent queries and quick actions for admins." },
      { slug: "workspace-editor", title: "SQL editor", description: "Monaco-powered editor with syntax highlighting, schema-aware completion, per-query execution statistics and history." },
      { slug: "workspace-explain", title: "Visual EXPLAIN", description: "Understand a query's plan before you run it — EXPLAIN estimates, popout view and the debug dialog." },
      { slug: "workspace-saved-queries", title: "Saved queries & history", description: "Persist frequently used queries per connection, share them, and browse full query history." },
      { slug: "workspace-command-palette", title: "Command palette & shortcuts", description: "Cmd/Ctrl+K quick switcher over pages, databases, tables, saved queries and actions; keyboard shortcuts for power users." },
      { slug: "workspace-ai-assist", title: "AI Assist", description: "Schema-aware optimizer, debugger and chat with a pluggable provider list — OpenAI, Anthropic, Bedrock, Ollama and any OpenAI-compatible endpoint." },
    ],
  },
  {
    id: "monitoring",
    label: "Monitoring",
    pages: [
      { slug: "monitoring-overview", title: "Monitoring overview", description: "The seven monitoring tabs, the permission each one needs, and the system tables behind them." },
      { slug: "monitoring-query-logs", title: "Query logs", description: "Five sub-views over system.query_log — Queries, Patterns, By table, By Redash and the duration/memory histogram." },
      { slug: "monitoring-live-queries", title: "Live queries", description: "Running queries with CPU time and thread count, memory-pressure context and kill support." },
      { slug: "monitoring-parts", title: "Parts", description: "system.part_log as stacked charts of merges, mutations, downloads and removals, plus a paginated event table." },
      { slug: "monitoring-schema-advisor", title: "Schema advisor", description: "Nullable-column and oversized-integer linter over system.parts_columns, ranked by on-disk bytes." },
      { slug: "monitoring-cluster-activity", title: "Cluster activity", description: "Mutations, replication queue, blocked-task indicators and per-replica lag from system.mutations and system.replicas." },
      { slug: "monitoring-metrics", title: "Metrics", description: "Nine tabs of ClickHouse-native observability: overview, performance, storage, merges, errors, memory, CPU, ZooKeeper and network." },
      { slug: "monitoring-errors", title: "Errors", description: "A searchable viewer over system.errors and the crash log so recurring failures surface without ad-hoc SQL." },
    ],
  },
  {
    id: "fleet-ai",
    label: "Fleet & Chouse AI",
    pages: [
      { slug: "fleet-view", title: "Fleet view", description: "Every configured cluster side by side with per-card polling, status, memory, lag and drill-down — plus the backend fleet poller." },
      { slug: "alerting", title: "Threshold alerts", description: "Node memory, per-query memory and long-running-query rules with hysteresis, delivered via Slack Block Kit and email." },
      { slug: "ai-fleet-doctor", title: "Chouse AI — Fleet Doctor", description: "The autonomous, read-only AI SRE: guarded fleet scans, structured reports, history and auto-RCA to Slack/email on breaches." },
      { slug: "ai-in-tab", title: "Chouse AI in-tab", description: "Optimize query-log rows, fix system.errors rows and diagnose part-log rows without leaving the tab — read-only, before→after EXPLAIN." },
    ],
  },
  {
    id: "dataops",
    label: "DataOps",
    pages: [
      { slug: "scheduled-queries", title: "Scheduled queries", description: "Cron-style SQL jobs with macros, run history, lineage and per-job leases that are safe across replicas." },
      { slug: "data-health", title: "Data health", description: "Promises over your datasets — freshness, volume and schema checks evaluated on a schedule with incident tracking." },
      { slug: "dataops-ai", title: "DataOps AI", description: "The operational brief: AI-generated summaries of scheduled jobs and data-health incidents in one card." },
    ],
  },
  {
    id: "automation",
    label: "Automation",
    pages: [
      { slug: "mcp", title: "MCP server", description: "Operate CHouse UI from AI agents over Model Context Protocol on port 8752 — read-only by default, human-approved destructive tools." },
      { slug: "cli", title: "CLI", description: "The chouse command line: query, explore, monitor, run the doctor and manage schedules from scripts and CI." },
    ],
  },
  {
    id: "deploy-reference",
    label: "Deploy & reference",
    pages: [
      { slug: "deploy-docker", title: "Docker deployment", description: "docker-compose up for the full stack, production hardening, volumes, health checks and upgrades." },
      { slug: "deploy-helm", title: "Helm chart", description: "Install the signed OCI chart, choose SQLite or PostgreSQL topology, and configure ingress, secrets and SSO." },
      { slug: "migrations-upgrades", title: "Migrations & upgrades", description: "Migrations run automatically on boot — what happens on fresh installs, upgrades and restarts, plus the RBAC CLI tools." },
      { slug: "architecture", title: "Architecture", description: "The monorepo layout, request path from browser to ClickHouse, RBAC middleware, and where AI services sit." },
      { slug: "security", title: "Security model", description: "Encrypted credentials, Argon2id hashing, JWT verification, SQL parsing against data access rules and audit coverage." },
      { slug: "troubleshooting", title: "Troubleshooting", description: "Common failure modes — login, connections, migrations, SSO, MCP — and how to diagnose them." },
      { slug: "faq", title: "FAQ", description: "Answers to the questions operators ask most about CHouse UI." },
    ],
  },
];

/** Flatten all pages in TOC order. */
export function allPages(): Array<{ group: DocGroup; page: DocPage; index: number }> {
  const out: Array<{ group: DocGroup; page: DocPage; index: number }> = [];
  let i = 0;
  for (const group of DOC_GROUPS) {
    for (const page of group.pages) {
      out.push({ group, page, index: i++ });
    }
  }
  return out;
}

export function findDoc(slug: string): { group: DocGroup; page: DocPage; index: number } | undefined {
  return allPages().find((entry) => entry.page.slug === slug);
}

/** Neighbouring pages for Prev/Next pagination. */
export function docNav(slug: string): { prev?: DocPage; next?: DocPage } {
  const entries = allPages();
  const idx = entries.findIndex((entry) => entry.page.slug === slug);
  if (idx === -1) return {};
  return {
    prev: idx > 0 ? entries[idx - 1].page : undefined,
    next: idx < entries.length - 1 ? entries[idx + 1].page : undefined,
  };
}
