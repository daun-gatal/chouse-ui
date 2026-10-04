import { DOC_SECTIONS, docPath, sectionPath } from "../manifest";
import { withBase } from "../lib";
import { cn } from "@/lib/utils";
import type { DocPage } from "../manifest";

function PageLink({ page, activeSlug }: { page: DocPage; activeSlug?: string }) {
  const isActive = page.slug === activeSlug;
  return (
    <li>
      <a
        href={withBase(docPath(page.slug))}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "relative flex items-center rounded-xs px-3 py-1.5 text-[13.5px] transition-colors",
          isActive ? "bg-ink-200 font-medium text-paper" : "text-paper-muted hover:bg-ink-100 hover:text-paper"
        )}
      >
        {isActive && <span aria-hidden className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 bg-accent" />}
        <span className={cn(isActive && "pl-1.5")}>{page.title}</span>
      </a>
    </li>
  );
}

/**
 * Left-rail navigation. Labelled groups (the app's menus under "Using CHouse
 * UI") are native <details>, so they collapse without JavaScript; the group
 * holding the current page renders open.
 */
export function SidebarNav({ activeSlug, activeSection }: { activeSlug?: string; activeSection?: string }) {
  return (
    <nav aria-label="Docs sections">
      {DOC_SECTIONS.map((section) => (
        <div key={section.id} className="border-b border-ink-500 py-5 first:pt-0 last:border-b-0">
          <a
            href={withBase(sectionPath(section.id))}
            aria-current={section.id === activeSection ? "page" : undefined}
            className={cn(
              "label-mono mb-3 block px-3 text-[10px] transition-colors hover:text-paper",
              section.id === activeSection && "text-accent"
            )}
          >
            {section.label}
          </a>
          <ul className="flex flex-col gap-0.5">
            {section.groups.map((group) => {
              if (!group.label) {
                return group.pages.map((page) => <PageLink key={page.slug} page={page} activeSlug={activeSlug} />);
              }
              const open = group.pages.some((page) => page.slug === activeSlug);
              return (
                <li key={group.id}>
                  <details open={open} className="group/nav">
                    <summary className="flex cursor-pointer list-none items-center justify-between rounded-xs px-3 py-1.5 text-[13.5px] font-medium text-paper transition-colors hover:bg-ink-100 [&::-webkit-details-marker]:hidden">
                      <span>{group.label}</span>
                      <span aria-hidden className="font-mono text-[10px] text-paper-faint transition-transform group-open/nav:rotate-90">
                        ▸
                      </span>
                    </summary>
                    <ul className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-ink-500 pl-1">
                      {group.pages.map((page) => (
                        <PageLink key={page.slug} page={page} activeSlug={activeSlug} />
                      ))}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
