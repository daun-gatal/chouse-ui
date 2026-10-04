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
          { slug: "concepts", title: "Core concepts", description: "How CHouse UI RBAC differs from ClickHouse users, what a connection is, and how queries are proxied and checked." },
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
          { slug: "data-observability", title: "Data observability", description: "The Data page: learned freshness and volume baselines for every table, coverage, drift, context and watchers — without scanning tables." },
          { slug: "data-incidents", title: "Incidents, root cause & fixes", description: "Cross-layer root cause and blast radius, investigation notebooks, approved remediation and schema change preflight." },
          { slug: "data-pipelines-lineage", title: "Pipelines & lineage", description: "Kafka, RabbitMQ, NATS, S3Queue, AzureQueue, replication, views and writers in one status vocabulary, and lineage without instrumentation." },
          { slug: "data-health", title: "Datasets & promises", description: "Promises over your datasets — freshness, volume and schema checks evaluated on a schedule with incident tracking." },
          { slug: "scheduled-queries", title: "Scheduled queries", description: "Cron-style SQL jobs with macros, run history, lineage and per-job leases that are safe across replicas." },
          { slug: "dataops-ai", title: "Operational brief", description: "AI-generated summaries of scheduled jobs and data-health incidents in one card." },
        ],
      },
      {
        id: "monitoring",
        label: "Monitoring",
        pages: [
          { slug: "monitoring-overview", title: "Monitoring overview", description: "The Monitoring tabs, the permission each one needs, and the system tables behind them." },
          { slug: "monitoring-live-queries", title: "Live queries", description: "Running queries with CPU time and thread count, memory-pressure context and kill support." },
          { slug: "monitoring-query-logs", title: "Query logs", description: "Five sub-views over system.query_log — Queries, Patterns, By table, By Redash and the duration/memory histogram." },
          { slug: "monitoring-metrics", title: "Metrics", description: "Nine tabs of ClickHouse-native observability: overview, performance, storage, merges, errors, memory, CPU, ZooKeeper and network." },
          { slug: "monitoring-parts", title: "Parts", description: "system.part_log as stacked charts of merges, mutations, downloads and removals, plus a paginated event table." },
          { slug: "monitoring-schema-advisor", title: "Schema advisor", description: "Nullable-column and oversized-integer linter over system.parts_columns, ranked by on-disk bytes." },
          { slug: "monitoring-cluster-activity", title: "Cluster", description: "Mutations, replication queue, blocked-task indicators and per-replica lag from system.mutations and system.replicas." },
          { slug: "monitoring-errors", title: "Errors", description: "A searchable viewer over system.errors and the crash log so recurring failures surface without ad-hoc SQL." },
          { slug: "monitoring-performance-capacity", title: "Performance, capacity & upgrades", description: "Query-shape regressions next to the changes around them, disk forecasts and measured codec savings, and upgrade readiness with canary replay." },
          { slug: "ai-in-tab", title: "Chouse AI in Monitoring", description: "Optimize query-log rows, fix system.errors rows and diagnose part-log rows without leaving the tab — read-only, before→after EXPLAIN." },
        ],
      },
      {
        id: "fleet",
        label: "Fleet",
        pages: [
          { slug: "fleet", title: "Fleet view", description: "Every configured cluster side by side with status, memory, lag and drill-down." },
          { slug: "alerting", title: "Threshold alerts", description: "Node memory, per-query memory and long-running-query rules with hysteresis, delivered via Slack Block Kit and email." },
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
