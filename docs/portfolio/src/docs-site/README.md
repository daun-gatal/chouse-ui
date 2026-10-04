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
| Automation | MCP and the CLI |
| Reference & help | Architecture, troubleshooting, FAQ |

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
| `permissions` | Permissions that open the screen. Holding any one of them is enough |
| `clickhouse` | Minimum ClickHouse version, when the feature needs one |

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
