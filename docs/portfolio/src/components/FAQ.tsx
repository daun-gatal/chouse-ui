import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Minus } from "lucide-react";
import { Section, Container, SectionHeader } from "./Section";

interface FaqItem {
  question: string;
  answer: string;
}

const FAQS: FaqItem[] = [
  {
    question: "What is CHouse UI, exactly?",
    answer: "An open-source web UI for managing ClickHouse — encrypted credential storage, RBAC, audit logging, SQL editor, and AI-assisted query tooling. Built so a team can share one workspace without sharing one password.",
  },
  {
    question: "How is it different from other ClickHouse UIs?",
    answer: "A few tools now do AI, and a few do multi-cluster — the combination is the point. CHouse UI pairs a team access layer (app-level RBAC with 6 roles and ~40 permissions, row-level data-access rules, audit logging, and encrypted server-side credentials so the browser never sees a ClickHouse password) with an autonomous, read-only AI SRE: it runs root-cause scans, writes fixes with before→after EXPLAIN proof, and delivers RCA to Slack on an alert breach. Most UIs are a solo query workspace or a dashboard; this is a team's operations console.",
  },
  {
    question: "Why not just Grafana + a ClickHouse exporter?",
    answer: "Grafana is great for dashboards, but you can't kill a runaway query from it, manage RBAC and encrypted connections, browse the schema, or get an AI root-cause analysis. CHouse UI is the operator's console — it acts on the cluster, not just graphs it. Plenty of teams run both.",
  },
  {
    question: "Why not the raw clickhouse-client or the built-in play UI?",
    answer: "They're perfect for a quick solo query. What they don't give you: multi-user RBAC, an audit trail, encrypted server-side credentials, a multi-cluster fleet view, or AI assistance. CHouse UI is the team-and-operations layer on top of ClickHouse.",
  },
  {
    question: "Is it free and open source?",
    answer: "Yes. Apache License 2.0. Use it commercially, modify it, redistribute it — see the LICENSE file. Contributions welcome.",
  },
  {
    question: "What security primitives are used?",
    answer: "AES-256-GCM for ClickHouse passwords, Argon2id (via Bun.password) for user passwords, JWT (jose) with short access + long refresh tokens, CSP and security headers, request size + rate limits, and SQL parsing before every query reaches ClickHouse.",
  },
  {
    question: "Can I connect multiple ClickHouse servers?",
    answer: "Yes. Multi-connection is first-class — switch between servers from the connection selector. Each connection's credentials are encrypted independently.",
  },
  {
    question: "Which database backends are supported for RBAC metadata?",
    answer: "SQLite (default, perfect for single-instance) and PostgreSQL (for multi-instance / production HA). Same schema via Drizzle ORM, switched by RBAC_DB_TYPE.",
  },
  {
    question: "How do I deploy it?",
    answer: "Docker Compose or Kubernetes. In production NODE_ENV, the server refuses to start without JWT_SECRET, RBAC_ENCRYPTION_KEY, and RBAC_ENCRYPTION_SALT — by design. See the Production section above for the manifests and config.",
  },
  {
    question: "Does the browser ever talk to ClickHouse directly?",
    answer: "No. Every request goes through the Bun/Hono backend. The browser never sees a ClickHouse password. This is the whole point.",
  },
  {
    question: "What roles ship by default?",
    answer: "Six: Super Admin (priority 100), Admin (80), Developer (60), Analyst (40), Viewer (20), Guest (10). You can create custom roles with any subset of ~40 permissions, plus row-level data access rules with wildcard / regex / deny.",
  },
  {
    question: "Does it use ClickHouse's own users and grants?",
    answer: "No — it adds its own layer on top. The ClickHouse credentials are stored encrypted server-side, and access is gated by app-level roles, permissions, and data-access rules — so a team shares one workspace without each person needing a ClickHouse account or the connection password. (Some UIs instead mirror ClickHouse's native grants — simpler, but it ties UI access to CH-level users.)",
  },
  {
    question: "How does the AI Optimizer work?",
    answer: "The optimizer and debugger run as tool-using agents on top of Vercel AI SDK v6 — they call shared ClickHouse tools (list databases, get DDL, run EXPLAIN, validate SQL) under RBAC, then return structured suggestions. Supports OpenAI, Anthropic, Google, HuggingFace, and OpenAI-compatible providers.",
  },
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number>(0);

  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <Section id="faq" aria-label="Frequently asked questions">
        <Container>
          <SectionHeader
            eyebrow="Frequently asked"
            eyebrowIndex={9}
            title="Questions, answered straight."
            description="If you have a different one, the GitHub issues are the right place."
          />

          <div className="mt-16 grid grid-cols-12 gap-x-6 gap-y-0">
            <div className="col-span-12">
              {FAQS.map((faq, idx) => {
                const isOpen = openIndex === idx;
                const number = String(idx + 1).padStart(2, "0");
                return (
                  <div key={faq.question} className="border-t border-ink-500 last:border-b">
                    <button
                      type="button"
                      onClick={() => setOpenIndex(isOpen ? -1 : idx)}
                      aria-expanded={isOpen}
                      className="group flex w-full items-start gap-6 py-6 text-left transition-colors hover:bg-ink-50/40"
                    >
                      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-faint w-8 shrink-0 pt-1">
                        {number}
                      </span>
                      <span className="flex-1 text-[18px] font-medium leading-snug text-paper">
                        {faq.question}
                      </span>
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xs border border-ink-500 text-paper-muted transition-colors group-hover:text-paper">
                        {isOpen ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                      </span>
                    </button>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                          className="overflow-hidden"
                        >
                          <p className="max-w-3xl pb-8 pl-14 pr-12 text-[15px] leading-relaxed text-paper-muted">
                            {faq.answer}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
