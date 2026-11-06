# components/common/PageShell

## Overview
Page chrome shared by the top-level pages: a page header with eyebrow, title, navigation and actions, pill-style navigation buttons, and a sub-tab strip.

## Interface
- `PageHeader` / `PageHeaderProps` - `icon`, `eyebrow`, `title`, `navLabel`, `nav`, `actions`, `layout` (default `"spread"`) [PageShell.tsx:PageHeader]
- `NavPill` / `NavPillProps` - `icon`, `label`, `isActive`, `onClick`, `onboardingId`, `disabled`, `noShrink`, `liveBadge`, `count` [PageShell.tsx:NavPill]
- `SubTabs<K>` / `SubTabsProps<K>` - typed tab keys with `tabs`, `active`, `onChange`, `label`, `onboardingPrefix`, `trailing` [PageShell.tsx:SubTabs]
- Barrel: `index.ts` re-exports the three components and their prop types [index.ts:PageHeader]

## Invariants
- `onboardingId` / `onboardingPrefix` attach the IDs the onboarding tour targets; keep them stable when renaming tabs [PageShell.tsx:NavPill], [PageShell.tsx:SubTabs].

## Side Effects
- None. Presentational components; navigation is done by caller callbacks.

## Verification
- No co-located tests; covered by `bun run typecheck`
- Nearest tested scope: `bunx vitest run src/components/common`
