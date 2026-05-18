import { useState } from "react";
import { motion } from "framer-motion";
import { Terminal, Cloud, AlertCircle, Check } from "lucide-react";
import { Section, Container, SectionHeader, CodeBlock, Tag } from "./Section";
import { cn } from "@/lib/utils";

const YAML_CONFIG = `# CHouse UI YAML configuration
# Mount to /app/config.yaml

port: 5521
node_env: production
static_path: ./dist
cors_origin: "*"

rbac:
  db_type: postgres
  postgres_url: "postgres://user:password@host:5432/dbname"
  postgres_pool_size: 10

  encryption:
    key: "change-me-in-production"
    salt: "change-me-in-production"

  admin:
    email: admin@localhost
    username: admin
    password: admin123!

jwt:
  secret: "change-me-in-production"
  access_expiry: 4h
  refresh_expiry: 7d

ai:
  optimizer_enabled: false
  provider: openai`;

const DOCKER_PROD = `version: '3.8'

services:
  chouse-ui:
    image: ghcr.io/daun-gatal/chouse-ui:latest
    container_name: chouse-ui
    ports:
      - "5521:5521"
    volumes:
      - ./data:/app/data
      - ./config.yaml:/app/config.yaml:ro
    environment:
      CHOUSE_CONFIG_PATH: /app/config.yaml
    restart: unless-stopped`;

const K8S_MANIFEST = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: chouse-ui
  namespace: default
  labels:
    app: chouse-ui
spec:
  replicas: 1
  selector:
    matchLabels:
      app: chouse-ui
  template:
    metadata:
      labels:
        app: chouse-ui
    spec:
      containers:
        - name: chouse-ui
          image: ghcr.io/daun-gatal/chouse-ui:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 5521
              name: http
          env:
            - name: CHOUSE_CONFIG_PATH
              value: "/app/config.yaml"
          volumeMounts:
            - name: rbac-data
              mountPath: /app/data
            - name: config-volume
              mountPath: /app/config.yaml
              subPath: config.yaml
          livenessProbe:
            httpGet:
              path: /api/health
              port: 5521
            initialDelaySeconds: 30
            periodSeconds: 10
      volumes:
        - name: rbac-data
          emptyDir: {} # use PVC in production
        - name: config-volume
          configMap:
            name: chouse-ui-config
---
apiVersion: v1
kind: Service
metadata:
  name: chouse-ui
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 5521
      protocol: TCP
      name: http
  selector:
    app: chouse-ui`;

type Tab = "setup" | "config" | "deploy";
type DeployTarget = "docker" | "kubernetes";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "setup", label: "Production setup" },
  { id: "config", label: "YAML config" },
  { id: "deploy", label: "Deploy" },
];

const CHECKLIST = [
  { label: "Generate JWT_SECRET", cmd: "openssl rand -base64 32" },
  { label: "Generate RBAC_ENCRYPTION_KEY", cmd: "openssl rand -hex 32" },
  { label: "Generate RBAC_ENCRYPTION_SALT", cmd: "openssl rand -hex 32" },
  { label: "Use PostgreSQL for multi-instance", cmd: "RBAC_DB_TYPE=postgres" },
  { label: "Terminate TLS at a reverse proxy", cmd: "nginx · traefik · caddy" },
  { label: "Restrict CORS_ORIGIN", cmd: "CORS_ORIGIN=https://your.domain" },
];

export default function DockerDeploy() {
  const [tab, setTab] = useState<Tab>("setup");
  const [target, setTarget] = useState<DeployTarget>("docker");

  return (
    <Section id="docker-deploy" aria-label="Production deployment">
      <Container>
        <SectionHeader
          eyebrow="Production"
          eyebrowIndex={7}
          title="Deploy properly. No surprises."
          description="Production checklist, YAML config reference, and minimal Docker / Kubernetes manifests."
        />

        <div className="mt-16 overflow-hidden rounded-md border border-ink-500">
          {/* Tab bar */}
          <div role="tablist" className="flex border-b border-ink-500 bg-ink-100">
            {TABS.map((t) => {
              const isActive = tab === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "relative flex-1 px-5 py-3 text-left font-mono text-[11px] uppercase tracking-[0.16em] transition-colors",
                    isActive ? "text-paper" : "text-paper-dim hover:text-paper"
                  )}
                >
                  {t.label}
                  {isActive && (
                    <motion.span
                      layoutId="deployActiveTab"
                      className="absolute inset-x-0 -bottom-px h-px bg-accent"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="p-8 md:p-10">
            {tab === "setup" && (
              <div className="flex flex-col gap-8">
                <div className="flex items-start gap-3 rounded-md border border-accent/30 bg-accent/[0.04] p-4">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                  <p className="text-sm text-paper-muted">
                    Server refuses to boot in <span className="font-mono text-paper">NODE_ENV=production</span> without
                    <span className="font-mono text-paper"> JWT_SECRET</span>,
                    <span className="font-mono text-paper"> RBAC_ENCRYPTION_KEY</span>, and
                    <span className="font-mono text-paper"> RBAC_ENCRYPTION_SALT</span>.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
                  {CHECKLIST.map((item) => (
                    <div key={item.label} className="flex items-start gap-3 border-t border-ink-500 pt-4 first:border-t-0 first:pt-0 md:border-t-0 md:pt-0 md:[&:nth-child(n+3)]:border-t md:[&:nth-child(n+3)]:pt-4">
                      <Check className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden />
                      <div className="flex flex-1 flex-col gap-1">
                        <span className="text-[14px] text-paper">{item.label}</span>
                        <code className="font-mono text-[12px] text-paper-muted">{item.cmd}</code>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "config" && (
              <div className="flex flex-col gap-5">
                <p className="text-sm leading-relaxed text-paper-muted">
                  Create <span className="font-mono text-paper">config.yaml</span> and point
                  {" "}<span className="font-mono text-paper">CHOUSE_CONFIG_PATH</span> at it. All env vars in
                  README map 1:1 to YAML keys.
                </p>
                <CodeBlock language="yaml" filename="config.yaml" code={YAML_CONFIG} maxHeight="420px" />
              </div>
            )}

            {tab === "deploy" && (
              <div className="flex flex-col gap-6">
                <div className="inline-flex w-fit overflow-hidden rounded-xs border border-ink-500">
                  {[
                    { id: "docker" as const, label: "Docker Compose", icon: Terminal },
                    { id: "kubernetes" as const, label: "Kubernetes", icon: Cloud },
                  ].map((opt) => {
                    const Icon = opt.icon;
                    const active = target === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setTarget(opt.id)}
                        className={cn(
                          "inline-flex items-center gap-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                          active ? "bg-accent text-ink-50" : "bg-transparent text-paper-dim hover:text-paper"
                        )}
                        aria-pressed={active}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

                {target === "docker" ? (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                      <Tag variant="accent">Production-ready</Tag>
                      <span className="text-sm text-paper-muted">Assumes external ClickHouse. Adjust connection in the UI.</span>
                    </div>
                    <CodeBlock language="yaml" filename="docker-compose.yml" code={DOCKER_PROD} maxHeight="360px" />
                    <CodeBlock language="bash" filename="bash" code="docker compose up -d" />
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                      <Tag variant="accent">K8s manifest</Tag>
                      <span className="text-sm text-paper-muted">Pair with a ConfigMap holding your config.yaml.</span>
                    </div>
                    <CodeBlock language="yaml" filename="chouse-ui.yaml" code={K8S_MANIFEST} maxHeight="420px" />
                    <CodeBlock language="bash" filename="bash" code="kubectl apply -f chouse-ui.yaml && kubectl get pods -l app=chouse-ui" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Container>
    </Section>
  );
}
