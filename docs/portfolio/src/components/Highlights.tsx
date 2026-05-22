import { Shield, Users, Database, Activity, type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { Section, Container, SectionHeader } from "./Section";

interface Highlight {
  icon: LucideIcon;
  title: string;
  description: string;
  meta: string;
}

const HIGHLIGHTS: Highlight[] = [
  {
    icon: Shield,
    title: "Enterprise security",
    description: "AES-256-GCM for connection passwords, Argon2id for user passwords, JWT with refresh.",
    meta: "Server-side only",
  },
  {
    icon: Users,
    title: "Role-based access",
    description: "Six predefined roles. Granular data-access rules per user, database, and table.",
    meta: "RBAC built-in",
  },
  {
    icon: Database,
    title: "Multi-connection",
    description: "Manage many ClickHouse servers from one UI. Switch connections instantly.",
    meta: "One workspace",
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
          description="Not feature theater — the things you need to deploy ClickHouse where money or compliance is involved."
        />

        <div className="mt-16 grid grid-cols-1 divide-y divide-ink-500 border-t border-ink-500 md:grid-cols-2 md:divide-x md:divide-y-0 lg:grid-cols-4">
          {HIGHLIGHTS.map((h, idx) => {
            const Icon = h.icon;
            return (
              <motion.div
                key={h.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.5, delay: idx * 0.06, ease: [0.16, 1, 0.3, 1] }}
                className="group flex flex-col gap-6 px-6 py-10 first:pl-0 lg:px-8 lg:first:pl-0 lg:last:pr-0"
              >
                <div className="flex items-center justify-between">
                  <span className="grid h-10 w-10 place-items-center rounded-xs border border-ink-500 bg-ink-100 text-paper transition-colors group-hover:border-accent group-hover:text-accent">
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
