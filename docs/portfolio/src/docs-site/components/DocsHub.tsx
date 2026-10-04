import { ArrowRight, Search } from "lucide-react";
import { DocsLayout } from "./DocsLayout";
import { DOC_SECTIONS, docPath, sectionPages, sectionPath } from "../manifest";
import { withBase } from "../lib";
import type { DocPage, DocSection } from "../manifest";

/** Shortcuts on the docs home for the most common first visits. */
const START_LINKS: Array<{ slug: string; label: string }> = [
  { slug: "quick-start", label: "Run it in five minutes" },
  { slug: "deploy-helm", label: "Install on Kubernetes" },
  { slug: "rbac-roles", label: "Set up users and roles" },
  { slug: "data-incidents", label: "Investigate an incident" },
  { slug: "mcp", label: "Connect an AI agent" },
  { slug: "troubleshooting", label: "Fix a problem" },
];

function PageCard({ page }: { page: DocPage }) {
  return (
    <a
      href={withBase(docPath(page.slug))}
      className="group flex h-full flex-col rounded-md border border-ink-500 bg-ink-100 p-4 transition-colors hover:border-ink-700 hover:bg-ink-200"
    >
      <span className="flex items-center justify-between gap-3 text-[14.5px] font-medium text-paper">
        {page.title}
        <ArrowRight
          className="h-3.5 w-3.5 shrink-0 text-paper-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden
        />
      </span>
      <span className="mt-1.5 text-[13px] leading-relaxed text-paper-dim">{page.description}</span>
    </a>
  );
}

function SearchHero() {
  return (
    <button
      type="button"
      data-search-open
      className="mt-8 flex h-12 w-full max-w-xl items-center gap-3 rounded-md border border-ink-600 bg-ink-100 px-4 text-left text-[15px] text-paper-faint transition-colors hover:border-ink-700 hover:text-paper-dim"
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1">Search pages, settings, permissions, errors…</span>
      <kbd className="rounded-xs border border-ink-600 px-1.5 font-mono text-[10px]">⌘K</kbd>
    </button>
  );
}

/** /docs/ — the documentation home. */
export function DocsHome() {
  return (
    <DocsLayout crumbs={[]} headings={[]}>
      <div className="flex flex-col gap-4">
        <span className="label-mono">Documentation</span>
        <h1 className="text-display-lg font-semibold tracking-tight text-paper text-balance">
          Everything you need to run CHouse UI
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-paper-muted">
          Install, configure, secure and operate CHouse UI — every screen, setting, permission, MCP tool and CLI
          command, in one place.
        </p>
      </div>
      <SearchHero />

      <div className="mt-10 flex flex-wrap gap-2">
        {START_LINKS.map((link) => (
          <a
            key={link.slug}
            href={withBase(docPath(link.slug))}
            className="rounded-xs border border-ink-500 px-3 py-1.5 text-[13px] text-paper-muted transition-colors hover:border-accent/60 hover:text-paper"
          >
            {link.label}
          </a>
        ))}
      </div>

      <div className="mt-14 grid gap-4 sm:grid-cols-2">
        {DOC_SECTIONS.map((section) => (
          <SectionCard key={section.id} section={section} />
        ))}
      </div>
    </DocsLayout>
  );
}

function SectionCard({ section }: { section: DocSection }) {
  const pages = sectionPages(section);
  const shown = pages.slice(0, 5);
  return (
    <div className="flex flex-col rounded-md border border-ink-500 bg-ink-100 p-5">
      <a href={withBase(sectionPath(section.id))} className="group flex items-center justify-between gap-3">
        <span className="text-lg font-semibold tracking-tight text-paper">{section.label}</span>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-paper-faint transition-colors group-hover:text-accent">
          {pages.length} pages →
        </span>
      </a>
      <p className="mt-2 text-[13.5px] leading-relaxed text-paper-dim">{section.description}</p>
      <ul className="mt-4 flex flex-col gap-1.5 border-t border-ink-500 pt-4">
        {section.groups.some((group) => group.label)
          ? section.groups.map((group) => (
              <li key={group.id}>
                <a
                  href={withBase(`${sectionPath(section.id)}#${group.id}`)}
                  className="text-[13.5px] text-paper-muted transition-colors hover:text-paper"
                >
                  {group.label}
                </a>
                <span className="ml-2 font-mono text-[11px] text-paper-faint">{group.pages.length}</span>
              </li>
            ))
          : shown.map((page) => (
              <li key={page.slug}>
                <a href={withBase(docPath(page.slug))} className="text-[13.5px] text-paper-muted transition-colors hover:text-paper">
                  {page.title}
                </a>
              </li>
            ))}
      </ul>
    </div>
  );
}

/** /docs/<section>/ — a section hub listing every page, grouped by app menu where the section has groups. */
export function DocsSectionHub({ section }: { section: DocSection }) {
  const headings = section.groups
    .filter((group) => group.label)
    .map((group) => ({ id: group.id, text: group.label ?? "", level: 2 as const }));
  return (
    <DocsLayout activeSection={section.id} crumbs={[{ label: section.label }]} headings={headings}>
      <div className="flex flex-col gap-4">
        <span className="label-mono">Section</span>
        <h1 className="text-display-lg font-semibold tracking-tight text-paper text-balance">{section.label}</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-paper-muted">{section.description}</p>
      </div>
      {section.groups.map((group) => (
        <section key={group.id} className="mt-10">
          {group.label && (
            <h2 id={group.id} className="mb-4 scroll-mt-20 border-t border-ink-500 pt-8 text-display-md font-semibold tracking-tight text-paper">
              {group.label}
            </h2>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {group.pages.map((page) => (
              <PageCard key={page.slug} page={page} />
            ))}
          </div>
        </section>
      ))}
    </DocsLayout>
  );
}
