import { ArrowDown } from "lucide-react";
import { Section, Container, SectionHeader, CodeBlock, SecondaryAction } from "./Section";

interface Step {
  title: string;
  description: string;
  body: React.ReactNode;
}

const DOCKER_COMPOSE_YML = `services:
  chouse-ui:
    image: ghcr.io/daun-gatal/chouse-ui:latest
    container_name: chouse-ui
    ports:
      - "5521:5521"
    environment:
      NODE_ENV: production
      JWT_SECRET: dev-secret-change-me
      RBAC_ENCRYPTION_KEY: dev-key-change-me
      RBAC_ENCRYPTION_SALT: dev-salt-change-me
    volumes:
      - ./data:/app/data
    restart: unless-stopped

  clickhouse:
    image: clickhouse/clickhouse-server:latest
    container_name: clickhouse-server
    ports:
      - "8123:8123"
    environment:
      CLICKHOUSE_USER: admin
      CLICKHOUSE_PASSWORD: password
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: 1
    restart: unless-stopped`;

const STEPS: Step[] = [
  {
    title: "Prerequisites",
    description: "Minimal local requirements.",
    body: (
      <ul className="flex flex-col gap-2 font-mono text-[13px] text-paper-muted">
        <li>· Docker &amp; Docker Compose installed</li>
        <li>· Ports 5521 (UI) and 8123 (ClickHouse HTTP) free</li>
        <li>· 2 GB RAM recommended</li>
      </ul>
    ),
  },
  {
    title: "docker-compose.yml",
    description: "Drop in the full stack: CHouse UI + ClickHouse.",
    body: (
      <div className="flex flex-col gap-4">
        <CodeBlock language="yaml" filename="docker-compose.yml" code={DOCKER_COMPOSE_YML} maxHeight="320px" />
        <CodeBlock language="bash" filename="bash" code="docker compose up -d" />
      </div>
    ),
  },
  {
    title: "Open and sign in",
    description: "First-run admin is created automatically.",
    body: (
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-ink-500 bg-ink-100 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">URL</p>
          <p className="mt-2 font-mono text-[13px] text-paper">http://localhost:5521</p>
        </div>
        <div className="rounded-md border border-ink-500 bg-ink-100 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-faint">Default login</p>
          <p className="mt-2 font-mono text-[13px] text-paper">
            <span className="text-paper-dim">email </span>admin@localhost
          </p>
          <p className="font-mono text-[13px] text-paper">
            <span className="text-paper-dim">pass  </span>admin123!
          </p>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
            ⚠ Rotate before exposing to anyone
          </p>
        </div>
      </div>
    ),
  },
];

export default function QuickStart() {
  return (
    <Section id="quick-start" aria-label="Quick start guide">
      <Container>
        <SectionHeader
          eyebrow="Quick start"
          eyebrowIndex={6}
          title="Local in under five minutes."
          description="Three commands. No registration. Works on any machine with Docker."
        />

        <ol className="mt-16 flex flex-col">
          {STEPS.map((step, idx) => {
            const number = String(idx + 1).padStart(2, "0");
            const isLast = idx === STEPS.length - 1;
            return (
              <li
                key={step.title}
                className="relative grid grid-cols-[auto_1fr] gap-x-6 gap-y-6 border-t border-ink-500 pt-10 md:gap-x-10 md:pt-12"
                style={isLast ? { paddingBottom: "0" } : { paddingBottom: "3rem" }}
              >
                <div className="flex flex-col items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xs border border-ink-500 bg-ink-100 font-mono text-[12px] text-paper">
                    {number}
                  </span>
                  {!isLast && <span className="w-px flex-1 bg-ink-500" aria-hidden />}
                </div>
                <div className="flex flex-col gap-5 pb-2">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-display-md font-semibold text-paper">{step.title}</h3>
                    <p className="text-sm text-paper-muted">{step.description}</p>
                  </div>
                  <div>{step.body}</div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-16 flex flex-col items-start gap-3 border-t border-ink-500 pt-10">
          <p className="text-sm text-paper-muted">
            Going to production? Read the deployment guide below — JWT secret, encryption key, PostgreSQL, reverse proxy.
          </p>
          <SecondaryAction href="#docker-deploy">
            <ArrowDown className="h-4 w-4" />
            Production deployment
          </SecondaryAction>
        </div>
      </Container>
    </Section>
  );
}
