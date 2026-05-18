import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, Database, BarChart3, Palette, Lock, Users, FileText, Zap, Search,
  Download, Settings, Eye, Plus, Minus, Activity, Star, Sparkles, Bot, MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { Section, Container, SectionHeader } from "./Section";

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
    category: "AI & Automation",
    icon: Sparkles,
    items: [
      { icon: Zap, title: "Query Optimizer", desc: "Intelligent query rewriting for performance" },
      { icon: Bot, title: "Query Debugging", desc: "Automated error analysis and fix suggestions" },
      { icon: MessageSquare, title: "Chat Assistant", desc: "Conversational data exploration and charts" },
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
      { icon: Star, title: "Favorites & Recent", desc: "Pin databases and tables for instant access" },
      { icon: Settings, title: "Responsive", desc: "Desktop and tablet, with draggable modals" },
      { icon: Zap, title: "Keyboard Shortcuts", desc: "Power-user shortcuts across the workspace" },
      { icon: Palette, title: "Dark Theme", desc: "Editorial dark UI tuned for long sessions" },
    ],
  },
];

export default function Features() {
  const [openIndex, setOpenIndex] = useState<number>(0);

  return (
    <Section id="features" aria-label="Features">
      <Container>
        <SectionHeader
          eyebrow="What's inside"
          eyebrowIndex={2}
          title="Everything you need to give ClickHouse to a team."
          description="Five domains, one consistent UI. Click a category to expand its items."
        />

        <div className="mt-16 grid grid-cols-12 gap-x-6 gap-y-4">
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
                      <div className="grid grid-cols-1 gap-x-8 gap-y-6 pb-10 pl-16 pr-4 md:pl-20 md:grid-cols-2 lg:grid-cols-3">
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
      </Container>
    </Section>
  );
}
