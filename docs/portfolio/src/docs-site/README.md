# Docs site — authoring guide

The `/docs` site is generated at build time from `src/content/docs/*.md` by
`scripts/build-docs.ts`. It is the source of truth for operating CHouse UI, so
every user-visible change should update the page that describes it.

## Adding a page

1. Create `src/content/docs/<slug>.md`.
2. Add `{ slug, title, description }` to the right section and group in
   [`manifest.ts`](manifest.ts). The title and description are the page's H1 and
   lead, its search result and its meta tags. A leading `# Title` in the file is
   ignored.
3. `bun run build` in `docs/portfolio`. The build fails if a manifest page has
   no file, a file has no manifest entry, or any internal link is broken.

Where it goes:

| Section | For |
| --- | --- |
| Start here | First-time readers: what it is, quick start, concepts |
| Install & upgrade | Docker, Helm, production hardening, upgrades, version support |
| Configure | Server settings (YAML/env), secrets, connections |
| Access & security | Users, roles, permissions, SSO, tokens, audit, security model |
| Using CHouse UI | One group per app menu (Home, Explorer, Data, Monitoring, Fleet, Doctor, Agents…) |
| Guides | Task walk-throughs that string several screens together (slugs start with `guide-`) |
| Automation | MCP and the CLI |
| Reference & help | Architecture, troubleshooting, FAQ |

## Generated reference pages

These pages are generated from the code by `scripts/gen-reference.ts`. Never edit
them by hand: their frontmatter says `generated:` and the build hides the edit
link.

| Page | Source |
| --- | --- |
| `permissions.md` | `packages/server/src/rbac/schema/base.ts` and `rbac/services/seed.ts` |
| `configuration-env.md` | `src/content/reference/config-keys.ts` (YAML keys from `.config.example.yaml`) |
| `mcp-tools.md` | the MCP tool registry in `packages/server/src/mcp` |
| `cli-reference.md` | `src/content/reference/cli.json`, a snapshot of the CLI command tree |
| `helm-values.md` | `charts/chouse-ui/README.md` (helm-docs output of `values.yaml`) |
| `audit-events.md` | `AUDIT_ACTIONS` in `packages/server/src/rbac/schema/base.ts` |
| `ai-features.md` | the AI feature contracts (`packages/server/src/services/ai/capabilities`) and the built-in agents and bindings (`services/ai/seeds`) |
| `ai-tools.md` | the AI tool catalog and DeepAgents built-in tools (`services/ai/registry/catalog.ts`, `harness.ts`) and the built-in harnesses and skills (`services/ai/seeds`) |

```bash
# docs/portfolio — needs `bun install` in packages/server too
bun scripts/gen-reference.ts          # regenerate
bun scripts/gen-reference.ts --check  # what CI runs
```

The CLI snapshot is written by the CLI's own test, which fails when the command
tree changes without it: `UPDATE_CLI_REFERENCE=1 go test ./internal/cli -run
TestCommandReference` in `cli/`.

`--check` also enforces coverage:

- every environment variable the server reads is listed in `config-keys.ts`, and
  every live entry there is still read
- every app screen (each route, and each tab of Monitoring, Data, Admin and
  Agents) appears on some page, as `route:` frontmatter or in the text

## Renaming or removing a page

Never break a published URL. Rename the file and the manifest slug, then add
`"old-slug": "new-slug"` to `DOC_REDIRECTS` in `manifest.ts`. The build writes a
redirect stub and rejects any remaining link to the old slug. When a page is
merged into another one, redirect it to that page.

## Page facts (frontmatter)

Pages about a screen in the app start with frontmatter. It renders as the
"In the app / Needs" strip under the lead and is searchable:

```md
---
app: Data › Lineage
route: /data/lineage
permissions: observe:view, data_health:view
clickhouse: 23.8
---
```

| Key | Meaning |
| --- | --- |
| `app` | Menu path as the app labels it, joined with ` › ` |
| `route` | App route (must start with `/`) |
| `permissions` | Permissions that open the screen. Holding any one of them is enough. Each must exist in the permission catalog; badges link to it |
| `clickhouse` | Minimum ClickHouse version, when the feature needs one |
| `screenshot` | A capture name from `public/docs/img/app/` (without `.jpg`), shown under the lead. Regenerate all captures with `./scripts/docs-screenshots.sh` (needs Docker) |

Unknown keys fail the build.

## Links

- Link to other pages with root paths: `[Permissions](/docs/permissions/)`, or
  `[Fixes](/docs/data-incidents/#fixes-with-approval)` for a heading. Heading
  anchors are the heading text, slugified. The build checks every link and
  anchor, in the docs and on the landing page.
- Section hubs live at `/docs/<section-id>/`, with app-menu groups as anchors
  (for example `/docs/using/#data`).

## Tabs

Use tabs for alternatives that say the same thing in different ways (Docker vs
Helm, one snippet per client). The reader's choice is remembered across pages
for the same set of labels.

````md
:::tabs
@tab Docker
```bash
docker compose up -d
```
@tab Helm
```bash
helm install chouse oci://ghcr.io/daun-gatal/charts/chouse-ui
```
:::
````

## Callouts, images and diagrams

- Callouts: start a blockquote with `**Note:**`, `**Tip:**` or `**Warning:**`.
- Images: `![Alt text](/docs/img/<file>.png "Optional caption")`. Images are
  lazy-loaded and framed, and the title becomes the caption. Put files under
  `public/docs/img/`.
- Diagrams: put `{{diagram:<name>}}` on its own line, where `<name>` is
  registered in `render.tsx`.

## Search

`dist/docs/search-index.json` is built from every page, with one entry per
`##`/`###` heading, so results link to the section. Nothing to maintain. Good
headings make good results.
