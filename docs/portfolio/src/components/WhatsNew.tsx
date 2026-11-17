import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, type LucideIcon, Activity, KeyRound, Link2, ShieldCheck, UserCheck, UserRound } from "lucide-react";
import { Section, Container, SectionHeader } from "./Section";
import { RELEASE, WHATS_NEW_PATH } from "../content/release";
import { withBase } from "../docs-site/lib";
import { cn } from "@/lib/utils";

/**
 * The current release, shown on real screens: one tab per headline feature,
 * each with a capture of the running app and the three steps to
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
    icon: UserCheck,
    label: "Personal connections",
    title: "Run each person's statements as their own ClickHouse user",
    pitch: "A connection can now be personal. Its own ClickHouse user holds no grant; each person's statements run as the ClickHouse user linked to their account, so the grants, row policies and quotas you already have decide what they reach. CHouse UI stores no password for those users.",
    steps: [
      "Admin › Connections › Add connection, ClickHouse login tab, choose Personal",
      "Hand Show the script for the admin to your ClickHouse administrator",
      "Press Test, then Create: one empty ClickHouse user is enough",
    ],
    shot: "admin-connection-personal",
    alt: "The ClickHouse login tab of a personal connection: its kind, server, user, default database, system role and impersonation role, with Test and Save",
    docs: { label: "Personal connections", href: "/docs/personal-connections/" },
  },
  {
    icon: Link2,
    label: "Person links",
    title: "Decide which account runs as which ClickHouse user",
    pitch: "A super admin links each account to one ClickHouse user and sees every link's state. A link waits until ClickHouse allows it, is suspended when someone else changes how the account signs in, and is disabled when the user behind the name changes.",
    steps: [
      "Edit the connection, open its Who can query tab",
      "Pick an account, type its ClickHouse user, Add link",
      "Hand the GRANT shown to your ClickHouse administrator",
    ],
    shot: "admin-connection-links",
    alt: "The Who can query tab of a personal connection: accounts with their ClickHouse users and the state of each link",
    docs: { label: "Link an account to a ClickHouse user", href: "/docs/guide-link-clickhouse-user/" },
  },
  {
    icon: KeyRound,
    label: "Grants to hand over",
    title: "The exact statements for your ClickHouse administrator",
    pitch: "CHouse UI cannot grant itself anything. For every waiting link it shows the GRANT to run, and for every ClickHouse user the connection may still act as without a link, the REVOKE that takes it away.",
    steps: [
      "Add the links you need",
      "Copy the statements under For the ClickHouse administrator",
      "After they ran, press Check again on each waiting link",
    ],
    shot: "admin-connection-links-grants",
    alt: "Lower on the Who can query tab: the GRANT for a waiting link, and the REVOKE for a user that no link uses",
    docs: { label: "Links and their states", href: "/docs/personal-connections/#links" },
  },
  {
    icon: UserRound,
    label: "Your ClickHouse user",
    title: "Everyone sees who their statements run as",
    pitch: "Preferences and the connection switcher show which ClickHouse user you are on a personal connection, and whether the link is active. When ClickHouse refuses a statement, the message names the grant your user is missing.",
    steps: [
      "Open Preferences",
      "Find ClickHouse user: the connection, the user, the state",
      "Press Check again after your administrator ran the grant",
    ],
    shot: "preferences-clickhouse-user",
    alt: "The ClickHouse user card in Preferences: on Production, statements run as alice, and the link is active",
    docs: { label: "What changes on a personal connection", href: "/docs/personal-connections/#what-changes-on-a-personal-connection" },
  },
  {
    icon: ShieldCheck,
    label: "Role ceiling",
    title: "Or limit each CHouse role to one ClickHouse role",
    pitch: "For teams without a ClickHouse user per person: map each CHouse role to a ClickHouse role. Every statement is sent with the role of the person it is for, so ClickHouse itself refuses anything outside it, for administrators too. Needs ClickHouse 24.4 or newer.",
    steps: [
      "Admin › Connections › Add connection, ClickHouse login tab, choose Role ceiling",
      "Press Test, then Create with one empty ClickHouse user",
      "Map each CHouse role on the Who can query tab",
    ],
    shot: "admin-connection-role-map",
    alt: "The Who can query tab of a role-ceiling connection: each CHouse role, its ClickHouse role and how many people hold it",
    docs: { label: "Connection kinds and the role ceiling", href: "/docs/connection-identity/" },
  },
  {
    icon: Activity,
    label: "Checked every five minutes",
    title: "A login that drifts stops the connection, not your guarantees",
    pitch: "Before a switch and every five minutes after, CHouse UI checks that the connection's ClickHouse user is still empty, that its roles cannot manage or become other users, and, for a personal connection, that the server still checks grants for everything run as a person. A connection that fails refuses every request and says why.",
    steps: [
      "Edit a role-ceiling or personal connection, open ClickHouse login",
      "Read the health line and when it was last checked",
      "Press Re-run checks after a change in ClickHouse",
    ],
    shot: "admin-connection-identity",
    alt: "The ClickHouse login tab of a role-ceiling connection: kind, server, user, system role, access contact and a passing health line with Re-run checks",
    docs: { label: "What CHouse UI checks", href: "/docs/connection-identity/#what-chouse-ui-checks" },
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
          title="ClickHouse decides what each person reaches."
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
