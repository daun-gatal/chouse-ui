import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, Database, BarChart3, Palette, Lock, Users, FileText, Zap, Search,
  Download, Settings, Eye, Plus, Minus, Activity, Star, Sparkles, Bot, MessageSquare,
  Terminal, KeyRound,
  Gauge, MemoryStick, Layers, Stethoscope, Network, SunMoon,
  LayoutGrid, BellRing, TableProperties, Radar,
  CalendarClock, Clock, GitBranch, RefreshCw, ListChecks, HeartPulse,
  type LucideIcon,
} from "lucide-react";
import { Section, Container, SectionHeader } from "./Section";
import { cn } from "@/lib/utils";

interface FeatureItem {
  icon: LucideIcon;
  title: string;
  desc: string;
}

interface FeatureGroup {
  category: string;
  icon: LucideIcon;
  items: FeatureItem[];
}

const GROUPS: FeatureGroup[] = [
  {
    category: "Fleet & AI SRE",
    icon: Radar,
    items: [
      { icon: LayoutGrid, title: "Fleet view", desc: "Every connection side by side — status, memory %, active queries, exceptions, and trend sparklines, with independent per-card polling" },
      { icon: Stethoscope, title: "Chouse AI · Fleet Doctor", desc: "Autonomous read-only AI SRE — scans the fleet, pins the root cause, and writes a structured report with a heavy-query deep-dive and suggested rewrites" },
      { icon: BellRing, title: "Threshold Alerts", desc: "Node memory %, per-query memory, and long-running queries → Slack Block Kit + email, with hysteresis to avoid flapping" },
      { icon: Bot, title: "Autonomous RCA", desc: "On a breach, Chouse AI auto-runs a fleet scan and delivers the root-cause analysis to Slack and email" },
      { icon: Database, title: "Snapshot poller", desc: "A backend worker caches per-cluster metrics to SQLite, so the fleet page reads one fast endpoint instead of every browser hitting every cluster live" },
      { icon: FileText, title: "Errors page", desc: "A searchable, paginated viewer over system.errors and the crash log, so recurring server-side errors surface without ad-hoc SQL" },
    ],
  },
  {
    category: "AI & Automation",
    icon: Sparkles,
    items: [
      { icon: Zap, title: "Optimize from logs", desc: "Optimize any logged query with Chouse AI — a rewrite with the same result, a before→after EXPLAIN estimate, and one click to open it in the Explorer" },
      { icon: Bot, title: "Diagnose errors & parts", desc: "One-click Chouse AI on a system.errors row or a part-log entry → cause, impact, and ordered fixes (merge pressure, too many parts, partition key)" },
      { icon: MessageSquare, title: "Chat copilot", desc: "Conversational data exploration and chart building against a connection" },
      { icon: KeyRound, title: "Personal access tokens", desc: "Self-service machine credentials (ch_pat_…) scoped to your roles — revocation takes effect on the very next call, with every action attributed in the audit log" },
      { icon: Terminal, title: "chouse CLI", desc: "Query, explore, monitor the fleet, and manage scheduled work from scripts and CI — safe by default, with --yes gates and --dry-run previews" },
      { icon: Bot, title: "MCP server", desc: "A Model Context Protocol endpoint for Cursor, Claude, Codex, and OpenCode — read-only by default, destructive tools need human approval" },
    ],
  },
  {
    category: "DataOps & Data Health",
    icon: CalendarClock,
    items: [
      { icon: CalendarClock, title: "Scheduled Queries", desc: "Schedule any read-only SELECT on a daily / weekly / monthly preset or a custom UTC cron — a DataOps page with Overview, Jobs, and Runs" },
      { icon: Clock, title: "Deterministic windows", desc: "Templated {{slot_start}} / {{slot_end}} / {{prev_run_at}} bind to each run's exact time window, so backfills and replays are reproducible" },
      { icon: RefreshCw, title: "Materialize write-back", desc: "Optional engine-generated, idempotent write into a destination table — append, replace-partition, or upsert — alongside bounded result snapshots" },
      { icon: GitBranch, title: "Runtime Lineage", desc: "Graphs the tables a job actually reads and writes from system.query_log, chaining jobs together and revealing column-level flow on demand" },
      { icon: ListChecks, title: "Replica-safe scheduler", desc: "In-process per-job-lease scheduler correct across replicas with no leader election, plus a crash-only reaper, bounded retry, and transactional outbox" },
      { icon: HeartPulse, title: "Data Health Promises", desc: "Scheduled freshness, volume, per-column completeness, composite-key uniqueness, validity, schema, and custom-metric checks, with auto-selected event-time columns and deterministic UTC normalization" },
      { icon: Eye, title: "Health evidence & incidents", desc: "Inspect the actual evaluated window and why a passing check had no violations; execution failures get dedicated incidents with recovery transitions and an immutable timeline" },
      { icon: BellRing, title: "Failure alerting", desc: "Transition-based notifications to linked channels on job failure, promise breach, and once on recovery — no flapping" },
    ],
  },
  {
    category: "Security & Access Control",
    icon: Shield,
    items: [
      { icon: Shield, title: "RBAC System", desc: "Six predefined roles, granular permissions per user" },
      { icon: Lock, title: "Encrypted Credentials", desc: "AES-256-GCM with PBKDF2 key derivation" },
      { icon: Users, title: "JWT Authentication", desc: "Short-lived access tokens, long-lived refresh tokens" },
      { icon: FileText, title: "Audit Logging", desc: "Every user action and query history with user-agent/geo context" },
      { icon: Users, title: "SSO / OIDC", desc: "Sign in with any OIDC or OAuth2 provider — JIT user provisioning, email-based account linking, and optional IdP group → role sync" },
    ],
  },
  {
    category: "Database Management",
    icon: Database,
    items: [
      { icon: Database, title: "Multi-Connection", desc: "Manage multiple ClickHouse servers from one UI" },
      { icon: Activity, title: "Live Queries", desc: "View and kill running queries in real-time" },
      { icon: Search, title: "Database Explorer", desc: "Tree view with schema inspection and DDL" },
      { icon: Settings, title: "Table Management", desc: "Create, alter, drop with MergeTree variants" },
      { icon: Download, title: "File Upload", desc: "CSV, TSV, or JSON into existing tables" },
    ],
  },
  {
    category: "Monitoring & Observability",
    icon: Gauge,
    items: [
      { icon: FileText, title: "Query Logs", desc: "Five rollups: every execution, by pattern, by table, by Redash query_id, and a duration/memory histogram" },
      { icon: MemoryStick, title: "Memory Breakdown", desc: "Server RSS attributed to queries, caches, merges, primary keys — vs total RAM" },
      { icon: BarChart3, title: "Top Resource Queries", desc: "Heaviest queries by memory and CPU, straight from system.query_log" },
      { icon: Activity, title: "Live Queries", desc: "Running queries with CPU time + thread count, sortable, with kill support" },
      { icon: Network, title: "Cluster Activity", desc: "Mutations, replication queue, per-replica lag, blocked-task indicators" },
      { icon: Layers, title: "Parts & Merges", desc: "system.part_log timeline of merges, mutations, downloads, removals" },
      { icon: TableProperties, title: "Schema Advisor", desc: "Nullable + oversized-integer lints ranked by on-disk bytes" },
      { icon: Zap, title: "Latency Percentiles", desc: "p50 / p95 / p99 on the query histogram, no exporter required" },
    ],
  },
  {
    category: "Query & Analytics",
    icon: BarChart3,
    items: [
      { icon: FileText, title: "SQL Editor", desc: "Monaco with syntax highlighting and auto-completion" },
      { icon: Zap, title: "Execution Stats", desc: "Inline timing, rows read, bytes scanned" },
      { icon: Eye, title: "Query History", desc: "View and filter logs with auto-refresh" },
      { icon: FileText, title: "Auto-Save", desc: "Real-time sync like Google Docs, instant ⌘S" },
      { icon: Download, title: "Data Export", desc: "CSV, JSON, TSV formats" },
    ],
  },
  {
    category: "User Experience",
    icon: Palette,
    items: [
      { icon: SunMoon, title: "Light + Dark + Auto", desc: "Warm-stone light theme, editorial dark, and an Auto mode that switches by local time of day" },
      { icon: Star, title: "Favorites & Recent", desc: "Pin databases and tables for instant access" },
      { icon: Settings, title: "Responsive", desc: "Container-query layouts adapt per component, not just per viewport" },
      { icon: Zap, title: "Keyboard Shortcuts", desc: "Power-user shortcuts + ⌘K command palette" },
    ],
  },
];

// Pillars — the "why teams pick it" view (merged from the former Highlights section).
const HIGHLIGHTS: Array<FeatureItem & { meta: string }> = [
  {
    icon: Shield,
    title: "Encrypted credentials",
    desc: "AES-256-GCM connection passwords, Argon2id user passwords, JWT with refresh — secrets live server-side, so the browser never sees a ClickHouse password.",
    meta: "Server-side only",
  },
  {
    icon: Users,
    title: "Role-based access",
    desc: "Six predefined roles, ~40 permissions, and granular data-access rules per user, database, and table.",
    meta: "RBAC built-in",
  },
  {
    icon: FileText,
    title: "Audit logging",
    desc: "Every action and query recorded with the real session context — user, user-agent, and geo.",
    meta: "Full trail",
  },
  {
    icon: LayoutGrid,
    title: "Multi-cluster fleet",
    desc: "Every connected cluster in one pane — status, memory, exceptions, trends — each card polling independently.",
    meta: "One pane",
  },
  {
    icon: Stethoscope,
    title: "Autonomous AI SRE",
    desc: "Chouse AI runs read-only root-cause scans, writes fixes with before→after EXPLAIN proof, and delivers RCA to Slack on a breach.",
    meta: "Read-only",
  },
  {
    icon: Activity,
    title: "Deep observability",
    desc: "ClickHouse-native monitoring — query logs, memory breakdown, top-resource queries, replica lag, schema lints. No exporter to install.",
    meta: "No exporter",
  },
  {
    icon: CalendarClock,
    title: "Scheduled queries & Data Health",
    desc: "Cron-scheduled read-only SELECTs with deterministic time windows and idempotent materialize write-back, plus scheduled freshness, volume, and validity promises with low-noise incidents — DataOps without a separate orchestrator.",
    meta: "Built-in DataOps",
  },
  {
    icon: KeyRound,
    title: "SSO / OIDC",
    desc: "Sign in with any OIDC or OAuth2 provider — JIT user provisioning, email-based account linking, and optional IdP group → role sync.",
    meta: "Any provider",
  },
];

export default function Features() {
  const [openIndex, setOpenIndex] = useState<number>(0);

  const activeGroup = GROUPS[openIndex] ?? GROUPS[0];

  return (
    <Section id="features" aria-label="Features">
      <Container>
        <SectionHeader
          eyebrow="What's inside"
          eyebrowIndex={2}
          title="Everything you need to give ClickHouse to a team."
          description="Eight domains, one consistent UI. Pick a category to browse its items."
        />

        {/* Desktop: category rail + detail panel */}
        <div className="mt-16 hidden grid-cols-12 gap-x-6 lg:grid">
          <div className="col-span-4">
            <div className="sticky top-24 flex flex-col border-t border-ink-500">
              {GROUPS.map((group, idx) => {
                const Icon = group.icon;
                const isActive = openIndex === idx;
                const number = String(idx + 1).padStart(2, "0");
                return (
                  <button
                    key={group.category}
                    type="button"
                    onClick={() => setOpenIndex(idx)}
                    aria-selected={isActive}
                    role="tab"
                    className="relative flex items-center gap-3 border-b border-ink-500 px-2 py-4 text-left transition-colors hover:bg-ink-50/40"
                  >
                    <span className="w-6 shrink-0 font-mono text-[11px] uppercase tracking-[0.18em] text-paper-faint">
                      {number}
                    </span>
                    <span
                      className={cn(
                        "grid h-8 w-8 shrink-0 place-items-center rounded-xs border transition-colors",
                        isActive
                          ? "border-ink-700 bg-ink-200 text-paper"
                          : "border-ink-500 bg-ink-100 text-paper-muted"
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="flex flex-1 items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          "text-[15px] font-semibold leading-tight transition-colors",
                          isActive ? "text-paper" : "text-paper-dim"
                        )}
                      >
                        {group.category}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
                        {group.items.length}
                      </span>
                    </span>
                    {isActive && (
                      <motion.span
                        layoutId="featuresRailActive"
                        className="absolute inset-y-0 left-0 w-px bg-accent"
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="col-span-8">
            <motion.div
              key={activeGroup.category}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="border-t border-ink-500 pt-8"
            >
              <h3 className="text-display-md font-semibold text-paper">
                {activeGroup.category}
              </h3>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
                {activeGroup.items.length} {activeGroup.items.length === 1 ? "feature" : "features"}
              </p>
              <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-6 xl:grid-cols-2">
                {activeGroup.items.map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <div key={item.title} className="flex items-start gap-3">
                      <ItemIcon className="mt-1 h-4 w-4 shrink-0 text-paper-dim" aria-hidden />
                      <div className="flex flex-col gap-1">
                        <h4 className="text-[15px] font-semibold leading-tight text-paper">
                          {item.title}
                        </h4>
                        <p className="text-sm leading-relaxed text-paper-muted">
                          {item.desc}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </div>
        </div>

        {/* Mobile: accordion (same behavior as before) */}
        <div className="mt-16 grid grid-cols-12 gap-x-6 gap-y-4 lg:hidden">
          {GROUPS.map((group, idx) => {
            const Icon = group.icon;
            const isOpen = openIndex === idx;
            const number = String(idx + 1).padStart(2, "0");

            return (
              <div key={group.category} className="col-span-12 border-t border-ink-500 first:border-t-0">
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? -1 : idx)}
                  aria-expanded={isOpen}
                  className="group flex w-full items-center gap-4 py-6 text-left transition-colors hover:bg-ink-50/40 md:gap-6"
                >
                  <span className="hidden w-8 shrink-0 font-mono text-[11px] uppercase tracking-[0.18em] text-paper-faint md:inline">
                    {number}
                  </span>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper-muted transition-colors group-hover:border-ink-700 group-hover:text-paper">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="flex flex-1 flex-col gap-1 md:flex-row md:items-baseline md:gap-3">
                    <span className="text-2xl font-semibold leading-tight text-paper md:text-display-md">
                      {group.category}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint md:text-[11px] md:tracking-[0.14em]">
                      {group.items.length} {group.items.length === 1 ? "feature" : "features"}
                    </span>
                  </span>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xs border border-ink-500 text-paper-muted transition-colors group-hover:text-paper">
                    {isOpen ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-1 gap-x-8 gap-y-6 pb-10 pl-16 pr-4 md:pl-20 md:grid-cols-2">
                        {group.items.map((item) => {
                          const ItemIcon = item.icon;
                          return (
                            <div key={item.title} className="flex items-start gap-3">
                              <ItemIcon className="mt-1 h-4 w-4 shrink-0 text-paper-dim" aria-hidden />
                              <div className="flex flex-col gap-1">
                                <h3 className="text-[15px] font-semibold leading-tight text-paper">
                                  {item.title}
                                </h3>
                                <p className="text-sm leading-relaxed text-paper-muted">
                                  {item.desc}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* Why teams pick it — pillars block (former Highlights section, kept under the same anchor) */}
        <div id="highlights" className="mt-20 border-t border-ink-500 pt-16" aria-label="Why teams pick it">
          <div className="flex flex-col gap-4">
            <span className="label-mono inline-flex items-center gap-3">
              <span className="h-px w-6 bg-ink-700" aria-hidden />
              <span>Why teams pick it</span>
            </span>
            <h3 className="max-w-2xl text-display-md font-semibold tracking-tight text-paper text-balance">
              Built for the parts your DBA actually cares about.
            </h3>
            <p className="max-w-2xl text-lg leading-relaxed text-paper-muted">
              Plenty of ClickHouse tools nail one of these — CHouse UI is the combination. The things that matter
              when money or compliance is on the line.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-ink-500 bg-ink-500 sm:grid-cols-2 lg:grid-cols-4">
            {HIGHLIGHTS.map((h, idx) => {
              const Icon = h.icon;
              return (
                <motion.div
                  key={h.title}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 0.5, delay: (idx % 4) * 0.06, ease: [0.16, 1, 0.3, 1] }}
                  className="group flex flex-col gap-6 bg-ink-100 p-6 transition-colors hover:bg-ink-200 md:p-8"
                >
                  <div className="flex items-center justify-between">
                    <span className="grid h-10 w-10 place-items-center rounded-xs border border-ink-500 bg-ink-200 text-paper transition-colors group-hover:border-accent group-hover:text-accent">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                      {h.meta}
                    </span>
                  </div>
                  <div className="flex flex-col gap-3">
                    <h4 className="text-display-md font-semibold leading-tight text-paper">
                      {h.title}
                    </h4>
                    <p className="text-sm leading-relaxed text-paper-muted">
                      {h.desc}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </Container>
    </Section>
  );
}
