import { useEffect, useState } from "react";
import { ArrowUpRight, Github, Terminal } from "lucide-react";
import { motion } from "framer-motion";
import { Container, PrimaryAction, SecondaryAction } from "./Section";

/**
 * Editorial hero — Linear/Vercel-influenced.
 * Asymmetric 12-col grid, mono eyebrow, big restrained type, single accent.
 * No animated orbs, no rotating logo, no gradient text.
 */

const BOOT_LOG = [
  { kind: "prompt", text: "docker compose up -d" },
  { kind: "ok", text: "✓ chouse-clickhouse  Started   0.4s" },
  { kind: "ok", text: "✓ chouse-ui          Started   0.6s" },
  { kind: "muted", text: "" },
  { kind: "muted", text: "[RBAC] Initializing RBAC system…" },
  { kind: "muted", text: "[RBAC] Database type: sqlite" },
  { kind: "muted", text: "[RBAC] App version: 2.12.9" },
  { kind: "muted", text: "[RBAC] Running migration: 1.17.1" },
  { kind: "accent", text: "[RBAC] system ready" },
  { kind: "muted", text: "" },
  { kind: "link", text: "→ http://localhost:5521" },
] as const;

const META_STRIP = [
  { label: "License", value: "Apache 2.0" },
  { label: "Runtime", value: "Bun · Hono" },
  { label: "Frontend", value: "React 19 · Vite 7" },
  { label: "Database", value: "ClickHouse 25" },
];

export default function Hero() {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  useEffect(() => {
    const baseUrl = import.meta.env.BASE_URL || "/";
    const changelogPath = `${baseUrl}CHANGELOG.md`.replace(/\/+/g, "/");
    fetch(changelogPath)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error("no changelog"))))
      .then((text) => {
        const match = text.match(/^## \[(v[\d.]+)\] - \d{4}-\d{2}-\d{2}/m);
        if (match) setLatestVersion(match[1]);
      })
      .catch(() => {
        /* silent */
      });
  }, []);

  return (
    <section
      className="relative overflow-hidden border-b border-ink-500 pb-24 pt-32 md:pt-40"
      aria-label="Introduction"
    >
      {/* Static dot grid — replaces moving blur orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-dot-grid opacity-60 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,black,transparent)]"
      />

      <Container className="relative">
        {/* Top meta row */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="mb-12 flex items-center justify-between"
        >
          <span className="label-mono inline-flex items-center gap-3">
            <span className="text-paper-faint">01</span>
            <span className="h-px w-6 bg-ink-700" aria-hidden />
            <span>Introducing CHouse UI</span>
          </span>

          {latestVersion && (
            <a
              href="#changelog"
              className="group hidden items-center gap-2 rounded-xs border border-ink-500 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted transition-colors hover:border-ink-700 hover:text-paper md:inline-flex"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
              {latestVersion}
              <span className="text-paper-faint group-hover:text-paper-muted">changelog</span>
            </a>
          )}
        </motion.div>

        {/* Asymmetric grid: headline (7) + terminal (5) */}
        <div className="grid grid-cols-12 gap-x-6 gap-y-16">
          {/* Headline column */}
          <div className="col-span-12 lg:col-span-7">
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="text-display-2xl font-semibold text-paper"
            >
              The ClickHouse UI
              <br />
              <span className="text-paper-dim">that grew up.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
              className="mt-8 max-w-xl text-lg leading-relaxed text-paper-muted"
            >
              Open-source web interface for ClickHouse with{" "}
              <span className="text-paper">first-class RBAC</span>, encrypted credentials,
              audit logging, and a SQL workspace that does not pretend the database is
              a toy.
            </motion.p>

            {/* Actions */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="mt-10 flex flex-wrap items-center gap-3"
            >
              <PrimaryAction href="#quick-start">
                Deploy in 5 minutes
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </PrimaryAction>
              <SecondaryAction
                href="https://github.com/daun-gatal/chouse-ui"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Github className="h-4 w-4" />
                View source
              </SecondaryAction>
            </motion.div>

            {/* Meta strip — replaces emoji pill row */}
            <motion.dl
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="mt-14 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-ink-500 pt-6 sm:grid-cols-4"
            >
              {META_STRIP.map((item) => (
                <div key={item.label} className="flex flex-col gap-1">
                  <dt className="label-mono">{item.label}</dt>
                  <dd className="font-mono text-[13px] text-paper">{item.value}</dd>
                </div>
              ))}
            </motion.dl>
          </div>

          {/* Terminal column */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="col-span-12 lg:col-span-5"
          >
            <TerminalCard />
          </motion.div>
        </div>
      </Container>
    </section>
  );
}

function TerminalCard() {
  return (
    <div className="overflow-hidden rounded-md border border-ink-500 bg-ink-100">
      {/* Title bar */}
      <div className="flex items-center justify-between border-b border-ink-500 bg-ink-200 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-paper-dim" aria-hidden />
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted">
            ~/chouse-ui — bash
          </span>
        </div>
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-ink-500" />
          <span className="h-2 w-2 rounded-full bg-ink-500" />
          <span className="h-2 w-2 rounded-full bg-ink-700" />
        </div>
      </div>

      {/* Output */}
      <pre className="m-0 overflow-x-auto px-5 py-5 font-mono text-[12.5px] leading-relaxed">
        <code>
          {BOOT_LOG.map((line, idx) => {
            const baseDelay = 80;
            const style = { animationDelay: `${idx * baseDelay}ms` } as React.CSSProperties;

            if (line.kind === "prompt") {
              return (
                <div
                  key={idx}
                  className="animate-fade-up opacity-0"
                  style={style}
                >
                  <span className="text-accent">$ </span>
                  <span className="text-paper">{line.text}</span>
                </div>
              );
            }
            if (line.kind === "ok") {
              return (
                <div
                  key={idx}
                  className="animate-fade-up text-paper-muted opacity-0"
                  style={style}
                >
                  <span className="text-accent">✓</span>
                  {line.text.slice(1)}
                </div>
              );
            }
            if (line.kind === "accent") {
              return (
                <div
                  key={idx}
                  className="animate-fade-up text-accent opacity-0"
                  style={style}
                >
                  {line.text}
                </div>
              );
            }
            if (line.kind === "link") {
              return (
                <div key={idx} className="animate-fade-up opacity-0" style={style}>
                  <span className="text-paper-dim">→ </span>
                  <a
                    href="https://chouse-ui.com"
                    className="text-paper underline decoration-ink-700 underline-offset-4 hover:decoration-accent"
                  >
                    http://localhost:5521
                  </a>
                  <span className="ml-1 inline-block h-3 w-1.5 translate-y-0.5 animate-caret bg-accent align-middle" />
                </div>
              );
            }
            return (
              <div
                key={idx}
                className="animate-fade-up text-paper-dim opacity-0"
                style={style}
              >
                {line.text || " "}
              </div>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
