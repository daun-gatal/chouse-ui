import { Github } from "lucide-react";
import { Container } from "./Section";

const NAV = [
  { label: "Features", href: "#features" },
  { label: "Highlights", href: "#highlights" },
  { label: "Try Lab", href: "#try-lab" },
  { label: "Quick Start", href: "#quick-start" },
  { label: "Production", href: "#docker-deploy" },
  { label: "FAQ", href: "#faq" },
];

const RESOURCES = [
  { label: "GitHub", href: "https://github.com/daun-gatal/chouse-ui", external: true },
  { label: "Issues", href: "https://github.com/daun-gatal/chouse-ui/issues", external: true },
  { label: "Changelog", href: "#changelog" },
  { label: "License", href: "https://www.apache.org/licenses/LICENSE-2.0", external: true },
];

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-ink-500 bg-ink-50">
      <Container>
        <div className="grid grid-cols-12 gap-x-6 gap-y-12 py-20">
          {/* Identity */}
          <div className="col-span-12 flex flex-col gap-5 md:col-span-5">
            <div className="flex items-center gap-2.5">
              <img
                src={`${import.meta.env.BASE_URL}logo.svg`}
                alt=""
                aria-hidden
                className="h-6 w-6"
                width="24"
                height="24"
                loading="lazy"
              />
              <span className="text-[15px] font-semibold tracking-tight text-paper">
                CHouse<span className="text-paper-dim">UI</span>
              </span>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-paper-muted">
              An open-source web UI for ClickHouse with built-in RBAC, encrypted credentials,
              and audit logging. Built for teams that share a database.
            </p>
            <a
              href="https://github.com/daun-gatal/chouse-ui"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex h-9 w-fit items-center gap-2 rounded-xs border border-ink-500 px-3 text-[13px] font-medium text-paper-muted transition-colors hover:border-ink-700 hover:text-paper"
            >
              <Github className="h-3.5 w-3.5" />
              Star on GitHub
            </a>
          </div>

          {/* Nav */}
          <nav className="col-span-6 flex flex-col gap-4 md:col-span-3" aria-label="Footer navigation">
            <h4 className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
              Navigate
            </h4>
            <ul className="flex flex-col gap-2">
              {NAV.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    className="text-[13px] text-paper-muted transition-colors hover:text-paper"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {/* Resources */}
          <nav className="col-span-6 flex flex-col gap-4 md:col-span-4" aria-label="Resources">
            <h4 className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">
              Resources
            </h4>
            <ul className="flex flex-col gap-2">
              {RESOURCES.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    target={item.external ? "_blank" : undefined}
                    rel={item.external ? "noopener noreferrer" : undefined}
                    className="text-[13px] text-paper-muted transition-colors hover:text-paper"
                  >
                    {item.label}
                    {item.external && <span aria-hidden className="ml-1 text-paper-faint">↗</span>}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col gap-3 border-t border-ink-500 py-6 md:flex-row md:items-center md:justify-between">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
            © {year} CHouse UI · Apache 2.0
          </p>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper-faint">
            Inspired by{" "}
            <a
              href="https://github.com/caioricciuti/ch-ui"
              target="_blank"
              rel="noopener noreferrer"
              className="text-paper-muted hover:text-paper"
            >
              CH-UI
            </a>
          </p>
        </div>
      </Container>
    </footer>
  );
}
