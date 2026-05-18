import { useState } from "react";
import { ArrowUpRight, Copy, Check, FlaskConical } from "lucide-react";
import { Section, Container, PrimaryAction } from "./Section";

interface CredentialFieldProps {
  label: string;
  value: string;
}

function CredentialField({ label, value }: CredentialFieldProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="flex items-center justify-between gap-3 border-t border-ink-500 px-4 py-3 first:border-t-0">
      <div className="flex items-center gap-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint w-12">
          {label}
        </span>
        <code className="font-mono text-[13px] text-paper">{value}</code>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy ${label}`}
        className="grid h-7 w-7 place-items-center rounded-xs border border-ink-500 text-paper-dim transition-colors hover:border-ink-700 hover:text-paper"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-accent" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}

export default function TryLab() {
  return (
    <Section id="try-lab" aria-label="Live playground">
      <Container>
        <div className="grid grid-cols-12 gap-x-6 gap-y-10">
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
                Spin up an account-less guest session against a real ClickHouse instance.
                Read-only — kick the tires on the SQL workspace, explorer, monitoring, and
                AI optimizer before you decide.
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-3">
                <PrimaryAction
                  href="https://lab.chouse-ui.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Launch lab
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </PrimaryAction>
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
                  Read-only · No sign-up
                </span>
              </div>
            </div>
          </div>

          {/* Right: credentials card */}
          <div className="col-span-12 lg:col-span-5">
            <div className="overflow-hidden rounded-md border border-ink-500 bg-ink-100">
              <div className="border-b border-ink-500 bg-ink-200 px-4 py-2">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted">
                  Guest credentials
                </span>
              </div>
              <CredentialField label="User" value="guest" />
              <CredentialField label="Pass" value="Guest#User#21" />
              <div className="border-t border-ink-500 px-4 py-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
                  Sandbox resets daily
                </p>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}
