import type { ReactNode } from "react";
import { Github, Menu, Search, X } from "lucide-react";
import { SidebarNav } from "./Sidebar";
import { Toc } from "./Toc";
import { DOCS_HOME_PATH, docNav, docPath } from "../manifest";
import { withBase } from "../lib";
import { cn } from "@/lib/utils";
import type { DocHeading } from "../lib";

interface DocsLayoutProps {
  /** Current page slug; omitted on hubs and the docs home. */
  activeSlug?: string;
  /** Current section id, for hub pages. */
  activeSection?: string;
  crumbs: Crumb[];
  headings: DocHeading[];
  children: ReactNode;
}

function Wordmark() {
  return (
    <a href={withBase("/")} className="flex items-center gap-2.5" aria-label="CHouse UI — home">
      <img
        src={withBase("/logo.svg")}
        alt=""
        aria-hidden
        className="h-5 w-5"
        width="20"
        height="20"
        loading="eager"
      />
      <span className="text-[14px] font-semibold tracking-tight text-paper">
        CHouse<span className="text-paper-dim">UI</span>
      </span>
    </a>
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  const trail: Crumb[] = [{ label: "Docs", href: DOCS_HOME_PATH }, ...crumbs];
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 sm:flex">
      {trail.map((crumb, i) => {
        const last = i === trail.length - 1;
        return (
          <span key={`${crumb.label}-${i}`} className={cn("flex items-center gap-2", last ? "min-w-0" : "shrink-0")}>
            {i > 0 && (
              <span aria-hidden className="text-ink-800">
                ▸
              </span>
            )}
            {crumb.href && !last ? (
              <a
                href={withBase(crumb.href)}
                className="font-mono text-[11px] uppercase tracking-[0.16em] text-paper-dim transition-colors hover:text-paper"
              >
                {crumb.label}
              </a>
            ) : (
              <span
                className={cn(
                  "font-mono text-[11px] uppercase tracking-[0.16em]",
                  last ? "truncate text-paper-muted" : "text-paper-faint"
                )}
              >
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** Opens the search dialog (wired by docs-client.js). */
function SearchButton() {
  return (
    <button
      type="button"
      data-search-open
      className="inline-flex h-8 items-center gap-2 rounded-xs border border-ink-500 px-3 text-[12.5px] text-paper-dim transition-colors hover:border-ink-700 hover:text-paper"
      aria-label="Search the docs"
    >
      <Search className="h-3.5 w-3.5" aria-hidden />
      <span className="hidden md:inline">Search docs</span>
      <kbd className="hidden rounded-xs border border-ink-600 px-1.5 font-mono text-[10px] text-paper-faint md:inline">
        ⌘K
      </kbd>
    </button>
  );
}

/**
 * Search dialog shell. Rendered statically; docs-client.js loads the index
 * from data-search-index on first open and fills the result list.
 */
function SearchDialog() {
  return (
    <div
      id="docs-search"
      data-search-index={withBase("/docs/search-index.json")}
      data-docs-base={withBase("/docs/")}
      className="fixed inset-0 z-[60] hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Search the docs"
    >
      <button
        type="button"
        data-search-close
        className="absolute inset-0 h-full w-full cursor-default bg-ink-0/70 backdrop-blur-sm"
        aria-label="Close search"
      />
      <div className="relative mx-auto mt-[10vh] w-[calc(100%-2rem)] max-w-2xl overflow-hidden rounded-md border border-ink-600 bg-ink-100 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-ink-500 px-4">
          <Search className="h-4 w-4 shrink-0 text-paper-dim" aria-hidden />
          <input
            type="search"
            data-search-input
            placeholder="Search pages, settings, permissions, errors…"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search query"
            aria-controls="docs-search-results"
            className="h-12 w-full bg-transparent text-[15px] text-paper placeholder:text-paper-faint focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded-xs border border-ink-600 px-1.5 font-mono text-[10px] text-paper-faint sm:inline">
            Esc
          </kbd>
        </div>
        <ul id="docs-search-results" data-search-results role="listbox" className="max-h-[60vh] overflow-y-auto p-2" />
        <p data-search-status className="border-t border-ink-500 px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-paper-faint">
          Type to search · ↑↓ to move · Enter to open
        </p>
      </div>
    </div>
  );
}

function GithubLink() {
  return (
    <a
      href="https://github.com/daun-gatal/chouse-ui"
      target="_blank"
      rel="noopener noreferrer"
      className="hidden h-8 items-center gap-2 rounded-xs border border-ink-500 px-3 text-[12.5px] font-medium text-paper-muted transition-colors hover:border-ink-700 hover:text-paper sm:inline-flex"
      aria-label="GitHub repository"
    >
      <Github className="h-3.5 w-3.5" aria-hidden />
      <span>GitHub</span>
    </a>
  );
}

function PrevNext({ activeSlug }: { activeSlug: string }) {
  const { prev, next } = docNav(activeSlug);
  if (!prev && !next) return null;
  return (
    <div className="mt-16 flex items-stretch justify-between gap-4 border-t border-ink-500 pt-8">
      <div>
        {prev && (
          <a href={withBase(docPath(prev.slug))} className="group block">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint transition-colors group-hover:text-paper-dim">
              ← Previous
            </span>
            <span className="mt-1 block text-sm font-medium text-paper-muted transition-colors group-hover:text-paper">
              {prev.title}
            </span>
          </a>
        )}
      </div>
      <div className="text-right">
        {next && (
          <a href={withBase(docPath(next.slug))} className="group block">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint transition-colors group-hover:text-paper-dim">
              Next →
            </span>
            <span className="mt-1 block text-sm font-medium text-paper-muted transition-colors group-hover:text-paper">
              {next.title}
            </span>
          </a>
        )}
      </div>
    </div>
  );
}

export function DocsLayout({ activeSlug, activeSection, crumbs, headings, children }: DocsLayoutProps) {
  return (
    <div className="min-h-screen bg-ink-50 text-paper">
      {/* Docs top bar — minimal: wordmark ▸ breadcrumb ▸ GitHub */}
      <header className="sticky top-0 z-40 border-b border-ink-500 bg-ink-50/85 backdrop-blur-md">
        <div className="container-editorial flex h-12 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              data-drawer-toggle
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xs border border-ink-500 text-paper-muted transition-colors hover:text-paper lg:hidden"
              aria-label="Open docs navigation"
              aria-controls="docs-drawer"
            >
              <Menu className="h-4 w-4" />
            </button>
            <Wordmark />
            <span aria-hidden className="hidden text-ink-800 sm:inline">
              ▸
            </span>
            <Breadcrumb crumbs={crumbs} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SearchButton />
            <GithubLink />
          </div>
        </div>
      </header>

      <div className="container-editorial grid gap-x-10 gap-y-10 py-10 md:py-14 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_220px]">
        {/* Left rail */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8">
            <SidebarNav activeSlug={activeSlug} activeSection={activeSection} />
          </div>
        </aside>

        {/* Content */}
        <main className="min-w-0 pb-16">
          {children}
          {activeSlug && <PrevNext activeSlug={activeSlug} />}
        </main>

        {/* Right rail */}
        <aside className="hidden xl:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8">
            <Toc headings={headings} />
          </div>
        </aside>
      </div>

      {/* Mobile drawer */}
      <div id="docs-drawer" className="fixed inset-0 z-50 hidden lg:hidden" role="dialog" aria-modal="true">
        <button
          type="button"
          data-drawer-close
          className="absolute inset-0 h-full w-full cursor-default bg-ink-0/60"
          aria-label="Close docs navigation"
        />
        <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-ink-500 bg-ink-50 p-6">
          <div className="mb-6 flex items-center justify-between">
            <Wordmark />
            <button
              type="button"
              data-drawer-close
              className="inline-flex h-8 w-8 items-center justify-center rounded-xs border border-ink-500 text-paper-muted transition-colors hover:text-paper"
              aria-label="Close docs navigation"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <SidebarNav activeSlug={activeSlug} activeSection={activeSection} />
        </div>
      </div>

      <SearchDialog />
    </div>
  );
}
