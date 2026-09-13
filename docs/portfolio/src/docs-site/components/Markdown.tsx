import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";
import { CodeBlock, CodeInline } from "./CodeBlock";
import { Callout } from "./Callout";
import { headingId, nodeText } from "../lib";

/**
 * Themed markdown renderer for docs pages. Runs server-side (SSG) — no hooks,
 * no browser APIs. Copy/scroll behavior is added by docs-client.js.
 */

function flatten(node: ReactNode): string {
  return nodeText(node);
}

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h2 id={headingId(flatten(children))} className="text-display-md mt-12 font-semibold text-paper">
            {children}
          </h2>
        ),
        h2: ({ children }) => (
          <h2
            id={headingId(flatten(children))}
            className="mt-14 border-t border-ink-500 pt-10 text-display-md font-semibold tracking-tight text-paper"
          >
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 id={headingId(flatten(children))} className="mt-10 text-xl font-semibold tracking-tight text-paper">
            {children}
          </h3>
        ),
        h4: ({ children }) => (
          <h4 id={headingId(flatten(children))} className="mt-8 text-lg font-semibold tracking-tight text-paper">
            {children}
          </h4>
        ),
        p: ({ children }) => <p className="mt-4 text-[15px] leading-relaxed text-paper-muted">{children}</p>,
        a: ({ href, children }) => {
          const external = /^https?:\/\//.test(href ?? "");
          const className =
            "text-paper underline decoration-ink-700 underline-offset-4 transition-colors hover:decoration-accent";
          if (external) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
                {children}
                <span aria-hidden className="ml-0.5 text-paper-faint">
                  ↗
                </span>
              </a>
            );
          }
          return (
            <a href={href} className={className}>
              {children}
            </a>
          );
        },
        strong: ({ children }) => <strong className="font-semibold text-paper">{children}</strong>,
        em: ({ children }) => <em className="italic text-paper">{children}</em>,
        ul: ({ children }) => (
          <ul className="mt-4 flex flex-col gap-2 text-[15px] leading-relaxed text-paper-muted">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-paper-muted marker:font-mono marker:text-paper-faint">
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="relative pl-5">
            <span aria-hidden className="absolute left-0 top-[0.72em] h-[3px] w-[3px] rounded-full bg-paper-faint" />
            {children}
          </li>
        ),
        blockquote: ({ children }) => {
          const text = flatten(children).trim();
          const variant = /^warning/i.test(text) ? "warning" : /^tip/i.test(text) ? "tip" : "note";
          return <Callout variant={variant}>{children}</Callout>;
        },
        hr: () => <hr className="mt-10 border-ink-500" />,
        pre: ({ children }) => {
          const child = Array.isArray(children) ? children[0] : children;
          if (child && typeof child === "object" && "props" in child) {
            const props = (child as { props: { className?: string; children?: ReactNode } }).props;
            const language = /language-([\w-]+)/.exec(props.className ?? "")?.[1];
            const code = flatten(props.children).replace(/\n$/, "");
            return <CodeBlock code={code} language={language ?? "text"} />;
          }
          return <pre>{children}</pre>;
        },
        code: ({ className, children }) => {
          if (className && className.includes("language-")) {
            return <code className={className}>{children}</code>;
          }
          return <CodeInline>{children}</CodeInline>;
        },
        table: ({ children }) => (
          <div className="mt-6 overflow-x-auto rounded-md border border-ink-500 bg-ink-100">
            <table className="w-full border-collapse text-left text-[13.5px]">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-ink-200">{children}</thead>,
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => <tr className="border-t border-ink-500 first:border-t-0">{children}</tr>,
        th: ({ children }) => (
          <th className="px-3.5 py-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-paper-dim">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-3.5 py-2.5 align-top leading-relaxed text-paper-muted [&_code]:mx-0">{children}</td>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
