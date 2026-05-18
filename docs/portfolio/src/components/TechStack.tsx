import { useState } from "react";
import { Section, Container, SectionHeader } from "./Section";

interface Tech {
  name: string;
  category: string;
  desc: string;
  url: string;
  icon: string;
  fallback: string;
}

type IconState = "primary" | "fallback" | "missing";

function TechIcon({ tech }: { tech: Tech }) {
  const [state, setState] = useState<IconState>("primary");

  if (state === "missing") {
    // Tiny inline placeholder — no broken-image glyph.
    return <span aria-hidden className="block h-5 w-5 rounded-xs border border-ink-500" />;
  }

  const slug = state === "primary" ? tech.icon : tech.fallback;
  const src = `https://api.iconify.design/${slug}.svg?color=%23fafafa&width=64`;

  return (
    <img
      key={src}
      src={src}
      alt=""
      aria-hidden
      className="h-5 w-5 object-contain"
      onError={() => setState(state === "primary" ? "fallback" : "missing")}
    />
  );
}

const STACK: Tech[] = [
  { name: "ClickHouse", category: "Database", desc: "Analytics database", url: "https://clickhouse.com/", icon: "simple-icons:clickhouse", fallback: "mdi:database" },
  { name: "PostgreSQL", category: "RBAC store", desc: "Production RBAC backend", url: "https://www.postgresql.org/", icon: "simple-icons:postgresql", fallback: "mdi:database" },
  { name: "Bun", category: "Runtime", desc: "JavaScript runtime", url: "https://bun.sh/", icon: "simple-icons:bun", fallback: "mdi:language-javascript" },
  { name: "Hono", category: "Server", desc: "Lightweight web framework", url: "https://hono.dev/", icon: "simple-icons:hono", fallback: "mdi:web" },
  { name: "React 19", category: "Frontend", desc: "UI library", url: "https://react.dev/", icon: "simple-icons:react", fallback: "mdi:react" },
  { name: "Vite 7", category: "Tooling", desc: "Build & dev server", url: "https://vitejs.dev/", icon: "simple-icons:vite", fallback: "mdi:lightning-bolt" },
  { name: "Tailwind 4", category: "Styling", desc: "Utility CSS", url: "https://tailwindcss.com/", icon: "simple-icons:tailwindcss", fallback: "mdi:tailwind" },
  { name: "Drizzle ORM", category: "Data", desc: "Type-safe SQL", url: "https://orm.drizzle.team/", icon: "simple-icons:drizzle", fallback: "mdi:database-cog" },
  { name: "Monaco", category: "Editor", desc: "SQL editor core", url: "https://microsoft.github.io/monaco-editor/", icon: "simple-icons:visualstudiocode", fallback: "mdi:code-tags" },
  { name: "AG Grid", category: "Tables", desc: "Result grid", url: "https://www.ag-grid.com/", icon: "mdi:table-large", fallback: "mdi:grid" },
  { name: "Zustand", category: "State", desc: "Client store", url: "https://zustand-demo.pmnd.rs/", icon: "mdi:atom-variant", fallback: "mdi:circle-outline" },
  { name: "Vercel AI SDK", category: "AI", desc: "Multi-provider LLM", url: "https://sdk.vercel.ai/", icon: "mdi:brain", fallback: "mdi:robot" },
];

export default function TechStack() {
  return (
    <Section id="tech-stack" aria-label="Tech stack">
      <Container>
        <SectionHeader
          eyebrow="Stack"
          eyebrowIndex={8}
          title="Built on tools you already trust."
          description="Mainstream, mature dependencies. Nothing exotic."
        />

        <div className="mt-16 grid grid-cols-2 border-l border-t border-ink-500 sm:grid-cols-3 lg:grid-cols-4">
          {STACK.map((tech) => (
            <a
              key={tech.name}
              href={tech.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col gap-3 border-b border-r border-ink-500 p-6 transition-colors hover:bg-ink-100"
            >
              <div className="flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-xs border border-ink-500 bg-ink-100 transition-colors group-hover:border-ink-700">
                  <TechIcon tech={tech} />
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
                  {tech.category}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="text-[15px] font-semibold text-paper transition-colors group-hover:text-accent">
                  {tech.name}
                </h3>
                <p className="text-sm text-paper-muted">{tech.desc}</p>
              </div>
            </a>
          ))}
        </div>
      </Container>
    </Section>
  );
}
