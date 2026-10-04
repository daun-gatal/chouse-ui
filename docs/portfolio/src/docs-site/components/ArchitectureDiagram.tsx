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
      {/* Client layer */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-ink-500 bg-ink-100 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-[15px] font-semibold text-paper">Browser</h4>
            <span className="font-mono text-[10px] text-paper-faint">session JWT</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip>React 19 SPA</Chip>
            <Chip>TanStack Query</Chip>
          </div>
        </div>
        <div className="rounded-md border border-ink-500 bg-ink-100 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-[15px] font-semibold text-paper">chouse CLI</h4>
            <span className="font-mono text-[10px] text-paper-faint">ch_pat_ token</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip>scripts · CI</Chip>
            <Chip>/api/*</Chip>
          </div>
        </div>
        <div className="rounded-md border border-ink-500 bg-ink-100 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-[15px] font-semibold text-paper">AI agents</h4>
            <span className="font-mono text-[10px] text-paper-faint">ch_pat_ token</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip>MCP clients</Chip>
            <Chip>/mcp</Chip>
          </div>
        </div>
      </div>

      <Connector label="one port: /, /api/*, /mcp" />

      {/* Server layer */}
      <div className="rounded-md border border-ink-500 bg-ink-100 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="text-[15px] font-semibold text-paper">CHouse UI server</h4>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper-faint">
            packages/server · Bun + Hono
          </span>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <Row label="Every request">
            <Chip>Authenticate</Chip>
            <Chip>Permission</Chip>
            <Chip>SQL parser</Chip>
            <Chip>Data access</Chip>
            <Chip>Schema preflight</Chip>
            <Chip>Agent budgets</Chip>
            <Chip>Audit</Chip>
          </Row>
          <Row label="Features">
            <Chip>Explorer &amp; query</Chip>
            <Chip>Monitoring</Chip>
            <Chip>Data</Chip>
            <Chip>Fleet</Chip>
            <Chip>Doctor</Chip>
            <Chip>Agents &amp; MCP tools</Chip>
            <Chip>Admin</Chip>
          </Row>
          <Row label="Background">
            <Chip>Observability collector</Chip>
            <Chip>Fleet alerter</Chip>
            <Chip>Scheduled queries</Chip>
            <Chip>Remediation worker</Chip>
            <Chip>Doctor scheduler</Chip>
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
            <Chip>connection credentials</Chip>
            <Chip>remediation credential</Chip>
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
            <Chip>RBAC · audit · jobs</Chip>
            <Chip>evidence · leases</Chip>
          </div>
        </div>
      </div>

      <figcaption className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
        Every client → one server → ClickHouse / AI / database — credentials never leave the server
      </figcaption>
    </figure>
  );
}
