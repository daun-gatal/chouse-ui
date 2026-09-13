import { Fragment, type ReactNode } from "react";
import { DocsLayout } from "./DocsLayout";
import { Markdown } from "./Markdown";
import type { DocHeading } from "../lib";

/** A regular doc page: eyebrow "06 · MONITORING", H1, lead, markdown body. */
export function DocsPage({
  index,
  groupLabel,
  title,
  description,
  headings,
  markdown,
  diagram,
  activeSlug,
}: {
  index: number;
  groupLabel: string;
  title: string;
  description: string;
  headings: DocHeading[];
  /** Markdown segments; `diagram` is inserted between consecutive segments. */
  markdown: string;
  diagram?: ReactNode;
  activeSlug: string;
}) {
  const segments = diagram ? markdown.split(/\{\{diagram:[a-z-]+\}\}/) : [markdown];
  return (
    <DocsLayout activeSlug={activeSlug} headings={headings}>
      <article>
        <div className="flex flex-col gap-4">
          <span className="label-mono inline-flex items-center gap-3">
            <span className="text-paper-faint">{String(index + 1).padStart(2, "0")}</span>
            <span className="h-px w-6 bg-ink-700" aria-hidden />
            <span>{groupLabel}</span>
          </span>
          <h1 className="text-display-lg font-semibold tracking-tight text-paper text-balance">{title}</h1>
          <p className="max-w-2xl text-lg leading-relaxed text-paper-muted">{description}</p>
        </div>
        <div className="mt-2">
          {segments.map((segment, i) => (
            <Fragment key={i}>
              <Markdown>{segment}</Markdown>
              {i < segments.length - 1 && diagram}
            </Fragment>
          ))}
        </div>
      </article>
    </DocsLayout>
  );
}
