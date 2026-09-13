import { DOC_GROUPS } from "../manifest";
import { withBase } from "../lib";
import { cn } from "@/lib/utils";

export function SidebarNav({ activeSlug }: { activeSlug: string }) {
  return (
    <nav aria-label="Docs sections">
      {DOC_GROUPS.map((group) => (
        <div key={group.id} className="border-b border-ink-500 py-5 first:pt-0 last:border-b-0">
          <p className="label-mono mb-3 px-3 text-[10px]">{group.label}</p>
          <ul className="flex flex-col gap-0.5">
            {group.pages.map((page) => {
              const isActive = page.slug === activeSlug;
              return (
                <li key={page.slug}>
                  <a
                    href={withBase(`/docs/${page.slug}/`)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "relative flex items-center rounded-xs px-3 py-1.5 text-[13.5px] transition-colors",
                      isActive
                        ? "bg-ink-200 font-medium text-paper"
                        : "text-paper-muted hover:bg-ink-100 hover:text-paper"
                    )}
                  >
                    {isActive && (
                      <span aria-hidden className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 bg-accent" />
                    )}
                    <span className={cn(isActive && "pl-1.5")}>{page.title}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
