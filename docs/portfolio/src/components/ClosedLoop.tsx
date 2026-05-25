import { motion } from "framer-motion";
import { Workflow, ArrowRight, Check } from "lucide-react";
import { Section, Container } from "./Section";

/**
 * Positioning callout — the "no context-switching" pitch. Deliberately NOT in
 * the numbered section sequence (like WhatsNew): it reads as a narrative beat
 * between the screenshots and the live playground, not a feature index.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

const OLD_WAY = [
  "Copy the error out of the console",
  "Paste it into a chatbot, re-add the context",
  "Hunt for a rewrite, hope it's equivalent",
  "Switch back, paste, re-run — repeat",
];

const IN_FLOW = [
  "See an error → cause, impact, and ordered fixes inline",
  "Spot a slow query → an optimized rewrite, same result",
  "before→after EXPLAIN proves it reads fewer rows",
  "One click → Open in Explorer and run it",
];

export default function ClosedLoop() {
  return (
    <Section id="closed-loop" aria-label="Stay in flow">
      <Container>
        <div className="grid grid-cols-12 gap-x-6 gap-y-10">
          {/* Left: the pitch */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.55, ease: EASE }}
            className="col-span-12 lg:col-span-6"
          >
            <div className="flex flex-col gap-6">
              <span className="label-mono inline-flex items-center gap-3">
                <span className="h-px w-6 bg-ink-700" aria-hidden />
                <span className="inline-flex items-center gap-2">
                  <Workflow className="h-3 w-3" aria-hidden />
                  The closed loop
                </span>
              </span>
              <h2 className="text-display-lg font-semibold text-paper text-balance">
                The fix lives where the problem is.
              </h2>
              <p className="max-w-xl text-lg leading-relaxed text-paper-muted">
                No pasting stack traces into a chatbot, no hunting for the right rewrite.
                Spot a slow query and optimize it in place — with a{" "}
                <span className="text-paper">before→after EXPLAIN</span> as proof. Hit a
                server error and get the cause and ordered fixes inline. The{" "}
                <span className="text-paper">diagnosis and the fix sit right next to the
                problem</span>, so you never leave the tab.
              </p>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
                Detect → Diagnose → Fix → Act · read-only, advisory
              </p>
            </div>
          </motion.div>

          {/* Right: without / with contrast */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
            className="col-span-12 lg:col-span-6"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-4 rounded-md border border-ink-500 bg-ink-100 p-5">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                  Without it
                </span>
                <ul className="flex flex-col gap-3">
                  {OLD_WAY.map((t) => (
                    <li
                      key={t}
                      className="flex items-start gap-2.5 text-sm leading-relaxed text-paper-dim"
                    >
                      <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-paper-faint" aria-hidden />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-4 rounded-md border border-accent/30 bg-accent/5 p-5">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
                  With Chouse AI
                </span>
                <ul className="flex flex-col gap-3">
                  {IN_FLOW.map((t) => (
                    <li
                      key={t}
                      className="flex items-start gap-2.5 text-sm leading-relaxed text-paper-muted"
                    >
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </motion.div>
        </div>
      </Container>
    </Section>
  );
}
