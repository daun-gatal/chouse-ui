import { motion } from "framer-motion";
import { Workflow, ArrowRight, Check } from "lucide-react";
import { Section, Container } from "./Section";

/**
 * Positioning callout — the detect → trace → explain → fix loop. Deliberately NOT in
 * the numbered section sequence (like WhatsNew): it reads as a narrative beat
 * between the features and the live playground, not a feature index.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

const OLD_WAY = [
  "Hear about stale data from the dashboard's users",
  "Grep query_log, kafka_consumers and part_log by hand",
  "Guess which upstream broke and who else is affected",
  "Run the fix as whoever has the admin password",
];

const IN_FLOW = [
  "Detect — every table and pipeline against its own baseline",
  "Trace — a root-cause chain down to the engine, with the blast radius",
  "Explain — Chouse AI separates facts from interpretation",
  "Fix — a catalog action, approved, run, verified, reversible",
];

export default function ClosedLoop() {
  return (
    <Section id="closed-loop" aria-label="From symptom to fix">
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
                  From symptom to fix
                </span>
              </span>
              <h2 className="text-display-lg font-semibold text-paper text-balance">
                Find out first. Fix it safely.
              </h2>
              <p className="max-w-xl text-lg leading-relaxed text-paper-muted">
                CHouse UI learns what normal looks like for every table from ClickHouse's own
                metadata, so a stuck consumer or a late load becomes an{" "}
                <span className="text-paper">incident with its root cause</span> — not a
                complaint. The fix comes from a closed catalog and runs with its own
                credential{" "}
                <span className="text-paper">only after a second person approves it</span>, then
                is verified and can be rolled back.
              </p>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
                Detect → Trace → Explain → Fix → Verify · nothing runs unapproved
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
                  With CHouse UI
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
