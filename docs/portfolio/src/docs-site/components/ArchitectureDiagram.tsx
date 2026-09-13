import type { ReactNode } from "react";

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-xs border border-ink-500 bg-ink-200 px-2 py-1 font-mono text-[11px] leading-none text-paper-muted">
      {children}
    </span>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-ink-500 pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Connector({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-1" aria-hidden>
      <span className="h-px flex-1 max-w-28 bg-ink-600" />
      <span className="font-mono text-[11px] text-paper-dim">{label}</span>
      <span className="text-accent text-[11px]">▼</span>
      <span className="h-px flex-1 max-w-28 bg-ink-600" />
    </div>
  );
}

/**
 * Editorial architecture diagram — pure static HTML/Tailwind in the docs theme
 * (replaces a mermaid block; renders without JS, SEO-visible).
 */
export function ArchitectureDiagram() {
  return (
    <figure className="mt-8 flex flex-col" aria-label="CHouse UI architecture">
      {/* Browser layer */}
      <div className="rounded-md border border-ink-500 bg-ink-100 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-[15px] font-semibold text-paper">Browser</h4>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint">
            React 19 SPA
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip>Vite 7 + React Router v7</Chip>
          <Chip>Zustand stores</Chip>
          <Chip>TanStack Query v5</Chip>
          <Chip>ApiClient (fetch)</Chip>
        </div>
      </div>

      <Connector label="/api/*" />

      {/* Server layer */}
      <div className="rounded-md border border-ink-500 bg-ink-100 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-[15px] font-semibold text-paper">Bun server</h4>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint">
            packages/server · Hono v4
          </span>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <Row label="Middleware">
            <Chip>CORS</Chip>
            <Chip>Rate limit</Chip>
            <Chip>SQL parser</Chip>
            <Chip>Data access</Chip>
          </Row>
          <Row label="Routes">
            <Chip>query</Chip>
            <Chip>explorer</Chip>
            <Chip>metrics</Chip>
            <Chip>saved-queries</Chip>
            <Chip>live-queries</Chip>
            <Chip>upload</Chip>
            <Chip>ai-chat</Chip>
          </Row>
          <Row label="Services">
            <Chip>ClickHouse proxy</Chip>
            <Chip>AI optimizer</Chip>
            <Chip>Query analyzer</Chip>
            <Chip>AI chat</Chip>
          </Row>
          <Row label="RBAC">
            <Chip>Auth</Chip>
            <Chip>Users</Chip>
            <Chip>Roles</Chip>
            <Chip>Connections</Chip>
            <Chip>Audit</Chip>
            <Chip>Data access</Chip>
            <Chip>AI providers/models</Chip>
          </Row>
        </div>
      </div>

      <Connector label="server-side clients" />

      {/* External layer */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-ink-500 bg-ink-100 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-[15px] font-semibold text-paper">ClickHouse</h4>
            <span className="font-mono text-[10px] text-paper-faint">▼</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip>@clickhouse/client</Chip>
            <Chip>system.* reads</Chip>
          </div>
        </div>
        <div className="rounded-md border border-ink-500 bg-ink-100 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-[15px] font-semibold text-paper">AI provider</h4>
            <span className="font-mono text-[10px] text-paper-faint">▼</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip>DeepAgents / LangChain</Chip>
            <Chip>OpenAI · Anthropic · Bedrock · Ollama …</Chip>
          </div>
        </div>
        <div className="rounded-md border border-ink-500 bg-ink-100 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-[15px] font-semibold text-paper">SQLite / PostgreSQL</h4>
            <span className="font-mono text-[10px] text-paper-faint">▼</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip>Drizzle ORM</Chip>
            <Chip>RBAC + audit + jobs</Chip>
          </div>
        </div>
      </div>

      <figcaption className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
        Browser → server proxy → ClickHouse / AI / database — credentials never leave the server
      </figcaption>
    </figure>
  );
}
