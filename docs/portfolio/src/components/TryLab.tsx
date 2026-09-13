import { ArrowUpRight, FlaskConical, KeyRound, ShieldCheck } from "lucide-react";
import { Section, Container } from "./Section";

const LAB_URL = "https://lab.chouse-ui.com";

export default function TryLab() {
  return (
    <Section id="try-lab" aria-label="Live playground">
      <Container>
        <div className="grid grid-cols-12 gap-x-6 gap-y-10 lg:items-center">
          {/* Left: pitch */}
          <div className="col-span-12 lg:col-span-7">
            <div className="flex flex-col gap-6">
              <span className="label-mono inline-flex items-center gap-3">
                <span className="text-paper-faint">04</span>
                <span className="h-px w-6 bg-ink-700" aria-hidden />
                <span className="inline-flex items-center gap-2">
                  <FlaskConical className="h-3 w-3" aria-hidden />
                  Live playground
                </span>
              </span>
              <h2 className="text-display-lg font-semibold text-paper text-balance">
                Try it on a hosted instance.{" "}
                <span className="text-paper-dim">No install, no Docker, no signup.</span>
              </h2>
              <p className="max-w-xl text-lg leading-relaxed text-paper-muted">
                One click through SSO drops you into a read-only guest session on a real
                ClickHouse instance — kick the tires on the SQL workspace, explorer,
                monitoring, and AI optimizer before you decide.
              </p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
                <span>Read-only</span>
                <span>·</span>
                <span>Instant access</span>
              </div>
            </div>
          </div>

          {/* Right: single SSO sign-in CTA */}
          <div className="col-span-12 lg:col-span-5">
            <div className="overflow-hidden rounded-md border border-ink-500 bg-ink-100">
              <div className="border-b border-ink-500 bg-ink-200 px-4 py-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted">
                  Sign in to the lab
                </span>
              </div>
              <div className="flex flex-col gap-4 px-5 py-6">
                <a
                  href={LAB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Continue with single sign-on"
                  className="group flex h-12 w-full items-center justify-center gap-3 rounded-xs bg-accent px-4 text-[14px] font-semibold tracking-tight text-ink-50 transition-[transform,background-color] duration-200 hover:-translate-y-px hover:bg-accent-soft"
                >
                  <KeyRound className="h-[18px] w-[18px]" aria-hidden />
                  Continue with SSO
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </a>
                <p className="flex items-center gap-2 text-[12px] leading-relaxed text-paper-muted">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                  Account-less guest session — provisioned on first sign-in.
                </p>
                <a
                  href="#automate"
                  className="group inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint transition-colors hover:text-accent"
                >
                  Prefer letting an agent drive it? The MCP lab takes the same session
                  <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
