import type { ReactNode } from "react";
import { Github, Menu, X } from "lucide-react";
import { SidebarNav } from "./Sidebar";
import { Toc } from "./Toc";
import { DOCS_HOME_SLUG, docNav, findDoc } from "../manifest";
import { withBase } from "../lib";
import type { DocHeading } from "../lib";

interface DocsLayoutProps {
  activeSlug: string;
  headings: DocHeading[];
  children: ReactNode;
  showPrevNext?: boolean;
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

function Breadcrumb({ activeSlug }: { activeSlug: string }) {
  const entry = findDoc(activeSlug);
  if (!entry) return null;
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 sm:flex">
      <a
        href={withBase(`/docs/${DOCS_HOME_SLUG}/`)}
        className="shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-paper-dim transition-colors hover:text-paper"
      >
        Docs
      </a>
      <span aria-hidden className="shrink-0 text-ink-800">
        ▸
      </span>
      <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-paper-faint">
        {entry.group.label}
      </span>
      <span aria-hidden className="shrink-0 text-ink-800">
        ▸
      </span>
      <span className="truncate font-mono text-[11px] uppercase tracking-[0.16em] text-paper-muted">
        {entry.page.title}
      </span>
    </nav>
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
          <a href={withBase(`/docs/${prev.slug}/`)} className="group block">
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
          <a href={withBase(`/docs/${next.slug}/`)} className="group block">
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

export function DocsLayout({ activeSlug, headings, children, showPrevNext = true }: DocsLayoutProps) {
  return (
    <div className="min-h-screen bg-ink-50 text-paper">
      {/* Docs top bar — minimal: wordmark ▸ breadcrumb ▸ GitHub */}
      <header className="sticky top-0 z-40 border-b border-ink-500 bg-ink-50/85 backdrop-blur-md">
        <div className="container-editorial flex h-12 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              data-drawer-toggle
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xs border border-ink-500 text-paper-muted transition-colors hover:text-paper md:hidden"
              aria-label="Open docs navigation"
              aria-controls="docs-drawer"
            >
              <Menu className="h-4 w-4" />
            </button>
            <Wordmark />
            <span aria-hidden className="hidden text-ink-800 sm:inline">
              ▸
            </span>
            <Breadcrumb activeSlug={activeSlug} />
          </div>
          <GithubLink />
        </div>
      </header>

      <div className="container-editorial grid gap-x-10 gap-y-10 py-10 md:py-14 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_220px]">
        {/* Left rail */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8">
            <SidebarNav activeSlug={activeSlug} />
          </div>
        </aside>

        {/* Content */}
        <main className="min-w-0 pb-16">
          {children}
          {showPrevNext && <PrevNext activeSlug={activeSlug} />}
        </main>

        {/* Right rail */}
        <aside className="hidden xl:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8">
            <Toc headings={headings} />
          </div>
        </aside>
      </div>

      {/* Mobile drawer */}
      <div id="docs-drawer" className="fixed inset-0 z-50 hidden md:hidden" role="dialog" aria-modal="true">
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
          <SidebarNav activeSlug={activeSlug} />
        </div>
      </div>
    </div>
  );
}
