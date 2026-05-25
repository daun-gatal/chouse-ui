import { Shield, Users, FileText, LayoutGrid, Stethoscope, Activity, type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { Section, Container, SectionHeader } from "./Section";

interface Highlight {
  icon: LucideIcon;
  title: string;
  description: string;
  meta: string;
}

// The six pillars that make up the "combination" — a team access layer
// (security / RBAC / audit) × fleet monitoring × an autonomous AI SRE.
const HIGHLIGHTS: Highlight[] = [
  {
    icon: Shield,
    title: "Encrypted credentials",
    description: "AES-256-GCM connection passwords, Argon2id user passwords, JWT with refresh — secrets live server-side, so the browser never sees a ClickHouse password.",
    meta: "Server-side only",
  },
  {
    icon: Users,
    title: "Role-based access",
    description: "Six predefined roles, ~40 permissions, and granular data-access rules per user, database, and table.",
    meta: "RBAC built-in",
  },
  {
    icon: FileText,
    title: "Audit logging",
    description: "Every action and query recorded with the real session context — user, user-agent, and geo.",
    meta: "Full trail",
  },
  {
    icon: LayoutGrid,
    title: "Multi-cluster fleet",
    description: "Every connected cluster in one pane — status, memory, exceptions, trends — each card polling independently.",
    meta: "One pane",
  },
  {
    icon: Stethoscope,
    title: "Autonomous AI SRE",
    description: "Chouse AI runs read-only root-cause scans, writes fixes with before→after EXPLAIN proof, and delivers RCA to Slack on a breach.",
    meta: "Read-only",
  },
  {
    icon: Activity,
    title: "Deep observability",
    description: "ClickHouse-native monitoring — query logs, memory breakdown, top-resource queries, replica lag, schema lints. No exporter to install.",
    meta: "No exporter",
  },
];

export default function Highlights() {
  return (
    <Section id="highlights" aria-label="Highlights">
      <Container>
        <SectionHeader
          eyebrow="Why teams pick it"
          eyebrowIndex={5}
          title="Built for the parts your DBA actually cares about."
          description="Plenty of ClickHouse tools nail one of these — CHouse UI is the combination. The things that matter when money or compliance is on the line."
        />

        <div className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-ink-500 bg-ink-500 sm:grid-cols-2 lg:grid-cols-3">
          {HIGHLIGHTS.map((h, idx) => {
            const Icon = h.icon;
            return (
              <motion.div
                key={h.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.5, delay: (idx % 3) * 0.06, ease: [0.16, 1, 0.3, 1] }}
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
                  <h3 className="text-display-md font-semibold leading-tight text-paper">
                    {h.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-paper-muted">
                    {h.description}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </Container>
    </Section>
  );
}
