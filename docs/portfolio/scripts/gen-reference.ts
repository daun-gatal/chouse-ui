/**
 * gen-reference.ts — generate the docs reference pages from the code.
 *
 *   bun scripts/gen-reference.ts           regenerate the pages
 *   bun scripts/gen-reference.ts --check   fail if a page is stale or docs coverage has a gap (CI)
 *
 * Generated pages (never edit them by hand; edit the source and regenerate):
 *
 *   permissions.md         packages/server rbac/schema/base.ts + rbac/services/seed.ts
 *   configuration-env.md   src/content/reference/config-keys.ts (+ .config.example.yaml for YAML keys)
 *   mcp-tools.md           packages/server mcp tool registry
 *   cli-reference.md       src/content/reference/cli.json (snapshot kept current by cli TestCommandReference)
 *   helm-values.md         charts/chouse-ui/README.md values table (helm-docs output)
 *   audit-events.md        packages/server rbac/schema/base.ts AUDIT_ACTIONS
 *   ai-features.md         packages/server services/ai capabilities + seeds (built-in agents and bindings)
 *   ai-tools.md            packages/server services/ai registry/catalog.ts, registry/harness.ts + seeds (harnesses, skills)
 *
 * plus src/content/reference/permissions.json, which build-docs uses to
 * validate and link the `permissions:` frontmatter on every page.
 *
 * Coverage checks (both modes report; --check fails on them):
 *   - every environment variable the server reads is in config-keys.ts, and
 *     every live entry there is still read
 *   - every screen in the app (routes and their tabs) is documented by some
 *     page — in its `route:` frontmatter or mentioned in its text
 *   - the announced release (src/content/release.ts: the landing banner and
 *     the What's new title) is not behind the version that the unreleased
 *     minor/major changelog fragments will produce
 *
 * Needs the repo checkout and `bun install` in packages/server (it imports
 * server modules). The site build itself only reads the generated files, so
 * the portfolio still builds from docs/portfolio alone.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";
import { AUDIT_ACTIONS, PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, SYSTEM_ROLES } from "../../../packages/server/src/rbac/schema/base";
import { PERMISSION_CATEGORIES, PERMISSION_DISPLAY_NAMES, ROLE_DEFINITIONS } from "../../../packages/server/src/rbac/services/seed";
import { listToolDefinitions, toolCatalog } from "../../../packages/server/src/mcp/server";
import { MCP_CATEGORY_LABELS, MCP_CATEGORY_ORDER } from "../../../src/features/agents/mcp";
import { CAPABILITIES } from "../../../packages/server/src/services/ai/capabilities";
import { describeCatalog } from "../../../packages/server/src/services/ai/registry/catalog";
import { BUILTIN_TOOLS } from "../../../packages/server/src/services/ai/registry/harness";
import { SEED_AGENTS, SEED_BINDINGS, SEED_HARNESSES, SEED_SKILLS, type SeedAgent } from "../../../packages/server/src/services/ai/seeds";
import type { AnyCapability } from "../../../packages/server/src/services/ai/types";
import { CONTEXT_HINTS, CONTEXT_LABELS, SURFACE_LABELS, SURFACE_ORDER } from "../../../src/features/agents/assistant/lib";
import { CONFIG_KEYS, CONFIG_SECTIONS, IGNORED_ENV } from "../src/content/reference/config-keys";
import { RELEASE } from "../src/content/release";
import { slugify } from "../src/docs-site/lib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(ROOT, "..", "..");
const DOCS = join(ROOT, "src", "content", "docs");
const REFERENCE = join(ROOT, "src", "content", "reference");
const CHECK = process.argv.includes("--check");

// ---------------------------------------------------------------------------
// Markdown helpers

/** Make text safe inside a markdown table cell. */
function cell(text: string): string {
  return text.replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").trim();
}

function code(text: string): string {
  return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
}

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((c) => (c === "" ? " " : c)).join(" | ")} |`),
  ].join("\n");
}

function page(generatedFrom: string, body: string): string {
  return `---\ngenerated: ${generatedFrom}\n---\n${body.trim()}\n`;
}

// ---------------------------------------------------------------------------
// Permissions

const ROLE_ORDER = [
  SYSTEM_ROLES.SUPER_ADMIN,
  SYSTEM_ROLES.ADMIN,
  SYSTEM_ROLES.DEVELOPER,
  SYSTEM_ROLES.ANALYST,
  SYSTEM_ROLES.VIEWER,
  SYSTEM_ROLES.GUEST,
];

interface PermissionRef {
  name: string;
  category: string;
  anchor: string;
}

function permissionIndex(): Record<string, PermissionRef> {
  const index: Record<string, PermissionRef> = {};
  for (const [category, permissions] of Object.entries(PERMISSION_CATEGORIES)) {
    for (const permission of permissions) {
      index[permission] = { name: PERMISSION_DISPLAY_NAMES[permission] ?? permission, category, anchor: slugify(category) };
    }
  }
  const uncategorized = Object.values(PERMISSIONS).filter((p) => !index[p]);
  if (uncategorized.length) {
    throw new Error(`Permissions without a category in seed.ts PERMISSION_CATEGORIES: ${uncategorized.join(", ")}`);
  }
  return index;
}

function permissionsPage(): string {
  const holders = (permission: string): string[] =>
    ROLE_ORDER.map((role) => (DEFAULT_ROLE_PERMISSIONS[role].includes(permission as never) ? "✓" : ""));
  const roleHeaders = ROLE_ORDER.map((role) => ROLE_DEFINITIONS[role].displayName.replace("Administrator", "Admin"));
  const sections = Object.entries(PERMISSION_CATEGORIES).map(([category, permissions]) =>
    [
      `## ${category}`,
      "",
      table(
        ["Permission", "Allows", ...roleHeaders],
        permissions.map((p) => [code(p), cell(PERMISSION_DISPLAY_NAMES[p] ?? ""), ...holders(p)])
      ),
    ].join("\n")
  );
  const roles = table(
    ["Role", "ID", "For", "Permissions"],
    ROLE_ORDER.map((role) => [
      ROLE_DEFINITIONS[role].displayName,
      code(role),
      cell(ROLE_DEFINITIONS[role].description),
      String(DEFAULT_ROLE_PERMISSIONS[role].length),
    ])
  );
  return page(
    "packages/server/src/rbac/schema/base.ts and rbac/services/seed.ts",
    `
Every permission in CHouse UI, grouped the way **Admin › Roles** groups them, with the built-in roles that hold it by default. The server checks the permission on every API, MCP and CLI request; the app hides what the signed-in user cannot use.

> **Note:** A permission opens a feature, not data. Which databases and tables a user can touch is decided separately by [data access rules](/docs/data-access-rules/), and ClickHouse still enforces the grants of the connection's own user.

## Built-in roles

${roles}

Built-in roles can't be deleted, and only a super admin can change their permissions — the ticks below are the defaults a fresh install starts with. Create your own roles in **Admin › Roles** from any mix of the permissions below — see [Users & roles](/docs/rbac-roles/).

${sections.join("\n\n")}
`
  );
}

// ---------------------------------------------------------------------------
// Audit events

/** Readable names for the area prefix of an audit action (`<area>.<verb>`). */
const AUDIT_AREAS: Record<string, string> = {
  auth: "Sign-in",
  pat: "Personal access tokens",
  mcp: "MCP",
  user: "Users",
  sso: "Single sign-on",
  role: "Roles",
  clickhouse: "ClickHouse",
  settings: "Settings",
  live_query: "Live queries",
  audit: "Audit log",
  ai_provider: "AI providers",
  ai_model: "AI provider models",
  ai_config: "AI deployments",
  connection: "Connections",
  data_access: "Data access",
  saved_query: "Saved queries",
  fleet: "Fleet",
  doctor: "Doctor",
  alerting: "Alerting",
  scheduled_query: "Scheduled queries",
  data_health: "Data health",
  observe: "Data observability",
  context: "Context",
  remediation: "Fixes",
  schema: "Schema preflight",
  notebook: "Notebooks",
  upgrade: "Upgrades",
  agent: "Agents",
  ai_agent: "AI agents",
  ai_harness: "AI harnesses",
  ai_skill: "AI skills",
  ai_binding: "AI feature bindings",
  ai_registry: "AI agent registry",
};

function auditEventsPage(): string {
  const groups = new Map<string, string[]>();
  for (const action of Object.values(AUDIT_ACTIONS)) {
    const area = action.split(".")[0];
    if (!AUDIT_AREAS[area]) throw new Error(`Audit action ${action}: add a label for "${area}" to AUDIT_AREAS`);
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area)?.push(action);
  }
  const rows = [...groups].map(([area, actions]) => [AUDIT_AREAS[area], actions.map(code).join(", ")]);
  return page(
    "AUDIT_ACTIONS in packages/server/src/rbac/schema/base.ts",
    `
Every action the [audit log](/docs/audit-log/) can record, by area — ${Object.keys(AUDIT_ACTIONS).length} in all. Filter the log by these names in **Admin › Audit logs**, or match them in an export.

${table(["Area", "Actions"], rows)}
`
  );
}

// ---------------------------------------------------------------------------
// Environment variables

/** Env name → YAML path, from the annotated example config. */
function yamlPaths(): Map<string, string> {
  const out = new Map<string, string>();
  const file = join(REPO, ".config.example.yaml");
  const walk = (node: unknown, path: string[]): void => {
    if (node && typeof node === "object" && !Array.isArray(node)) {
      for (const [key, value] of Object.entries(node)) walk(value, [...path, key]);
    } else if (path.length) {
      out.set(path.map((p) => p.toUpperCase()).join("_"), path.join("."));
    }
  };
  walk(Bun.YAML.parse(readFileSync(file, "utf8")), []);
  return out;
}

function envPage(): string {
  const yaml = yamlPaths();
  const required = CONFIG_KEYS.filter((k) => k.required === "production").map((k) => code(k.name));
  const sections = CONFIG_SECTIONS.map((section) => {
    const keys = CONFIG_KEYS.filter((k) => k.section === section);
    if (!keys.length) return "";
    const rows = keys.map((k) => {
      const tags = [
        k.required === "production" ? "**Required in production.**" : "",
        k.secret ? "*Secret.*" : "",
        k.status === "deprecated" ? "**Deprecated.**" : "",
        k.status === "removed" ? "**Removed.**" : "",
      ].filter(Boolean);
      const yamlKey = yaml.get(k.name);
      return [
        code(k.name),
        k.default !== undefined ? code(k.default) : "—",
        cell([...tags, k.description].join(" ") + (yamlKey ? ` YAML: ${code(yamlKey)}.` : "")),
      ];
    });
    return `## ${section}\n\n${table(["Variable", "Default", "Description"], rows)}`;
  });
  return page(
    "docs/portfolio/src/content/reference/config-keys.ts",
    `
Every setting the server reads, with its default. Set them as environment variables, or as keys in a YAML file named by \`CHOUSE_CONFIG_PATH\` — see [YAML configuration](/docs/configuration-yaml/).

- **Precedence:** a key in the YAML file overrides the environment variable of the same name. Keys the file leaves out keep the environment's value.
- **YAML names:** nested keys are joined with \`_\` and upper-cased, so \`rbac.db_type\` is \`RBAC_DB_TYPE\`. The YAML key shown below is the one the annotated example uses.
- **Production:** with \`NODE_ENV=production\` the server refuses to start without ${required.join(", ")}. Generate them with [openssl](/docs/configuration-secrets/).
- **In the app, not here:** the MCP endpoint, SSO providers created in Admin › SSO, alert rules, AI models and agent policies are stored in the database and changed in the UI.

${sections.filter(Boolean).join("\n\n")}
`
  );
}

/** Every env var the server reads: name → files that read it. */
function scanServerEnv(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const add = (name: string, file: string): void => {
    if (!found.has(name)) found.set(name, new Set());
    found.get(name)?.add(file);
  };
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.endsWith(".ts") || entry.includes(".test.") || entry.includes(".e2e.")) continue;
      const text = readFileSync(path, "utf8");
      const rel = relative(REPO, path);
      // process.env.X, env.X, env["X"]
      for (const m of text.matchAll(/env(?:\.|\[["'])([A-Z][A-Z0-9_]{2,})/g)) add(m[1], rel);
      // envInt("X", …) style helpers
      for (const m of text.matchAll(/env[A-Za-z]*\(\s*["']([A-Z][A-Z0-9_]{2,})["']/g)) add(m[1], rel);
    }
  };
  walk(join(REPO, "packages", "server", "src"));
  return found;
}

function checkEnvCoverage(): string[] {
  const read = scanServerEnv();
  const documented = new Map(CONFIG_KEYS.map((k) => [k.name, k]));
  const problems: string[] = [];
  for (const [name, files] of read) {
    if (IGNORED_ENV.has(name) || documented.has(name)) continue;
    if (name.startsWith("AUTH_SSO_PROVIDERS_")) continue;
    problems.push(`${name} is read by ${[...files].join(", ")} but missing from src/content/reference/config-keys.ts`);
  }
  for (const key of CONFIG_KEYS) {
    if (key.status === "removed" || key.name.includes("<")) continue;
    if (!read.has(key.name)) problems.push(`${key.name} is in config-keys.ts but the server no longer reads it — mark it removed or delete it`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// MCP tools

function mcpToolsPage(): string {
  const catalog = toolCatalog(listToolDefinitions(), { toolOverrides: {} });
  const accessLabel = { read: "Read", write: "Write", destructive: "Destructive" } as const;
  const summary = table(
    ["Tool", "Access", "On by default", "Needs any of"],
    MCP_CATEGORY_ORDER.flatMap((category) =>
      catalog
        .filter((t) => t.category === category)
        .map((t) => [
          `[${code(t.name)}](#${slugify(t.name)})`,
          accessLabel[t.access] + (t.spendsLlm ? " · LLM" : ""),
          t.enabledByDefault ? "Yes" : "No",
          t.permissions.length ? t.permissions.map(code).join(", ") : "any token",
        ])
    )
  );
  const details = MCP_CATEGORY_ORDER.map((category) => {
    const tools = catalog.filter((t) => t.category === category);
    if (!tools.length) return "";
    const blocks = tools.map((t) => {
      const facts = [
        `**${accessLabel[t.access]}**`,
        t.spendsLlm ? "spends LLM budget" : "",
        t.enabledByDefault ? "on by default" : "off by default",
        t.permissions.length ? `needs any of ${t.permissions.map(code).join(", ")}` : "any token",
      ].filter(Boolean);
      const params = t.parameters.length
        ? table(
            ["Parameter", "Type", "Required", "Description"],
            t.parameters.map((p) => [code(p.name), code(p.type), p.required ? "Yes" : "No", cell(p.description ?? "")])
          )
        : "No parameters.";
      return `### ${t.name}\n\n*${t.title}* — ${facts.join(" · ")}\n\n${t.description.trim()}\n\n${params}`;
    });
    return `## ${MCP_CATEGORY_LABELS[category]}\n\n${blocks.join("\n\n")}`;
  });
  const counts = {
    total: catalog.length,
    on: catalog.filter((t) => t.enabledByDefault).length,
  };
  return page(
    "the MCP tool registry in packages/server/src/mcp",
    `
All ${counts.total} tools the [MCP server](/docs/mcp/) offers. ${counts.on} are on by default: the read-only tools that don't spend LLM budget. Writes, destructive tools and tools that call the AI stay off until an administrator turns them on in **Agents › MCP**, one tool or one category at a time.

An agent only sees a tool in \`tools/list\` when it is on **and** the agent's token holds one of the listed permissions. The underlying API still checks the permission and the user's [data access rules](/docs/data-access-rules/) on every call.

| Access | Meaning | MCP annotations |
| --- | --- | --- |
| Read | Reads data or state; changes nothing | \`readOnlyHint\`, \`idempotentHint\` |
| Write | Creates something or starts work: saves a query, runs a job or check, proposes a fix, acknowledges an incident | — |
| Destructive | Runs DDL/DML, deletes CHouse UI objects or kills a query | \`destructiveHint\` |

## All tools

${summary}

${details.filter(Boolean).join("\n\n")}
`
  );
}

// ---------------------------------------------------------------------------
// CLI

interface CliFlag {
  name: string;
  shorthand?: string;
  type: string;
  default?: string;
  usage: string;
}

interface CliCommand {
  path: string;
  use: string;
  short: string;
  long?: string;
  example?: string;
  aliases?: string[];
  group?: string;
  flags?: CliFlag[];
}

interface CliReference {
  globalFlags: CliFlag[];
  groups: Array<{ id: string; title: string }>;
  commands: CliCommand[];
}

function flagTable(flags: CliFlag[]): string {
  return table(
    ["Flag", "Type", "Default", "Description"],
    flags.map((f) => [
      code(`${f.shorthand ? `-${f.shorthand}, ` : ""}--${f.name}`),
      f.type === "bool" ? "" : code(f.type),
      f.default ? code(f.default) : "",
      cell(f.usage),
    ])
  );
}

function cliPage(): string {
  const ref = JSON.parse(readFileSync(join(REFERENCE, "cli.json"), "utf8")) as CliReference;
  const topLevel = ref.commands.filter((c) => c.path.split(" ").length === 2);
  const groupTitle = new Map(ref.groups.map((g) => [g.id, g.title.replace(/:$/, "")]));
  const byGroup = [...ref.groups.map((g) => g.id), ""].map((id) => {
    const commands = topLevel.filter((c) => (c.group ?? "") === id);
    if (!commands.length) return "";
    return `## ${groupTitle.get(id) ?? "Other commands"}\n\n${commands
      .map((top) => {
        const family = ref.commands.filter((c) => c.path === top.path || c.path.startsWith(`${top.path} `));
        return family
          .map((c) => {
            const depth = c.path.split(" ").length;
            const heading = depth === 2 ? "###" : "####";
            const parts = [`${heading} ${c.path}`, "", c.short.replace(/\.?$/, ".")];
            if (c.long && c.long.trim() !== c.short.trim()) parts.push("", c.long.trim());
            parts.push("", "```bash", c.use, "```");
            if (c.aliases?.length) parts.push("", `Aliases: ${c.aliases.map(code).join(", ")}`);
            if (c.flags?.length) parts.push("", flagTable(c.flags));
            if (c.example) parts.push("", "```bash", c.example.replace(/^ {2}/gm, ""), "```");
            return parts.join("\n");
          })
          .join("\n\n");
      })
      .join("\n\n")}`;
  });
  return page(
    "the chouse command tree (src/content/reference/cli.json)",
    `
Every \`chouse\` command and flag, generated from the CLI itself. For installing, signing in, profiles, output formats and exit codes, read the [CLI guide](/docs/cli/) first.

## Global flags

Every command accepts these. Most can also come from the environment or the active profile.

${flagTable(ref.globalFlags)}

${byGroup.filter(Boolean).join("\n\n")}
`
  );
}

// ---------------------------------------------------------------------------
// Helm values

function helmPage(): string {
  const readme = readFileSync(join(REPO, "charts", "chouse-ui", "README.md"), "utf8");
  const start = readme.indexOf("## Values");
  if (start === -1) throw new Error("charts/chouse-ui/README.md has no ## Values section");
  const rows = readme
    .slice(start)
    .split("\n")
    .filter((line) => /^\| [^-|][^|]* \| [^|]+ \|/.test(line) && !line.startsWith("| Key "))
    .map((line) => line.slice(2, -2).split(" | "));
  const groups = new Map<string, string[][]>();
  for (const [key, type, def, ...desc] of rows) {
    const top = key.trim().split(".")[0];
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top)?.push([code(key.trim()), code(type.trim()), def.trim() || " ", desc.join(" | ").trim() || " "]);
  }
  const chart = readFileSync(join(REPO, "charts", "chouse-ui", "Chart.yaml"), "utf8");
  const version = /^version:\s*(\S+)/m.exec(chart)?.[1] ?? "?";
  const sections = [...groups].map(([top, items]) => `## ${top}\n\n${table(["Key", "Type", "Default", "Description"], items)}`);
  return page(
    "charts/chouse-ui/values.yaml (via the chart README)",
    `
Every value of the \`chouse-ui\` Helm chart, version **${version}**. Installing, topology and upgrades are covered in [Helm chart](/docs/deploy-helm/); this page is the lookup table.

The app itself is configured through the free-form \`config:\` value, which the chart renders to a YAML file loaded via \`CHOUSE_CONFIG_PATH\` — so every key on [Environment variables](/docs/configuration-env/) can go there. Secrets belong in \`secrets.*\` or an existing Kubernetes secret, not in \`config:\`.

${sections.join("\n\n")}
`
  );
}

// ---------------------------------------------------------------------------
// AI features and the built-in agents

const AI_FEATURES = Object.values(CAPABILITIES as Record<string, AnyCapability>);

function seedAgent(slug: string): SeedAgent {
  const agent = SEED_AGENTS.find((a) => a.slug === slug);
  if (!agent) throw new Error(`Seed agent ${slug} not found`);
  return agent;
}

function boundSeedAgent(featureId: string): SeedAgent {
  const slug = SEED_BINDINGS[featureId];
  if (!slug) throw new Error(`AI feature ${featureId} has no seed binding`);
  return seedAgent(slug);
}

function harnessName(slug: string): string {
  return SEED_HARNESSES.find((h) => h.slug === slug)?.name ?? slug;
}

function contextList(contexts: readonly string[]): string {
  return contexts.length ? contexts.map((c) => CONTEXT_LABELS[c as keyof typeof CONTEXT_LABELS]).join(", ") : "Evidence only";
}

function tuningText(agent: SeedAgent): string {
  const t = agent.tuning;
  return [
    `${t.stepBudget} steps`,
    t.maxOutputTokens ? `${t.maxOutputTokens.toLocaleString("en-US")} output tokens` : "",
    t.timeoutMs ? `${t.timeoutMs / 1000} s timeout` : "",
    t.recursionLimit ? `recursion limit ${t.recursionLimit}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function skillsText(agent: SeedAgent): string {
  if (!agent.skills.length) return "none";
  const onDemand = agent.skills.filter((s) => s.mode === "progressive").length;
  const pinned = agent.skills.filter((s) => s.mode === "pinned").map((s) => `${code(s.skill)}${s.pinnedFile ? ` (${s.pinnedFile})` : ""}`);
  return [
    onDemand === SEED_SKILLS.length ? "all built-in skills on demand" : onDemand ? `${onDemand} on demand` : "",
    pinned.length ? `pinned ${pinned.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function aiFeaturesPage(): string {
  const featureLink = (f: AnyCapability): string => `[${f.title}](#${slugify(f.title)})`;
  const summary = table(
    ["Feature", "Where", "Needs", "Tools may use", "Built-in agent"],
    SURFACE_ORDER.flatMap((surface) =>
      AI_FEATURES.filter((f) => f.surface === surface).map((f) => [
        featureLink(f),
        SURFACE_LABELS[surface],
        code(f.permission),
        contextList(f.contexts),
        `[${boundSeedAgent(f.id).name}](#${slugify(boundSeedAgent(f.id).name)})`,
      ])
    )
  );

  const details = SURFACE_ORDER.map((surface) => {
    const features = AI_FEATURES.filter((f) => f.surface === surface);
    if (!features.length) return "";
    const blocks = features.map((f) => {
      const agent = boundSeedAgent(f.id);
      const facts = [
        `ID ${code(f.id)}`,
        `needs ${code(f.permission)}`,
        f.delivery === "structured" ? "structured answer (JSON contract)" : "free-form chat answer",
        f.background ? "also runs in the background" : "",
      ].filter(Boolean);
      const variables = Object.entries(f.variables);
      const variableTable = variables.length
        ? table(
            ["Variable", "Type", "Value"],
            variables.map(([name, spec]) => [code(`ctx.${name}`), spec.type, cell(spec.description)])
          )
        : "No template variables — chat agents render without any.";
      return [
        `### ${f.title}`,
        "",
        `${facts.join(" · ")}`,
        "",
        f.description.trim(),
        "",
        `**Tools may use:** ${contextList(f.contexts)}. **Built-in agent:** [${agent.name}](#${slugify(agent.name)}).`,
        "",
        variableTable,
      ].join("\n");
    });
    return `## ${SURFACE_LABELS[surface]} features\n\n${blocks.join("\n\n")}`;
  });

  const boundTo = (slug: string): string[] =>
    Object.entries(SEED_BINDINGS)
      .filter(([, agentSlug]) => agentSlug === slug)
      .map(([featureId]) => AI_FEATURES.find((f) => f.id === featureId))
      .filter((f): f is AnyCapability => Boolean(f))
      .map(featureLink);
  const usedBy = (slug: string): string[] => SEED_AGENTS.filter((a) => a.subagents.includes(slug)).map((a) => `subagent of ${a.name}`);
  const agentBlocks = SEED_AGENTS.map((agent) => {
    const rows: string[][] = [
      ["Slug", code(agent.slug)],
      ["Kind", agent.kind === "router" ? "Router" : agent.taskTemplate === null ? "Chat agent" : "Feature agent"],
      ["Used by", [...boundTo(agent.slug), ...usedBy(agent.slug)].join(", ") || "—"],
      ["Harness", harnessName(agent.harness)],
      ["Tuning", tuningText(agent)],
      ["Tools", agent.tools.length ? agent.tools.map(code).join(", ") : "none"],
      ["Skills", skillsText(agent)],
    ];
    if (agent.subagents.length) rows.push(["Subagents", agent.subagents.map((s) => `[${seedAgent(s).name}](#${slugify(seedAgent(s).name)})`).join(", ")]);
    return `### ${agent.name}\n\n${cell(agent.description)}\n\n${table(["Setting", "Value"], rows)}`;
  });

  return page(
    "packages/server/src/services/ai (feature contracts and seeds)",
    `
Every AI feature in CHouse UI, where it appears, what it needs, the template variables it hands its agent, and the agent it runs on after a fresh install. Rebind a feature or edit its agent in **Agents › Assistant** — see [AI agents](/docs/ai-agents/).

**Needs** is the permission a user must hold to use the feature; the route checks it before any agent runs. **Tools may use** is the run context the feature gives its agent's tools — an agent bound to a feature can only use tools whose context the feature provides:

${table(
  ["Context", "What the tools can do"],
  (Object.keys(CONTEXT_LABELS) as Array<keyof typeof CONTEXT_LABELS>).map((k) => [CONTEXT_LABELS[k], cell(CONTEXT_HINTS[k])])
)}

Features marked *Evidence only* gather their evidence in code and hand it over as \`ctx.evidence\`; their agents work from that and call no tools.

## All features

${summary}

${details.filter(Boolean).join("\n\n")}

## Built-in agents

The ${SEED_AGENTS.length} agents CHouse installs. Steps are the agent's step budget; its recursion limit defaults to four times that, and at least 24. Without a timeout of its own, a run stops after 4 minutes for a feature and 2 minutes in the chat. See [Editing agents](/docs/ai-agent-editor/#settings).

${agentBlocks.join("\n\n")}
`
  );
}

// ---------------------------------------------------------------------------
// AI tools, harnesses and skills

const AI_TOOL_DOMAINS = [
  { id: "clickhouse", label: "ClickHouse tools" },
  { id: "chouse", label: "CHouse tools" },
] as const;

function aiToolsPage(): string {
  const catalog = describeCatalog();
  const users = (name: string): string[] => SEED_AGENTS.filter((a) => a.tools.includes(name)).map((a) => a.name);
  const sections = AI_TOOL_DOMAINS.map(({ id, label }) => {
    const tools = catalog.filter((t) => t.domain === id);
    const rows = tools.map((t) => [
      code(t.name),
      cell(t.title),
      t.requires ? CONTEXT_LABELS[t.requires] : "—",
      t.permissions.length ? t.permissions.map(code).join(", ") : "—",
      cell(t.description.replace(/\s*Read-only; results respect your CHouse permissions\.$/, "").replace(/```(\w+)/g, "`$1`")),
      String(users(t.name).length),
    ]);
    return `## ${label}\n\n${table(["Tool", "Title", "Context", "Needs any of", "What it does", "Built-in agents"], rows)}`;
  });
  const harnessTable = table(
    ["Built-in tool", "What it does", ...SEED_HARNESSES.map((h) => h.name)],
    BUILTIN_TOOLS.map((t) => [
      code(t.name),
      cell(t.description),
      ...SEED_HARNESSES.map((h) => (h.excludedTools.includes(t.name) ? "hidden" : "✓")),
    ])
  );
  const skillsTable = table(
    ["Skill", "Path", "Files", "Use it for"],
    SEED_SKILLS.map((s) => [
      code(s.name),
      code(`/skills/${s.path}/`),
      ["SKILL.md", ...Object.keys(s.files)].map(code).join(", "),
      cell(s.description),
    ])
  );
  return page(
    "packages/server/src/services/ai/registry (catalog, harness) and seeds",
    `
Everything an agent in **Agents › Assistant** is built from that is defined in code: the ${catalog.length} catalog tools, the built-in DeepAgents tools a harness can hide, and the ${SEED_SKILLS.length} skills CHouse ships. How to use them is in [AI agents](/docs/ai-agents/), [Harnesses](/docs/ai-harnesses/) and [Skills](/docs/ai-skills/).

Every catalog tool is read-only; the server rejects an agent that grants anything else. **Context** is what the run must provide — a tool whose context a feature doesn't provide is left out of that feature's runs (see [contexts](/docs/ai-features/)). **Needs any of** applies to the CHouse tools: the chat user must hold one of the permissions or the tool isn't offered, and the API behind it still checks every call as that user. Results of CHouse tools are capped at 100 rows, 2 KB per cell and 60 KB in all, and secrets are redacted.

${sections.join("\n\n")}

## Built-in DeepAgents tools

DeepAgents gives every agent these tools on top of its catalog tools. A harness hides the ones its agents should not see — here is what each built-in harness keeps:

${harnessTable}

Agents run with an in-memory scratch filesystem that is discarded after the run; skills are mounted read-only under \`/skills/\`. Nothing an agent writes reaches disk.

## Built-in skills

${skillsTable}
`
  );
}

// ---------------------------------------------------------------------------
// Screen coverage

/** Keys of a `const NAME … = {` object literal or an array of `{ key: "…" }`. */
function objectKeys(file: string, name: string): string[] {
  const text = readFileSync(join(REPO, file), "utf8");
  const start = text.indexOf(`const ${name}`);
  if (start === -1) throw new Error(`${file}: const ${name} not found`);
  const ends = [text.indexOf("\n};", start), text.indexOf("\n];", start)].filter((i) => i !== -1);
  const body = text.slice(start, Math.min(...ends));
  const keys = [...body.matchAll(/^\s{2}"?([a-z][a-z-]*)"?: \{/gm)].map((m) => m[1]);
  const arrayKeys = [...body.matchAll(/\{ key: "([a-z-]+)"/g)].map((m) => m[1]);
  return keys.length ? keys : arrayKeys;
}

/** Tabbed routes: the route pattern and where its tab keys are defined. */
const TABBED_ROUTES: Record<string, { base: string; file: string; name: string }> = {
  "/monitoring/:tab?": { base: "/monitoring", file: "src/pages/Monitoring.tsx", name: "TAB_CONFIG" },
  "/data/:tab?/:a?/:b?": { base: "/data", file: "src/pages/Data.tsx", name: "TAB_META" },
  "/admin/:tab?": { base: "/admin", file: "src/pages/Admin.tsx", name: "ADMIN_TAB_CONFIG" },
  "/agents/:tab?/:id?": { base: "/agents", file: "src/pages/Agents.tsx", name: "TABS" },
};

/** Routes that are flows, not screens a reader looks for. */
const UNDOCUMENTED_ROUTES = new Set(["/", "*", "/auth/sso/callback", "/login/sso-complete"]);

function appScreens(): string[] {
  const app = readFileSync(join(REPO, "src", "App.tsx"), "utf8");
  const screens = new Set<string>();
  for (const m of app.matchAll(/<Route\s+path="([^"]+)"([\s\S]*?)(?:\/>|<\/Route>)/g)) {
    const [, path, rest] = m;
    if (UNDOCUMENTED_ROUTES.has(path) || /Navigate|Redirect/.test(rest)) continue;
    const tabbed = TABBED_ROUTES[path];
    if (tabbed) {
      for (const key of objectKeys(tabbed.file, tabbed.name)) screens.add(`${tabbed.base}/${key}`);
      continue;
    }
    if (/\/:[A-Za-z]+(?!\?)/.test(path.replace(/\/:[A-Za-z]+\?/g, ""))) continue; // required params: a detail view
    screens.add(path.replace(/\/:[A-Za-z]+\?/g, ""));
  }
  for (const pattern of Object.keys(TABBED_ROUTES)) {
    if (!app.includes(`path="${pattern}"`)) throw new Error(`src/App.tsx no longer has route ${pattern}; update TABBED_ROUTES`);
  }
  return [...screens].sort();
}

function checkScreenCoverage(): string[] {
  const docs = readdirSync(DOCS)
    .filter((f) => f.endsWith(".md"))
    .map((f) => readFileSync(join(DOCS, f), "utf8"))
    .join("\n");
  return appScreens()
    .filter((screen) => !new RegExp(`(?<![\\w/-])${screen.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w/-])`).test(docs))
    .map((screen) => `App screen ${screen} is not documented — give a page \`route: ${screen}\` or mention it`);
}

// ---------------------------------------------------------------------------
// Release notes

/**
 * The `major.minor` the unreleased fragments will release, or null when they
 * are patch-only (a patch release keeps the current announcement).
 */
function upcomingFeatureVersion(): string | null {
  const dir = join(REPO, "changelogs", "unreleased");
  const types = readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => /^type:\s*(major|minor|patch)\s*$/m.exec(readFileSync(join(dir, f), "utf8"))?.[1]);
  const [major, minor] = (JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { version: string }).version
    .split(".")
    .map(Number);
  if (types.includes("major")) return `${major + 1}.0`;
  if (types.includes("minor")) return `${major}.${minor + 1}`;
  return null;
}

function checkReleaseNotes(): string[] {
  const upcoming = upcomingFeatureVersion();
  if (!upcoming || upcoming === RELEASE.version) return [];
  const kind = upcoming.endsWith(".0") ? "major" : "minor";
  return [
    `Unreleased changelog fragments make the next release ${upcoming} (${kind}), but the site still announces ${RELEASE.version} — ` +
      `update src/content/release.ts and src/content/docs/whats-new.md for ${upcoming} (see .rules/RELEASE_NOTES.md)`,
  ];
}

// ---------------------------------------------------------------------------

function main(): void {
  const outputs: Record<string, string> = {
    [join(DOCS, "permissions.md")]: permissionsPage(),
    [join(DOCS, "configuration-env.md")]: envPage(),
    [join(DOCS, "mcp-tools.md")]: mcpToolsPage(),
    [join(DOCS, "cli-reference.md")]: cliPage(),
    [join(DOCS, "helm-values.md")]: helmPage(),
    [join(DOCS, "audit-events.md")]: auditEventsPage(),
    [join(DOCS, "ai-features.md")]: aiFeaturesPage(),
    [join(DOCS, "ai-tools.md")]: aiToolsPage(),
    [join(REFERENCE, "permissions.json")]: `${JSON.stringify(permissionIndex(), null, 2)}\n`,
  };

  const stale: string[] = [];
  for (const [path, content] of Object.entries(outputs)) {
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current === content) continue;
    if (CHECK) stale.push(relative(ROOT, path));
    else {
      writeFileSync(path, content, "utf8");
      console.log(`✎ ${relative(ROOT, path)}`);
    }
  }

  const gaps = [...checkEnvCoverage(), ...checkScreenCoverage(), ...checkReleaseNotes()];
  for (const gap of gaps) console.error(`✗ ${gap}`);
  for (const path of stale) console.error(`✗ ${path} is stale — run \`bun scripts/gen-reference.ts\` in docs/portfolio`);

  if (CHECK && (stale.length || gaps.length)) process.exit(1);
  console.log(
    CHECK ? "✓ reference pages are current and docs coverage is complete" : `✓ reference generated${gaps.length ? ` (${gaps.length} coverage gaps)` : ""}`
  );
}

main();
