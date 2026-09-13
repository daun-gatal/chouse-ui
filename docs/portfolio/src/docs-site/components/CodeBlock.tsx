import type { ReactNode } from "react";

/**
 * Static code block for docs pages. The copy action is wired by
 * docs-client.js (vanilla) via [data-docs-copy] so pages render fully
 * server-side.
 */
export function CodeBlock({
  code,
  language = "text",
  filename,
}: {
  code: string;
  language?: string;
  filename?: string;
}) {
  return (
    <div data-code-wrap className="group/code mt-6 overflow-hidden rounded-md border border-ink-500 bg-ink-100">
      <div className="flex items-center justify-between border-b border-ink-500 bg-ink-200 px-4 py-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-muted">
          {filename ?? language}
        </span>
        <button
          type="button"
          data-docs-copy
          className="rounded-xs px-2 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-dim transition-colors hover:bg-ink-300 hover:text-paper"
          aria-label="Copy code"
        >
          <span data-docs-copy-label>Copy</span>
        </button>
      </div>
      <pre className="m-0 overflow-x-auto px-5 py-5 font-mono text-[12.5px] leading-relaxed text-paper-muted">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function CodeInline({ children }: { children?: ReactNode }) {
  return (
    <code className="rounded-xs border border-ink-500 bg-ink-200 px-1.5 py-0.5 font-mono text-[12px] text-paper">
      {children}
    </code>
  );
}
