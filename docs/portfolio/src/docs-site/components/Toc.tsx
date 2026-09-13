/**
 * Right-rail "On this page". Links are static; the active highlight is added
 * by docs-client.js via IntersectionObserver over the same ids.
 */
export function Toc({ headings }: { headings: Array<{ id: string; text: string; level: number }> }) {
  if (headings.length === 0) return null;
  return (
    <div id="docs-toc">
      <p className="label-mono mb-3 text-[10px]">On this page</p>
      <ul className="flex flex-col gap-1.5 border-l border-ink-500">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              data-toc-link={heading.id}
              className={heading.level === 3 ? "block pl-6 text-[12.5px] leading-snug text-paper-faint transition-colors hover:text-paper-muted" : "block pl-3 text-[12.5px] leading-snug text-paper-muted transition-colors hover:text-paper"}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
