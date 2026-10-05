/**
 * Docs manifest — single source of truth for the /docs static site.
 * Consumed by scripts/build-docs.ts (SSG), the sidebar, hubs, search and sitemap.
 *
 * Structure: section → group → page. A section is one sidebar block and gets a
 * hub page at /docs/<section-id>/. Groups split a section into sub-menus; the
 * "Using CHouse UI" groups mirror the app's own navigation (dock items), so a
 * reader can go from a screen in the app to its page here. A group without a
 * label renders flat under its section.
 */

export interface DocPage {
  slug: string;
  title: string;
  /** Meta description + card blurb. */
  description: string;
}

export interface DocGroup {
  id: string;
  /** Omit for a section that has a single, flat list of pages. */
  label?: string;
  pages: DocPage[];
}

export interface DocSection {
  id: string;
  label: string;
  /** Shown on the docs home card and the section hub. */
  description: string;
  groups: DocGroup[];
}

export interface DocEntry {
  section: DocSection;
  group: DocGroup;
  page: DocPage;
  index: number;
}

export const DOCS_HOME_PATH = "/docs/";

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "start",
    label: "Start here",
    description: "What CHouse UI is, a five-minute install, the first login and the ideas everything else builds on.",
    groups: [
      {
        id: "start",
        pages: [
          { slug: "overview", title: "Introduction", description: "What CHouse UI is, the full capability matrix, and how this documentation is organized." },
          { slug: "quick-start", title: "Quick start", description: "Run CHouse UI with Docker Compose in under five minutes — UI on port 5521, ClickHouse on 8123, default admin login." },
          { slug: "first-login", title: "First login", description: "Sign in with the seeded admin account, rotate the password, and take the first-run tour." },
          { slug: "concepts", title: "Core concepts", description: "The six ideas behind everything else: own users and roles, connections, the server proxy, metadata-based observation, approved fixes and governed agents." },
          { slug: "whats-new", title: "What's new in 3.14", description: "Data observability, approved fixes, Agents and MCP in the UI, CLI 1.0, Helm chart 2.0 — and what to change when you upgrade." },
        ],
      },
    ],
  },
  {
    id: "install",
    label: "Install & upgrade",
    description: "Deploy with Docker or the Helm chart, harden for production, upgrade safely and check version support.",
    groups: [
      {
        id: "install",
        pages: [
          { slug: "deploy-docker", title: "Docker deployment", description: "docker-compose up for the full stack, production hardening, volumes, health checks and upgrades." },
          { slug: "deploy-helm", title: "Helm chart", description: "Install the signed OCI chart, choose SQLite or PostgreSQL topology, and configure ingress, secrets and SSO." },
          { slug: "helm-values", title: "Helm values reference", description: "Every value of the chouse-ui Helm chart with its type, default and meaning — generated from the chart." },
          { slug: "production-checklist", title: "Production checklist", description: "The pre-production gate: unique secrets, rotated admin password, CORS, HTTPS, PostgreSQL and backups." },
          { slug: "migrations-upgrades", title: "Migrations & upgrades", description: "Migrations run automatically on boot — what happens on fresh installs, upgrades and restarts, plus the RBAC CLI tools." },
          { slug: "compatibility", title: "Compatibility matrix", description: "Tested ClickHouse, PostgreSQL and SQLite versions, plus browser and runtime requirements." },
        ],
      },
    ],
  },
  {
    id: "configure",
    label: "Configure",
    description: "Server settings from YAML and environment variables, the secrets they need, and the ClickHouse connections you manage.",
    groups: [
      {
        id: "configure",
        pages: [
          { slug: "configuration-yaml", title: "YAML configuration", description: "Configure the server with a grouped YAML file via CHOUSE_CONFIG_PATH — precedence rules and a full example." },
          { slug: "configuration-env", title: "Environment variables", description: "Every setting the server reads, with its default, YAML key and what it does — checked against the code." },
          { slug: "configuration-secrets", title: "Secrets generation", description: "Generate JWT secrets and AES-256 encryption keys/salts with openssl, and what each secret protects." },
          { slug: "connections", title: "Connections", description: "Add and manage multiple ClickHouse servers, connection presets, encrypted credentials and quick switching." },
        ],
      },
    ],
  },
  {
    id: "access",
    label: "Access & security",
    description: "Users, roles and permissions, data access rules, single sign-on, tokens, sessions, auditing and the security model.",
    groups: [
      {
        id: "access",
        pages: [
          { slug: "rbac-roles", title: "Users & roles", description: "The built-in roles from Super Admin to Guest, what each can do, and how role assignment works." },
          { slug: "data-access-rules", title: "Data access rules", description: "Per-user and per-role database/table rules with wildcards, regex patterns, deny precedence and priority ordering." },
          { slug: "permissions", title: "Permission catalog", description: "Every permission, what it allows and which built-in roles hold it — generated from the server." },
          { slug: "sso", title: "Single sign-on (SSO)", description: "Delegate authentication to OIDC, OAuth2 or SAML identity providers with role mapping, JIT provisioning and config-file/env layering." },
          { slug: "personal-access-tokens", title: "Personal access tokens", description: "Mint ch_pat_… tokens in Preferences to authenticate the CLI, MCP agents and CI — scoped, revocable, verified live." },
          { slug: "sessions-jwt", title: "Sessions & JWT", description: "Short-lived access tokens, long-lived refresh tokens, session expiry recovery and issuer/audience overrides." },
          { slug: "audit-log", title: "Audit logging", description: "Every user action and query recorded with actor, connection and timestamp; filter, export and retention behavior." },
          { slug: "audit-events", title: "Audit event catalog", description: "Every action the audit log records, by area — generated from the server." },
          { slug: "security", title: "Security model", description: "Encrypted credentials, Argon2id hashing, JWT verification, SQL parsing against data access rules and audit coverage." },
        ],
      },
    ],
  },
  {
    id: "using",
    label: "Using CHouse UI",
    description: "Every screen in the app, in the order of the app's own menu — what it shows, who can open it and how to work with it.",
    groups: [
      {
        id: "home",
        label: "Home",
        pages: [
          { slug: "home", title: "Home", description: "Per-connection landing page: system stats, saved queries, recent activity and quick actions." },
          { slug: "workspace-command-palette", title: "Command palette & shortcuts", description: "Cmd/Ctrl+K quick switcher over pages, databases, tables, saved queries and actions; keyboard shortcuts for power users." },
        ],
      },
      {
        id: "explorer",
        label: "Explorer",
        pages: [
          { slug: "explorer-databases", title: "Databases & tables", description: "Tree-view schema inspection, create/drop databases, create/alter/drop tables across MergeTree engine families." },
          { slug: "workspace-editor", title: "SQL editor", description: "Monaco-powered editor with syntax highlighting, schema-aware completion, per-query execution statistics and history." },
          { slug: "workspace-explain", title: "Visual EXPLAIN", description: "Understand a query's plan before you run it — EXPLAIN estimates, popout view and the debug dialog." },
          { slug: "workspace-saved-queries", title: "Saved queries & history", description: "Persist frequently used queries per connection, share them, and browse full query history." },
          { slug: "explorer-upload", title: "Upload & preview", description: "Load CSV, TSV and JSON files into existing tables and sample data with pagination." },
          { slug: "explorer-export", title: "Exports", description: "Download result sets and table samples as CSV, JSON or TSV from the workspace and explorer." },
          { slug: "workspace-ai-assist", title: "AI Assist", description: "Schema-aware optimizer, debugger and chat with a pluggable provider list — OpenAI, Anthropic, Bedrock, Ollama and any OpenAI-compatible endpoint." },
        ],
      },
      {
        id: "data",
        label: "Data",
        pages: [
          { slug: "data-observability", title: "How data is watched", description: "The collector, learned baselines, trust states and criticality behind every Data tab — and the grants it needs." },
          { slug: "data-overview", title: "Overview", description: "One screen for whether the data is right: trusted tables, critical coverage, open incidents with their root cause, pipelines and suggestions." },
          { slug: "data-incidents", title: "Incidents, root cause & fixes", description: "Cross-layer root cause and blast radius, investigation notebooks, fixes that run only after approval, Slack approvals and schema preflight." },
          { slug: "data-lineage", title: "Lineage", description: "How data moves between tables, built from metadata and query_log without instrumentation — upstream sources and downstream blast radius." },
          { slug: "data-pipelines", title: "Pipelines", description: "Kafka, RabbitMQ, NATS, S3Queue, AzureQueue, replication, views and writers in one status vocabulary, with samples and errors." },
          { slug: "data-health", title: "Datasets & promises", description: "Observed tables with their baselines, drift and usage, and promises — explicit checks evaluated on a schedule with incidents." },
          { slug: "data-coverage", title: "Coverage", description: "How well tables are protected, suggested promises for read-heavy tables, and cold data nobody reads." },
          { slug: "data-context", title: "Context", description: "Table descriptions, owners, canonical metrics, dbt import and plain-language watchers — for people and AI agents." },
          { slug: "scheduled-queries", title: "Scheduled queries", description: "Cron and event-driven SQL jobs with macros, materialize destinations (also across a cluster), run history and replica-safe leases." },
          { slug: "dataops-ai", title: "Operational brief", description: "AI-generated summaries of a scheduled job's or promise's recent runs and incidents, on its detail page." },
        ],
      },
      {
        id: "monitoring",
        label: "Monitoring",
        pages: [
          { slug: "monitoring-overview", title: "Monitoring overview", description: "The ten Monitoring tabs, the permission each one needs, and the system tables behind them." },
          { slug: "monitoring-live-queries", title: "Live queries", description: "Running queries with CPU time and thread count, memory-pressure context and kill support." },
          { slug: "monitoring-query-logs", title: "Query logs", description: "Five sub-views over system.query_log — Queries, Patterns, By table, By Redash and the duration/memory histogram." },
          { slug: "monitoring-metrics", title: "Metrics", description: "Nine tabs of ClickHouse-native observability: overview, performance, storage, merges, errors, memory, CPU, ZooKeeper and network." },
          { slug: "monitoring-parts", title: "Parts", description: "system.part_log as stacked charts of merges, mutations, downloads and removals, plus a paginated event table." },
          { slug: "monitoring-schema-advisor", title: "Schema advisor", description: "Nullable-column and oversized-integer linter over system.parts_columns, ranked by on-disk bytes." },
          { slug: "monitoring-cluster-activity", title: "Cluster", description: "Mutations, replication queue, blocked-task indicators and per-replica lag from system.mutations and system.replicas." },
          { slug: "monitoring-errors", title: "Errors", description: "A searchable viewer over system.errors and the crash log so recurring failures surface without ad-hoc SQL." },
          { slug: "monitoring-performance", title: "Performance", description: "Each query shape against its own 14-day baseline, regressions lined up with the upgrades, DDL and setting changes around them." },
          { slug: "monitoring-capacity", title: "Capacity", description: "Disk forecasts per node, top growth, codec trials on samples and cost by consumer." },
          { slug: "monitoring-upgrades", title: "Upgrades", description: "Upgrade readiness against your real workload, replay on a canary and a rollout tracker." },
          { slug: "ai-in-tab", title: "Chouse AI in Monitoring", description: "Optimize query-log rows, fix system.errors rows and diagnose part-log rows without leaving the tab — read-only, before→after EXPLAIN." },
        ],
      },
      {
        id: "fleet",
        label: "Fleet",
        pages: [
          { slug: "fleet", title: "Fleet view", description: "Every connection side by side with status, memory, lag and trends, sampled by the server — not by every browser." },
        ],
      },
      {
        id: "doctor",
        label: "Doctor",
        pages: [
          { slug: "doctor", title: "Chouse AI Doctor", description: "The AI SRE: guarded fleet scans, structured reports, notebooks, proposed fixes and auto-RCA to Slack/email on breaches." },
        ],
      },
      {
        id: "agents",
        label: "Agents",
        pages: [
          { slug: "agents", title: "Agents & governance", description: "Every MCP and token agent session, budget policies checked before queries run, health notices and the pause switch." },
        ],
      },
      {
        id: "ai-assistant",
        label: "AI agents",
        pages: [
          { slug: "ai-agents", title: "AI agents", description: "Every AI feature and the chat run on an agent you can edit in Agents › Assistant: how features, agents, harnesses, skills and tools fit together." },
          { slug: "ai-agent-editor", title: "Editing agents", description: "The agent editor: prompt, tools, skills, subagents, model and tuning — and saving, duplicating, resetting and deleting agents." },
          { slug: "ai-prompt-templates", title: "Prompt templates", description: "Feature variables, conditional sections and skill includes in system prompts and task templates, and how the preview checks them." },
          { slug: "ai-harnesses", title: "Harnesses", description: "How DeepAgents runs an agent: which built-in tools it sees, the prompt suffix, the general-purpose subagent — and the three built-in harnesses." },
          { slug: "ai-skills", title: "Skills", description: "SKILL.md instructions and reference files that agents read on demand or pin into their prompt — anatomy, limits and writing your own." },
          { slug: "ai-chat-agents", title: "Chat agents", description: "The chat's agent picker, the CHouse Assistant router, CHouse Admin and its specialists, and adding chat agents of your own." },
          { slug: "ai-test-console", title: "Test console", description: "Run any AI feature or an unsaved draft as you and see the result, every tool call and the exact prompt — plus common errors." },
          { slug: "ai-versions", title: "Versions, upgrades & audit", description: "Version history and restore, how CHouse upgrades built-in agents without overwriting yours, replicas, and the audit trail." },
          { slug: "ai-features", title: "AI feature catalog", description: "Every AI feature with its permission, tool contexts, template variables and built-in agent — generated from the server." },
          { slug: "ai-tools", title: "AI tool catalog", description: "Every read-only tool agents can use, the DeepAgents built-in tools each harness keeps, and the built-in skills — generated from the server." },
        ],
      },
      {
        id: "admin",
        label: "Admin",
        pages: [
          { slug: "admin", title: "Admin overview", description: "Every Admin tab — users, roles, data access, connections, ClickHouse users and roles, audit, AI models, SSO, alerting — and who can open it." },
          { slug: "clickhouse-users-roles", title: "ClickHouse users & roles", description: "Create and manage real ClickHouse users and roles with native grants, from templates or by hand." },
          { slug: "ai-models", title: "AI models", description: "Connect AI providers, register provider models and publish deployments for Chouse AI — sixteen provider types, keys encrypted." },
          { slug: "alerting", title: "Alerting", description: "Threshold rules on fleet samples with Slack and email channels, test sends, and automatic Doctor root-cause reports." },
        ],
      },
      {
        id: "preferences",
        label: "Preferences",
        pages: [
          { slug: "preferences", title: "Preferences", description: "Your theme, default result row limit, effective access and personal access tokens." },
        ],
      },
    ],
  },
  {
    id: "guides",
    label: "Guides",
    description: "Step-by-step walk-throughs of the jobs people do most — from a stale table to a fix, from a new team to its first agent.",
    groups: [
      {
        id: "guides",
        pages: [
          { slug: "guide-investigate-stale-table", title: "Investigate a stale table", description: "From \"the dashboard shows yesterday\" to the root cause, the people affected and a fix." },
          { slug: "guide-approve-a-fix", title: "Approve and roll back a fix", description: "Set up a remediation credential, then propose, approve, run, verify and roll back one fix." },
          { slug: "guide-watch-a-pipeline", title: "Watch a Kafka pipeline", description: "Make sure a Kafka consumer's failures — including silent retries — get noticed." },
          { slug: "guide-first-promise", title: "Set up your first promise", description: "A freshness promise with an alert, from choosing the table to validating the generated SQL." },
          { slug: "guide-customize-an-ai-feature", title: "Customize an AI feature", description: "Teach Optimize your team's SQL conventions with a skill and a copied agent, test it, switch over and roll back." },
          { slug: "guide-build-a-chat-agent", title: "Build a chat agent", description: "A team chat agent with its own data skill and tools, gated by permission, optionally routed to by Auto." },
          { slug: "guide-connect-an-agent", title: "Connect an AI agent", description: "Turn MCP on, give Claude Code a narrow token, and watch and limit what it does." },
          { slug: "guide-cli-in-ci", title: "Use the CLI in CI", description: "A scoped token, JSON output and exit codes for reports and data checks in a pipeline." },
          { slug: "guide-plan-an-upgrade", title: "Plan a ClickHouse upgrade", description: "Readiness against your workload, a canary replay, rollout gates and watching for regressions." },
          { slug: "guide-least-privilege-role", title: "Give a team least-privilege access", description: "A data access policy and a custom role that let a team read one database and nothing else." },
        ],
      },
    ],
  },
  {
    id: "automation",
    label: "Automation",
    description: "Drive CHouse UI from AI agents over MCP and from scripts and CI with the chouse CLI.",
    groups: [
      {
        id: "automation",
        pages: [
          { slug: "mcp", title: "MCP server", description: "Operate CHouse UI from AI agents over Model Context Protocol at /mcp — turned on and tool-by-tool in Agents › MCP, read-only by default." },
          { slug: "mcp-tools", title: "MCP tool catalog", description: "Every MCP tool with its access level, default state, required permissions and parameters — generated from the server." },
          { slug: "cli", title: "CLI", description: "The chouse command line: query, explore, monitor, run the doctor and manage schedules from scripts and CI." },
          { slug: "cli-reference", title: "CLI command reference", description: "Every chouse command, subcommand and flag — generated from the CLI itself." },
        ],
      },
    ],
  },
  {
    id: "reference",
    label: "Reference & help",
    description: "How CHouse UI is built, what to do when something breaks, and answers to common questions.",
    groups: [
      {
        id: "reference",
        pages: [
          { slug: "architecture", title: "Architecture", description: "The monorepo layout, request path from browser to ClickHouse, RBAC middleware, collectors and where AI services sit." },
          { slug: "troubleshooting", title: "Troubleshooting", description: "Common failure modes — login, connections, migrations, SSO, MCP — and how to diagnose them." },
          { slug: "faq", title: "FAQ", description: "Answers to the questions operators ask most about CHouse UI." },
          { slug: "glossary", title: "Glossary", description: "Every CHouse UI term — trust state, promise, blast radius, remediation credential, query shape — in one line each." },
        ],
      },
    ],
  },
];

/**
 * Old slug → current slug. Every renamed page keeps its old URL alive as a
 * redirect stub, so links from search engines, issues and blog posts survive.
 * Never remove an entry; point it at the page that replaced it instead.
 */
export const DOC_REDIRECTS: Record<string, string> = {
  "explorer-connections": "connections",
  "fleet-view": "fleet",
  "ai-fleet-doctor": "doctor",
  "workspace-overview": "home",
  "data-pipelines-lineage": "data-pipelines",
  "monitoring-performance-capacity": "monitoring-performance",
};

/** Flatten all pages in sidebar order. */
export function allPages(): DocEntry[] {
  const out: DocEntry[] = [];
  let index = 0;
  for (const section of DOC_SECTIONS) {
    for (const group of section.groups) {
      for (const page of group.pages) {
        out.push({ section, group, page, index: index++ });
      }
    }
  }
  return out;
}

export function sectionPages(section: DocSection): DocPage[] {
  return section.groups.flatMap((group) => group.pages);
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

export function docPath(slug: string): string {
  return `/docs/${slug}/`;
}

export function sectionPath(id: string): string {
  return `/docs/${id}/`;
}
