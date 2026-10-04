import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, Database, BarChart3, Lock, Users, FileText, Zap, Search,
  Download, Eye, Plus, Minus, Activity, Star, Sparkles, Bot, MessageSquare,
  Terminal, KeyRound, Gauge, Layers, Stethoscope, Network, SunMoon,
  LayoutGrid, BellRing, Radar, CalendarClock, GitBranch, HeartPulse,
  Workflow, ShieldCheck, BookOpen, Siren, Wrench, NotebookPen, GitPullRequestArrow,
  TrendingUp, HardDrive, ArrowUpCircle, ArrowRight,
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
  /** Docs hub or page for the whole category. */
  docs: string;
  items: FeatureItem[];
}

const GROUPS: FeatureGroup[] = [
  {
    category: "Data observability",
    icon: Radar,
    docs: "/docs/data-observability/",
    items: [
      { icon: HeartPulse, title: "Every table, from day one", desc: "Freshness and volume baselines learned from system.parts and query_log — trusted, degraded or stale per table, without scanning it" },
      { icon: Workflow, title: "Every pipeline, one vocabulary", desc: "Views, Kafka, RabbitMQ, NATS, S3Queue, AzureQueue, replication, writers and jobs — healthy, lagging, stalled, retrying, failing or stopped" },
      { icon: GitBranch, title: "Lineage without instrumentation", desc: "One graph from metadata, INSERT … SELECT in query_log, scheduled jobs, saved queries and agents — upstream or downstream" },
      { icon: ShieldCheck, title: "Promises & coverage", desc: "Nine check types from freshness to distribution drift, suggested for the tables people actually read, with low-noise incidents" },
      { icon: BookOpen, title: "Context for people and agents", desc: "Owners, grain, canonical metrics, dbt import, and plain-language watchers that become reviewed promises" },
      { icon: CalendarClock, title: "Scheduled queries", desc: "Cron or event-driven SQL with deterministic windows and idempotent append, replace or upsert — across a cluster too" },
    ],
  },
  {
    category: "Root cause & fixes",
    icon: Siren,
    docs: "/docs/data-incidents/",
    items: [
      { icon: Siren, title: "Root cause across layers", desc: "A deterministic chain from the data symptom down through transform, ingestion and external sources to the engine — evidence at every step" },
      { icon: Network, title: "Blast radius", desc: "Every table, promise, job, saved query and agent downstream of the cause, before you start fixing" },
      { icon: Wrench, title: "Fixes with approval", desc: "A closed catalog of actions, run with a separate credential only after approval — two approvers for high-impact changes, verified, reversible" },
      { icon: NotebookPen, title: "Investigation notebooks", desc: "AI findings, query snapshots and notes in one shared notebook, exported as a postmortem" },
      { icon: GitPullRequestArrow, title: "Schema preflight", desc: "DDL that would break a view, dictionary, job, promise or saved query is stopped with the impact and a safer plan" },
      { icon: MessageSquare, title: "Approve anywhere", desc: "In the UI, from signed Slack buttons, or with chouse remediation approve" },
    ],
  },
  {
    category: "Monitoring & fleet",
    icon: Gauge,
    docs: "/docs/monitoring-overview/",
    items: [
      { icon: LayoutGrid, title: "Fleet view", desc: "Every connection side by side — status, memory, lag, trends — sampled once by the server, not by every browser" },
      { icon: TrendingUp, title: "Performance regressions", desc: "Each query shape against its own 14-day baseline, lined up with the upgrades, DDL and setting changes around it" },
      { icon: HardDrive, title: "Capacity & cost", desc: "Disk forecasts per node, top growth, codec savings measured on samples, and cost by consumer" },
      { icon: ArrowUpCircle, title: "Upgrade readiness", desc: "A target version checked against your workload, replayed on a canary, then tracked through rollout gates" },
      { icon: Activity, title: "Ten monitoring tabs", desc: "Live queries, query logs, metrics, parts, schema advisor, cluster, errors — no exporter to install" },
      { icon: BellRing, title: "Alerts", desc: "Memory, long queries and too-many-parts ETA to Slack, Google Chat, email or webhooks — with an AI root-cause report on breach" },
    ],
  },
  {
    category: "Chouse AI",
    icon: Sparkles,
    docs: "/docs/doctor/",
    items: [
      { icon: Stethoscope, title: "Doctor", desc: "An AI health check of your fleet with read-only queries — scheduled, or triggered by an alert — that proposes fixes for approval" },
      { icon: Zap, title: "Optimize in place", desc: "A rewrite of a logged query with the same result, a before→after EXPLAIN, and one click to open it" },
      { icon: Bot, title: "Diagnose errors & parts", desc: "Cause, impact and ordered fixes on a system.errors row or a part-log entry" },
      { icon: MessageSquare, title: "AI Assist & chat", desc: "Schema-aware optimizer, debugger and chat in the SQL editor" },
      { icon: Eye, title: "Facts vs. interpretation", desc: "Incident explanations keep what was observed apart from what is inferred — the AI never picks the root cause" },
      { icon: KeyRound, title: "Your model", desc: "OpenAI, Anthropic, Google, Azure, Bedrock, Ollama and ten more — or any OpenAI-compatible server you host" },
    ],
  },
  {
    category: "Agents & automation",
    icon: Bot,
    docs: "/docs/automation/",
    items: [
      { icon: Bot, title: "MCP at /mcp", desc: "On the UI's own address, turned on and tool-by-tool in Agents › MCP — reads on, everything else off until you say so" },
      { icon: Gauge, title: "Agent governance", desc: "Every agent session recorded, budgets checked with EXPLAIN ESTIMATE before queries run, health notices in results, a pause switch" },
      { icon: Terminal, title: "chouse CLI 1.0", desc: "Tables in a terminal, JSON when piped, profiles, exit codes, and --yes / --dry-run on anything that changes data" },
      { icon: KeyRound, title: "Personal access tokens", desc: "Scoped, expiring, rotatable ch_pat_ tokens that carry their owner's live permissions" },
    ],
  },
  {
    category: "Security & access",
    icon: Shield,
    docs: "/docs/access/",
    items: [
      { icon: Users, title: "Users, roles & 100+ permissions", desc: "Six built-in roles and custom ones, grouped by the same categories in the UI and the docs" },
      { icon: Shield, title: "Data access policies", desc: "Named database and table rules per connection, attached to roles, checked on every query" },
      { icon: Lock, title: "Encrypted credentials", desc: "AES-256-GCM for connection and remediation passwords — the browser never sees a ClickHouse password" },
      { icon: KeyRound, title: "SSO", desc: "OIDC, OAuth2 and SAML with role mapping, JIT provisioning, and SSO-only sign-in" },
      { icon: FileText, title: "Audit log", desc: "Sign-ins, admin changes, queries, fixes and every MCP call, with over a hundred event types" },
      { icon: Database, title: "ClickHouse users & roles", desc: "Manage native ClickHouse accounts and grants from the same UI" },
    ],
  },
  {
    category: "Query & explore",
    icon: BarChart3,
    docs: "/docs/workspace-editor/",
    items: [
      { icon: FileText, title: "SQL editor", desc: "Monaco with schema-aware completion, execution stats and per-tab history" },
      { icon: Layers, title: "Visual EXPLAIN", desc: "A query's plan before you run it, in a pop-out view" },
      { icon: Search, title: "Database Explorer", desc: "Tree view with schema inspection, DDL and MergeTree table management" },
      { icon: Star, title: "Saved queries & favorites", desc: "Saved, shared and favorite queries and tables, a step away" },
      { icon: Download, title: "Upload & export", desc: "CSV, TSV and JSON in and out" },
      { icon: SunMoon, title: "Command palette", desc: "⌘K to every page and table, keyboard shortcuts, and light, dark or auto themes" },
    ],
  },
];

// Pillars — the "why teams pick it" view.
const HIGHLIGHTS: Array<FeatureItem & { meta: string }> = [
  {
    icon: Radar,
    title: "Watches the data itself",
    desc: "Every table and every pipeline against its own learned baseline, from ClickHouse metadata — no scans, no agents on your clusters.",
    meta: "Day one",
  },
  {
    icon: Siren,
    title: "Root cause, not alerts",
    desc: "A stale dashboard becomes one incident with a computed cause, the evidence and everything it affects.",
    meta: "Cross-layer",
  },
  {
    icon: Wrench,
    title: "Fixes people approve",
    desc: "Catalog actions, a separate credential, two approvers for high-impact changes, verification and rollback.",
    meta: "Nothing unapproved",
  },
  {
    icon: Users,
    title: "Built for teams",
    desc: "Own users and roles, data access policies per connection, SSO and a full audit trail.",
    meta: "RBAC built-in",
  },
  {
    icon: Bot,
    title: "Agents under the same rules",
    desc: "MCP and tokens carry their owner's permissions, plus budgets, health notices and a pause switch.",
    meta: "Governed",
  },
  {
    icon: Shield,
    title: "Self-hosted, open source",
    desc: "One container, one port, SQLite or PostgreSQL. Your credentials and prompts stay where you put them.",
    meta: "Apache 2.0",
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
          description="Seven areas, one consistent UI. Pick one to browse it — every item is documented."
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
              <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
                  {activeGroup.items.length} {activeGroup.items.length === 1 ? "feature" : "features"}
                </p>
                <a
                  href={activeGroup.docs}
                  className="group inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted transition-colors hover:text-accent"
                >
                  Read the docs
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </a>
              </div>
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
                      <a
                        href={group.docs}
                        className="mb-10 ml-16 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted transition-colors hover:text-accent md:ml-20"
                      >
                        Read the docs
                        <ArrowRight className="h-3 w-3" aria-hidden />
                      </a>
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
