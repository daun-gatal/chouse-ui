import type { ComponentType, ReactNode } from "react";
import { DocsLayout } from "./DocsLayout";
import { Markdown } from "./Markdown";
import { sectionPath } from "../manifest";
import type { ContentBlock, PageFacts } from "../content";
import { withBase } from "../lib";
import type { DocHeading } from "../lib";
import type { DocEntry } from "../manifest";

const EDIT_BASE = "https://github.com/daun-gatal/chouse-ui/edit/preview/docs/portfolio/src/content/docs";

/** Permission → its display name and the anchor of its category on the permission catalog. */
export type PermissionIndex = Record<string, { name: string; anchor: string }>;

/** "In the app · Needs · ClickHouse · Source" strip under the lead. */
function FactsBar({ facts, permissions }: { facts: PageFacts; permissions: PermissionIndex }) {
  const items: Array<{ label: string; value: ReactNode }> = [];
  if (facts.app) {
    items.push({
      label: "In the app",
      value: (
        <span className="text-paper">
          {facts.app}
          {facts.route && <code className="ml-2 font-mono text-[11.5px] text-paper-dim">{facts.route}</code>}
        </span>
      ),
    });
  }
  if (facts.permissions?.length) {
    items.push({
      label: facts.permissions.length > 1 ? "Needs any of" : "Needs",
      value: (
        <span className="flex flex-wrap gap-1.5">
          {facts.permissions.map((permission) => (
            <a
              key={permission}
              href={withBase(`/docs/permissions/#${permissions[permission]?.anchor ?? ""}`)}
              title={permissions[permission]?.name}
              className="rounded-xs border border-ink-600 bg-ink-200 px-1.5 py-0.5 font-mono text-[11.5px] text-paper transition-colors hover:border-accent/60"
            >
              {permission}
            </a>
          ))}
        </span>
      ),
    });
  }
  if (facts.clickhouse) {
    items.push({ label: "ClickHouse", value: <span className="font-mono text-[12.5px] text-paper">≥ {facts.clickhouse}</span> });
  }
  if (facts.generated) {
    items.push({
      label: "Source",
      value: <span className="text-paper-muted">Generated from {facts.generated}, so it always matches the code.</span>,
    });
  }
  if (items.length === 0) return null;
  return (
    <dl className="mt-2 grid gap-x-8 gap-y-3 rounded-md border border-ink-500 bg-ink-100 px-4 py-3.5 sm:grid-cols-[auto_1fr]">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-paper-faint sm:pt-1">{item.label}</dt>
          <dd className="text-[13.5px]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Tabbed alternatives. Every panel is in the HTML (search engines and no-JS
 * readers get the first); docs-client.js switches panels and remembers the
 * reader's choice per label set, so picking "Helm" once sticks across pages.
 */
function Tabs({ tabs, id }: { tabs: Array<{ label: string; markdown: string }>; id: string }) {
  return (
    <div data-tabs data-tabs-key={tabs.map((t) => t.label).join("|")} className="mt-6">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-ink-500">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-controls={`${id}-panel-${i}`}
            aria-selected={i === 0}
            data-tab={tab.label}
            className="-mb-px border-b-2 border-transparent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim transition-colors hover:text-paper aria-selected:border-accent aria-selected:text-paper"
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.label}
          role="tabpanel"
          id={`${id}-panel-${i}`}
          aria-labelledby={`${id}-tab-${i}`}
          data-tab-panel={tab.label}
          hidden={i !== 0}
          className="[&>*:first-child]:mt-3"
        >
          <Markdown>{tab.markdown}</Markdown>
        </div>
      ))}
    </div>
  );
}

/** A regular doc page: eyebrow, H1, lead, facts, body, edit link. */
export function DocsPage({
  entry,
  facts,
  blocks,
  headings,
  diagrams,
  permissions,
}: {
  entry: DocEntry;
  facts: PageFacts;
  blocks: ContentBlock[];
  headings: DocHeading[];
  diagrams: Record<string, ComponentType>;
  permissions: PermissionIndex;
}) {
  const { section, group, page } = entry;
  const crumbs = [
    { label: section.label, href: sectionPath(section.id) },
    ...(group.label ? [{ label: group.label, href: `${sectionPath(section.id)}#${group.id}` }] : []),
    { label: page.title },
  ];
  return (
    <DocsLayout activeSlug={page.slug} crumbs={crumbs} headings={headings}>
      <article>
        <div className="flex flex-col gap-4">
          <span className="label-mono inline-flex items-center gap-3">
            <span>{section.label}</span>
            {group.label && (
              <>
                <span className="h-px w-6 bg-ink-700" aria-hidden />
                <span className="text-paper-faint">{group.label}</span>
              </>
            )}
          </span>
          <h1 className="text-display-lg font-semibold tracking-tight text-paper text-balance">{page.title}</h1>
          <p className="max-w-2xl text-lg leading-relaxed text-paper-muted">{page.description}</p>
          <FactsBar facts={facts} permissions={permissions} />
          {facts.screenshot && (
            <figure className="mt-2">
              <img
                src={withBase(`/docs/img/app/${facts.screenshot}.jpg`)}
                alt={`${facts.app ?? page.title} in CHouse UI`}
                width={1440}
                height={900}
                loading="lazy"
                decoding="async"
                className="block h-auto w-full rounded-md border border-ink-500 bg-ink-100"
              />
              <figcaption className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
                {facts.app ?? page.title}
              </figcaption>
            </figure>
          )}
        </div>
        <div className="mt-2">
          {blocks.map((block, i) => {
            if (block.kind === "markdown") return <Markdown key={i}>{block.text}</Markdown>;
            if (block.kind === "tabs") return <Tabs key={i} id={`tabs-${i}`} tabs={block.tabs} />;
            const Diagram = diagrams[block.name];
            return <Diagram key={i} />;
          })}
        </div>
        {!facts.generated && (
          <p className="mt-14">
            <a
              href={`${EDIT_BASE}/${page.slug}.md`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim transition-colors hover:text-paper"
            >
              Edit this page on GitHub ↗
            </a>
          </p>
        )}
      </article>
    </DocsLayout>
  );
}
