import { motion } from "framer-motion";
import {
  KeyRound,
  Terminal,
  Bot,
  ArrowUpRight,
  ShieldCheck,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import { Section, Container, SectionHeader, CodeBlock, SecondaryAction, Tag } from "./Section";

/**
 * Programmatic access — the PAT → CLI → MCP chain. One credential, three
 * surfaces: the browser is optional. Numbered section (07), after Quick Start.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

const MCP_REFERENCE_URL =
  "https://github.com/daun-gatal/chouse-ui/blob/main/docs/mcp.md";
const CLI_REFERENCE_URL =
  "https://github.com/daun-gatal/chouse-ui/blob/main/docs/cli.md";
const MCP_LAB_UI_URL = "https://lab.chouse-ui.com";

const CLI_INSTALL = `curl -sSL https://github.com/daun-gatal/chouse-ui/releases/latest/download/install-cli.sh | bash
chouse auth login --server https://chouse.your-company.com --token ch_pat_…`;

const MCP_CLAUDE = `claude mcp add --transport http chouse \\
  https://mcp.chouse-ui.com/mcp \\
  --header "Authorization: Bearer ch_pat_…"`;

const MCP_CODEX = `codex mcp add chouse --url https://mcp.chouse-ui.com/mcp \\
  --bearer-token-env-var CH_HOUSE_PAT`;

interface Step {
  icon: LucideIcon;
  title: string;
  kicker: string;
  description: React.ReactNode;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    icon: KeyRound,
    kicker: "Mint a credential",
    title: "Personal access token",
    description: (
      <>
        One token in <span className="text-paper">Preferences → Personal access
        tokens</span>. Scoped to your roles, attributed in the audit log, and
        revocation takes effect on the very next call.
      </>
    ),
    body: (
      <div className="flex flex-wrap gap-2">
        <Tag>ch_pat_…</Tag>
        <Tag variant="accent">
          <ShieldCheck className="h-3 w-3" aria-hidden />
          Scoped
        </Tag>
        <Tag variant="muted">
          <RotateCcw className="h-3 w-3" aria-hidden />
          Instant revoke
        </Tag>
      </div>
    ),
  },
  {
    icon: Terminal,
    kicker: "Automate scripts & CI",
    title: "chouse CLI",
    description: (
      <>
        Query, explore, monitor the fleet, and run scheduled work from the
        terminal. Safe by default — destructive commands need{" "}
        <code className="font-mono text-[12px] text-paper">--yes</code> and
        offer <code className="font-mono text-[12px] text-paper">--dry-run</code>.
      </>
    ),
    body: <CodeBlock language="bash" filename="shell" code={CLI_INSTALL} />,
  },
  {
    icon: Bot,
    kicker: "Connect AI agents",
    title: "MCP server",
    description: (
      <>
        A Model Context Protocol endpoint any agent can operate — read-only by
        default, destructive tools always need human approval in the agent
        host. Works with the hosted lab — see below — or your own deployment.
      </>
    ),
    body: (
      <div className="flex flex-col gap-3">
        <CodeBlock language="bash" filename="Claude Code" code={MCP_CLAUDE} />
        <CodeBlock language="bash" filename="Codex CLI" code={MCP_CODEX} />
        <McpLabCard />
      </div>
    ),
  },
];

const MCP_LAB_STEPS = [
  {
    number: "01",
    label: "Sign in to the lab",
    link: true,
    body: "Account-less guest session, no deployment.",
  },
  {
    number: "02",
    label: "Mint a token",
    link: false,
    body: "Preferences → Personal access tokens.",
  },
  {
    number: "03",
    label: "Point your agent at the endpoint",
    link: false,
    body: null,
  },
] as const;

function McpLabCard() {
  return (
    <div className="mt-3 rounded-md border border-accent/30 bg-accent/[0.04] p-5">
      <p className="text-[15px] font-semibold text-paper">
        Want to try MCP without installing anything?
      </p>

      <div className="mt-5 flex flex-col">
        {MCP_LAB_STEPS.map((step, idx) => {
          const isLast = idx === MCP_LAB_STEPS.length - 1;
          return (
            <div
              key={step.number}
              className="relative grid grid-cols-[auto_1fr] gap-x-4"
              style={isLast ? undefined : { paddingBottom: "1.25rem" }}
            >
              <div className="flex flex-col items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xs border border-ink-500 bg-ink-100 font-mono text-[10px] text-paper">
                  {step.number}
                </span>
                {!isLast && <span className="w-px flex-1 bg-ink-500" aria-hidden />}
              </div>
              <div className="flex flex-col gap-1 pt-0.5">
                <span className="text-[14px] font-semibold text-paper">
                  {step.link ? (
                    <a
                      href={MCP_LAB_UI_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group inline-flex items-center gap-1.5 underline decoration-ink-700 underline-offset-4 transition-colors hover:decoration-accent"
                    >
                      {step.label}
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    step.label
                  )}
                </span>
                {step.body && (
                  <p className="text-[12.5px] text-paper-muted">{step.body}</p>
                )}
                {step.number === "03" && (
                  <CodeBlock
                    language="bash"
                    filename="agent config"
                    code={MCP_CLAUDE}
                    className="mt-1"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-paper-faint">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
        Read-only by default. Revoke the token when you're done.
      </p>
    </div>
  );
}

export default function Automate() {
  return (
    <Section id="automate" aria-label="Programmatic access">
      <Container>
        <SectionHeader
          eyebrow="Programmatic access"
          eyebrowIndex={6}
          title="Take CHouse UI beyond the browser."
          description="One credential, three surfaces. Mint a personal access token and the same cluster works from scripts, CI pipelines, and AI agents — with the same RBAC, audit trail, and safe-by-default gates as the UI."
        />

        <ol className="mt-16 flex flex-col">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            const number = String(idx + 1).padStart(2, "0");
            const isLast = idx === STEPS.length - 1;
            return (
              <motion.li
                key={step.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.55, ease: EASE }}
                className="relative grid grid-cols-[auto_1fr] gap-x-6 gap-y-6 border-t border-ink-500 pt-10 md:gap-x-10 md:pt-12"
                style={isLast ? { paddingBottom: "0" } : { paddingBottom: "3rem" }}
              >
                <div className="flex flex-col items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xs border border-ink-500 bg-ink-100 font-mono text-[12px] text-paper">
                    {number}
                  </span>
                  {!isLast && <span className="w-px flex-1 bg-ink-500" aria-hidden />}
                </div>
                <div className="flex flex-col gap-5 pb-2">
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                      {step.kicker}
                    </span>
                    <h3 className="flex items-center gap-2.5 text-display-md font-semibold text-paper">
                      <Icon className="h-5 w-5 text-paper-muted" aria-hidden />
                      {step.title}
                    </h3>
                    <p className="max-w-2xl text-sm leading-relaxed text-paper-muted">
                      {step.description}
                    </p>
                  </div>
                  <div>{step.body}</div>
                </div>
              </motion.li>
            );
          })}
        </ol>

        <div className="mt-16 flex flex-col items-start gap-3 border-t border-ink-500 pt-10">
          <div className="flex flex-wrap items-center gap-3">
            <SecondaryAction href={MCP_REFERENCE_URL} target="_blank" rel="noreferrer">
              MCP reference
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </SecondaryAction>
            <SecondaryAction href={CLI_REFERENCE_URL} target="_blank" rel="noreferrer">
              CLI reference
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </SecondaryAction>
          </div>
        </div>
      </Container>
    </Section>
  );
}
