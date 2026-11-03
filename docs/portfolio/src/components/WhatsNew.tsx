import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, type LucideIcon, LogIn, ShieldCheck, Plug, ArrowUpCircle, FlaskConical, Server } from "lucide-react";
import { Section, Container, SectionHeader } from "./Section";
import { RELEASE, WHATS_NEW_PATH } from "../content/release";
import { withBase } from "../docs-site/lib";
import { cn } from "@/lib/utils";

/**
 * The current release, shown on real screens: one tab per headline feature,
 * each with a capture from scripts/docs-screenshots.sh and the three steps to
 * try it. Keep it to the release's biggest additions — the rest live on the
 * What's new page.
 */

interface Showcase {
  icon: LucideIcon;
  label: string;
  title: string;
  pitch: string;
  steps: string[];
  /** A capture name in public/docs/img/app/, without .jpg. */
  shot: string;
  alt: string;
  docs: { label: string; href: string };
}

const SHOWCASES: Showcase[] = [
  {
    icon: LogIn,
    label: "Sign in to MCP",
    title: "Paste the URL. Sign in. The agent works as you.",
    pitch: "Agents connect to CHouse MCP with the URL alone — even hosted ones with nowhere to paste a token. They open CHouse in your browser, you choose what they may change and for how long, and they get a token that only works on MCP, with your live access.",
    steps: [
      "Turn on AI Governance › MCP › Sign-in for agents",
      "Add https://<your CHouse>/mcp to your agent",
      "Sign in, pick its write tools and how long, then Allow",
    ],
    shot: "oauth-consent",
    alt: "The consent page an agent opens: its name, where it returns to, write tools and how long access lasts",
    docs: { label: "Sign in with OAuth", href: "/docs/mcp/#sign-in-with-oauth" },
  },
  {
    icon: ShieldCheck,
    label: "Agent controls",
    title: "Decide which agents get in, and for how long",
    pitch: "Sign-in starts off. Administrators decide whether pasted tokens still work on MCP, hold new agents until they are approved, limit where agents may return to and cap how long access lasts — and see every agent and who is connected through it.",
    steps: [
      "AI Governance › MCP › Sign-in for agents",
      "Approve new agents, or limit their return addresses",
      "Block an agent, or revoke one person's access",
    ],
    shot: "agents-mcp-sign-in",
    alt: "Sign-in for agents in AI Governance › MCP, with the agents list and who is connected",
    docs: { label: "Connect an AI agent", href: "/docs/guide-connect-an-agent/" },
  },
  {
    icon: Plug,
    label: "Connected apps",
    title: "Every agent you let in, with Revoke",
    pitch: "Agents you signed in are listed next to your tokens, with their write tools, when access ends and when they last called CHouse. Change what one may do, or revoke it at once.",
    steps: [
      "Open Preferences › Personal access tokens",
      "Check each agent's write tools, expiry and last use",
      "Use the wrench to change its tools, the bin to revoke it",
    ],
    shot: "preferences-connected-apps",
    alt: "Connected apps in Preferences: two agents signed in with OAuth above a personal access token",
    docs: { label: "Connected apps", href: "/docs/personal-access-tokens/#connected-apps" },
  },
  {
    icon: ArrowUpCircle,
    label: "Upgrade check",
    title: "See what a ClickHouse upgrade changes for your workload",
    pitch: "Upgrades says whether your version is still supported and which versions to move to, then checks a target against your schema, settings and 30 days of queries: exactly against a server on that line, or from the release notes.",
    steps: [
      "Open Monitoring › Upgrades and pick a target",
      "Compare with a connection on that line, or the notes",
      "Work through Breaks, then changed defaults; Copy as Markdown",
    ],
    shot: "monitoring-upgrades",
    alt: "Monitoring › Upgrades after an exact check of 25.8 against 26.8, with findings by severity",
    docs: { label: "Check an upgrade", href: "/docs/monitoring-upgrades/#check-an-upgrade" },
  },
  {
    icon: FlaskConical,
    label: "Try it on this server",
    title: "Find the queries the new analyzer breaks, before you upgrade",
    pitch: "A check plans your top 200 read-only query shapes on your current server with the target's settings, using EXPLAIN. Nothing runs. A query that would fail shows with the setting that breaks it, the error and who runs it.",
    steps: [
      "Leave “Also try my top 200 read-only query shapes…” on",
      "Click Check",
      "Open the Tried here finding, fix the queries, then stop turning the analyzer off",
    ],
    shot: "monitoring-upgrades-try",
    alt: "A Tried here finding: two query shapes that fail with the new analyzer, with their errors, users and run counts",
    docs: { label: "Try it on this server", href: "/docs/monitoring-upgrades/#try-it-on-this-server" },
  },
  {
    icon: Server,
    label: "Fleet versions",
    title: "Spot the clusters that need an upgrade",
    pitch: "On Fleet, a version turns red when its line is out of support and amber when a newer patch is out. Hover it for the reason; click it to check an upgrade for that connection.",
    steps: [
      "Set UPGRADE_CHECK_ENABLED (Helm observability.upgradeCheckEnabled)",
      "Open Fleet",
      "Click a red or amber version to open Upgrades",
    ],
    shot: "fleet",
    alt: "Fleet with four connections: two versions out of support in red, one behind on patches in amber",
    docs: { label: "Fleet view", href: "/docs/fleet/" },
  },
];

const EASE = [0.16, 1, 0.3, 1] as const;

export default function WhatsNew() {
  const [active, setActive] = useState(0);
  const item = SHOWCASES[active] ?? SHOWCASES[0];

  return (
    <Section id="whats-new" aria-label={`What's new in ${RELEASE.version}`}>
      <Container>
        <SectionHeader
          eyebrow={`New in ${RELEASE.version}`}
          title="AI agents that sign in, and upgrades checked against your workload."
          description="Real screens from this release. Pick one to see it and how to try it."
          action={
            <a
              href={withBase(WHATS_NEW_PATH)}
              className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-paper transition-colors hover:text-accent"
            >
              Everything in {RELEASE.version}
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </a>
          }
        />

        <div
          className="-mx-4 mt-12 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
          role="tablist"
          aria-label={`New in ${RELEASE.version}`}
        >
          {SHOWCASES.map((s, idx) => {
            const Icon = s.icon;
            const selected = idx === active;
            return (
              <button
                key={s.shot}
                id={`whats-new-tab-${idx}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="whats-new-panel"
                onClick={() => setActive(idx)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-xs border px-3 py-2 text-[13px] transition-colors",
                  selected
                    ? "border-accent/60 bg-accent/10 text-paper"
                    : "border-ink-500 bg-ink-100 text-paper-muted hover:border-ink-700 hover:text-paper"
                )}
              >
                <Icon className={cn("h-3.5 w-3.5", selected ? "text-accent" : "text-paper-faint")} aria-hidden />
                {s.label}
              </button>
            );
          })}
        </div>

        <div
          id="whats-new-panel"
          role="tabpanel"
          aria-labelledby={`whats-new-tab-${active}`}
          className="mt-6 grid grid-cols-12 gap-x-6 gap-y-8"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={item.shot}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="col-span-12 grid grid-cols-12 gap-x-6 gap-y-8"
            >
              <div className="col-span-12 flex flex-col gap-5 lg:col-span-4">
                <h3 className="text-2xl font-semibold leading-tight text-paper text-balance">{item.title}</h3>
                <p className="text-[15px] leading-relaxed text-paper-muted">{item.pitch}</p>
                <div>
                  <p className="label-mono mb-3">Try it</p>
                  <ol className="flex flex-col gap-2.5">
                    {item.steps.map((step, idx) => (
                      <li key={step} className="flex gap-3 text-[14px] leading-snug text-paper-dim">
                        <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-xs border border-ink-500 font-mono text-[10px] text-paper-faint">
                          {idx + 1}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
                <a
                  href={withBase(item.docs.href)}
                  className="group inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-accent transition-colors hover:text-accent-soft"
                >
                  {item.docs.label}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </a>
              </div>
              <figure className="col-span-12 lg:col-span-8">
                <div className="overflow-hidden rounded-xs border border-ink-500 bg-ink-100">
                  <img
                    src={withBase(`/docs/img/app/${item.shot}.jpg`)}
                    alt={item.alt}
                    width={1440}
                    height={900}
                    loading="lazy"
                    decoding="async"
                    className="block h-auto w-full"
                  />
                </div>
              </figure>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* The header's link is hidden below md. */}
        <a
          href={withBase(WHATS_NEW_PATH)}
          className="mt-8 inline-flex items-center gap-1.5 text-[13px] font-medium text-paper md:hidden"
        >
          Everything in {RELEASE.version}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </a>
      </Container>
    </Section>
  );
}
