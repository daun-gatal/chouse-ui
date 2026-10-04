import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Minus } from "lucide-react";
import { Section, Container, SectionHeader } from "./Section";

interface FaqItem {
  question: string;
  answer: string;
  /** Optional deep links into the product documentation (/docs). */
  docs?: Array<{ label: string; href: string }>;
}

const FAQS: FaqItem[] = [
  {
    question: "What is CHouse UI, exactly?",
    answer: "An open-source, self-hosted console for running ClickHouse as a team: query and explore, watch the clusters and the data in them, trace problems to their root cause, and fix them with approval — with its own RBAC, audit log and encrypted credentials, and the same rules for AI agents and scripts.",
    docs: [{ label: "Introduction", href: "/docs/overview/" }],
  },
  {
    question: "How is it different from other ClickHouse UIs?",
    answer: "Most ClickHouse UIs are a solo query workspace or a dashboard. CHouse UI watches the data itself — every table and pipeline against its own baseline, lineage without instrumentation — turns a stale table into one incident with a computed root cause and blast radius, and runs fixes only after people approve them. Around that sits a team access layer: app-level RBAC with 100+ permissions, per-connection data access policies, SSO, an audit trail and server-side encrypted credentials — and AI agents get the same rules over MCP.",
    docs: [{ label: "Introduction", href: "/docs/overview/" }],
  },
  {
    question: "Does it watch the data, or just the cluster?",
    answer: "Both. From ClickHouse's own metadata it learns how often each table is written and how much, tracks every ingestion pipeline (views, Kafka, S3Queue and more), and builds lineage — without scanning your tables or installing anything. When something breaks it opens one incident with the root cause and everything downstream, and fixes run only after approval.",
    docs: [{ label: "How data is watched", href: "/docs/data-observability/" }],
  },
  {
    question: "Why not just Grafana + a ClickHouse exporter?",
    answer: "Grafana is great for dashboards, but you can't kill a runaway query from it, manage RBAC and encrypted connections, browse the schema, or get an AI root-cause analysis. CHouse UI is the operator's console — it acts on the cluster, not just graphs it. Plenty of teams run both.",
    docs: [{ label: "Monitoring", href: "/docs/monitoring-overview/" }],
  },
  {
    question: "Why not the raw clickhouse-client or the built-in play UI?",
    answer: "They're perfect for a quick solo query. What they don't give you: multi-user RBAC, an audit trail, encrypted server-side credentials, a multi-cluster fleet view, or AI assistance. CHouse UI is the team-and-operations layer on top of ClickHouse.",
    docs: [{ label: "Core concepts", href: "/docs/concepts/" }],
  },
  {
    question: "Is it free and open source?",
    answer: "Yes. Apache License 2.0. Use it commercially, modify it, redistribute it — see the LICENSE file. Contributions welcome.",
    docs: [{ label: "Introduction", href: "/docs/overview/" }],
  },
  {
    question: "What security primitives are used?",
    answer: "AES-256-GCM for ClickHouse passwords, Argon2id (via Bun.password) for user passwords, JWT (jose) with short access + long refresh tokens, CSP and security headers, request size + rate limits, and SQL parsing before every query reaches ClickHouse.",
    docs: [{ label: "Security model", href: "/docs/security/" }],
  },
  {
    question: "Does it support SSO / single sign-on?",
    answer: "Yes. CHouse UI supports OIDC (discovery via issuer), plain OAuth2 and SAML 2.0 providers — Okta, Google, GitHub, Keycloak, Entra and any compliant IdP. It uses the Authorization Code flow with PKCE; the client secret stays on the server. First login creates the user just-in-time with a configurable default role. If the IdP returns a verified email that matches an existing account, the two are linked. Optionally, you can map an IdP groups claim to app roles so role assignments stay in sync. SSO is off by default and has no effect unless auth.sso.enabled is true in your config.",
    docs: [{ label: "SSO guide", href: "/docs/sso/" }],
  },
  {
    question: "Can I connect multiple ClickHouse servers?",
    answer: "Yes. Multi-connection is first-class — switch between servers from the connection selector. Each connection's credentials are encrypted independently.",
    docs: [{ label: "Connections", href: "/docs/connections/" }],
  },
  {
    question: "Which database backends are supported for RBAC metadata?",
    answer: "SQLite (default, perfect for single-instance) and PostgreSQL (for multi-instance / production HA). Same schema via Drizzle ORM, switched by RBAC_DB_TYPE.",
    docs: [{ label: "Architecture", href: "/docs/architecture/" }],
  },
  {
    question: "How do I deploy it?",
    answer: "Docker Compose or Kubernetes. In production NODE_ENV, the server refuses to start without JWT_SECRET, RBAC_ENCRYPTION_KEY, and RBAC_ENCRYPTION_SALT — by design. See the Production section above for the manifests and config.",
    docs: [{ label: "Docker deployment", href: "/docs/deploy-docker/" }],
  },
  {
    question: "Does the browser ever talk to ClickHouse directly?",
    answer: "No. Every request goes through the Bun/Hono backend. The browser never sees a ClickHouse password. This is the whole point.",
    docs: [{ label: "Security model", href: "/docs/security/" }],
  },
  {
    question: "What roles ship by default?",
    answer: "Six: Super Admin (priority 100), Admin (80), Developer (60), Analyst (40), Viewer (20), Guest (10). You can create custom roles from any of the 100+ permissions, and attach data access policies — database and table rules per connection, with wildcards, regex and deny.",
    docs: [{ label: "Users & roles", href: "/docs/rbac-roles/" }],
  },
  {
    question: "Does it use ClickHouse's own users and grants?",
    answer: "No — it adds its own layer on top. The ClickHouse credentials are stored encrypted server-side, and access is gated by app-level roles, permissions, and data-access rules — so a team shares one workspace without each person needing a ClickHouse account or the connection password. (Some UIs instead mirror ClickHouse's native grants — simpler, but it ties UI access to CH-level users.)",
    docs: [{ label: "Users & roles", href: "/docs/rbac-roles/" }],
  },
  {
    question: "How does the AI Optimizer work?",
    answer: "The optimizer and debugger run as DeepAgents/LangChain tool-using agents — they call shared ClickHouse tools (list databases, get DDL, run EXPLAIN, validate SQL) under RBAC, then return structured suggestions. Supports OpenAI, Anthropic, Google, Azure OpenAI, Bedrock, Ollama and ten more providers, plus any OpenAI-compatible server.",
    docs: [{ label: "AI Assist", href: "/docs/workspace-ai-assist/" }],
  },
  {
    question: "Can AI agents or scripts query my cluster?",
    answer: "Yes — mint a personal access token in Preferences and the same cluster works beyond the browser. The chouse CLI covers scripts and CI (query, explore, monitor the fleet, manage scheduled work — destructive commands need --yes and offer --dry-run). The MCP server at /mcp covers AI agents like Claude, Codex, and Cursor: an administrator turns it on and picks the tools in Agents › MCP (reads on, everything else off by default), every call re-checks live roles and token scopes, and agent queries pass budget checks first. A hosted lab at mcp.chouse-ui.com lets you try the MCP endpoint without deploying anything.",
    docs: [
      { label: "CLI", href: "/docs/cli/" },
      { label: "MCP server", href: "/docs/mcp/" },
    ],
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
            eyebrowIndex={8}
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
                          <div className="max-w-3xl pb-8 pl-14 pr-12">
                            <p className="text-[15px] leading-relaxed text-paper-muted">{faq.answer}</p>
                            {faq.docs && (
                              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                                {faq.docs.map((doc) => (
                                  <a
                                    key={doc.href}
                                    href={doc.href}
                                    className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-paper-dim transition-colors hover:text-paper"
                                  >
                                    <span aria-hidden className="text-accent">→</span>
                                    {doc.label}
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
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
