import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, type LucideIcon, Smile, Undo2, ShieldCheck, MessageSquare, LayoutGrid, History } from "lucide-react";
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
    icon: Smile,
    label: "Meet Chobi",
    title: "One place for AI, on the edge of every screen",
    pitch: "Chobi shows what needs a look across every connection you can reach, chats with CHouse Assistant, and lists what AI changed for you — and stays usable above any dialog.",
    steps: [
      "Click Chobi on the right edge, or press Ctrl/⌘ J from anywhere",
      "Now lists open incidents, failed jobs, unreachable clusters and what waits for you",
      "Select text or drop a table on Chobi to ask about it",
    ],
    shot: "chobi-now",
    alt: "Chobi's panel open on the Now tab, listing what needs a look per connection",
    docs: { label: "Chobi", href: "/docs/chobi/" },
  },
  {
    icon: Undo2,
    label: "Changes with Undo",
    title: "Ask for a change. Take it back if you need to.",
    pitch: "CHouse Assistant makes the changes you ask for, as you, through the same checks as the UI. Changes that are easy to reverse run at once and show Undo for 24 hours.",
    steps: [
      "Ask: “keep an eye on shop.orders until tomorrow”",
      "The watch runs at once — the receipt says Done · Undo",
      "Undo from the chat, Chobi's Activity tab or the CLI",
    ],
    shot: "chobi-undo",
    alt: "A chat reply with a Done · Undo receipt for a table watch",
    docs: { label: "Let Chobi make a change", href: "/docs/guide-first-ai-change/" },
  },
  {
    icon: ShieldCheck,
    label: "Checked by tier",
    title: "The bigger the change, the more it asks",
    pitch: "Changes undo can't reverse ask once. Privileged or destructive ones — DROP, roles, policies — need a second person. A production connection makes every change one tier stricter.",
    steps: [
      "Ask for a new table — the reply pauses on an approval card",
      "Approve, edit the arguments, or reject",
      "Second-approver requests wait in AI Governance › Approvals",
    ],
    shot: "chobi-approval",
    alt: "An approval card in the chat for creating a table, with Approve, Edit and Reject",
    docs: { label: "Approvals & tiers", href: "/docs/ai-approvals/" },
  },
  {
    icon: MessageSquare,
    label: "Approve from chat",
    title: "Slack, Google Chat and Telegram buttons that run as you",
    pitch: "Chat app channels edit what they posted — an alert shows resolved, a request shows who decided it — and carry Acknowledge, Snooze, Approve and Reject buttons, checked like a click in CHouse.",
    steps: [
      "Admin › Alerting › Channels › Add channel, in App mode",
      "Say who may act from the channel",
      "Turn on Need You alerts for approvals that wait on a person",
    ],
    shot: "admin-alerting-add-channel",
    alt: "The Add channel dialog in Admin › Alerting, connecting a Slack app",
    docs: { label: "Approve from Slack", href: "/docs/guide-approve-from-chat/" },
  },
  {
    icon: LayoutGrid,
    label: "Dashboard canvas",
    title: "Place panels anywhere. Or let Tidy up do it.",
    pitch: "Drag and resize panels on a 24-column grid, add Markdown text and section headings, and lay a dashboard out in one click. Existing dashboards were converted on upgrade.",
    steps: [
      "Open a dashboard and choose Edit",
      "Drag by the grip, resize from any edge, add text or headings",
      "Tidy up: values first, then trends, breakdowns and tables",
    ],
    shot: "dashboards-canvas",
    alt: "A dashboard in edit mode on the canvas, with Tidy up in the toolbar",
    docs: { label: "Build a dashboard", href: "/docs/guide-build-a-dashboard/" },
  },
  {
    icon: History,
    label: "What changed & why",
    title: "Charts that mark what changed — and explain a spike",
    pitch: "Line and area charts mark DDL, upgrades, settings changes, new writers, alerts, incidents, fixes and notes. Select a range to zoom, add a note, or ask Chouse AI to explain it.",
    steps: [
      "Hover a marker on the time axis for what happened",
      "Drag across a chart to select a range",
      "Explain this spike — the likely cause, with its evidence",
    ],
    shot: "dashboards-annotations",
    alt: "A dashboard chart with annotation markers and a note along the time axis",
    docs: { label: "Annotations and notes", href: "/docs/dashboards/#annotations-and-notes" },
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
          title="Chobi, AI that acts with Undo, and dashboards that explain themselves."
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
