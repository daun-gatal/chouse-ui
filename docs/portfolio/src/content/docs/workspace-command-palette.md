# Command palette & shortcuts

`Cmd/Ctrl+K` opens the global quick switcher — every jumpable surface in CHouse UI behind one keystroke. RBAC-gated: the palette only offers what the current user can access.

## What the palette reaches

| Category | Contents |
| --- | --- |
| Pages | Overview, fleet, monitoring tabs, explorer, DataOps, admin, preferences |
| Databases & tables | Jump straight into the [explorer](/docs/explorer-databases/) for any accessible table |
| Saved queries | Open or run any [saved query](/docs/workspace-saved-queries/) you can view |
| Recent queries | Re-open recent executions from [history](/docs/workspace-saved-queries/) |
| Actions | Connection switch, theme toggle, run EXPLAIN, and other context actions |
| Help | Documentation entry points and [getting-started](/docs/overview/) links |

## Keyboard-first workflow

1. `Cmd/Ctrl+K` → type a fragment (`stg_`, `orders`, `fleet`)
2. Enter to jump — the palette remembers recents
3. Escape closes without side effects

Because entries are permission-gated, the palette doubles as a discoverability layer: users see exactly what their role allows — nothing more.

## Core shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+K` | Command palette |
| Editor | Monaco-native keys (multi-cursor, find, format) apply inside the editor |
| Dock | Dock mode (floating/sidebar) is switchable; layout adapts per component via container queries |

> **Tip:** If the palette hides an entry you expect, check the [permission catalog](/docs/permissions/) — the palette mirrors RBAC exactly, which makes it a quick permission sanity check too.
