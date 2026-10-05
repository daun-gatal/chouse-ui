import { ArrowUpRight } from "lucide-react";
import { RELEASE, WHATS_NEW_PATH } from "../content/release";
import { withBase } from "../docs-site/lib";

/**
 * "New in X.Y" announcement for the current minor/major release, on the
 * landing hero and the docs home. Content lives in src/content/release.ts.
 */
export default function ReleaseBanner({ className = "" }: { className?: string }) {
  const label = RELEASE.kind === "major" ? "Major release" : "New";
  return (
    <div
      className={`rounded-md border border-ink-500 bg-ink-100/80 p-4 backdrop-blur-sm sm:p-5 ${className}`}
      aria-label={`What's new in ${RELEASE.version}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
          <span className="inline-flex w-fit shrink-0 items-center gap-2 whitespace-nowrap rounded-xs border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            {label} · {RELEASE.version}
          </span>
          <span className="text-[14px] leading-snug text-paper-muted">{RELEASE.summary}</span>
        </div>
        <a
          href={withBase(WHATS_NEW_PATH)}
          className="group inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-paper transition-colors hover:text-accent"
        >
          What&apos;s new in {RELEASE.version}
          <ArrowUpRight
            className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden
          />
        </a>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {RELEASE.highlights.map((highlight) => (
          <li key={highlight.href}>
            <a
              href={withBase(highlight.href)}
              className="inline-block rounded-xs border border-ink-500 px-2.5 py-1 text-[12.5px] text-paper-muted transition-colors hover:border-accent/60 hover:text-paper"
            >
              {highlight.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
