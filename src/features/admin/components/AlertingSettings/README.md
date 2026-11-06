# AlertingSettings

## Overview

Admin > Alerting page (ADR 0026) with Overview, Channels, Rules and Activity tabs whose view and filters live in the URL; Rules merges fleet rules, dashboard alerts, Data Health, scheduled queries, triage and remediation into one list.

## Interface

- `[index.tsx:AlertingSettings]` - default export; `?view=`-driven tab shell
- `[OverviewTab.tsx:OverviewTab]` - stat tiles, failing-channel banners, source totals
- `[ChannelsTab.tsx:ChannelsTab]` / `healthOf` - channel list with health, test send, edit, delete
- `[RulesTab.tsx:RulesTab]` - unified alert source list; fleet rules edited via `RuleDialog`
- `[ActivityTab.tsx:ActivityTab]` - server-side event search with cursor paging and clear-history
- `[sources.ts:toSourceRows]`, `filterSources`, `SOURCE_KINDS`, `SOURCE_LABELS`, `SourceRow` - pure source-row builders
- `[shared.tsx:useUrlFilters]` - filters/page in URL params; plus `Panel`, `Pager`, `SearchBox`, `FilterSelect`, `clampPage`, `PAGE_SIZE` (20)

## Invariants

- `canEdit` = ALERTING_EDIT, `canDelete` = ALERTING_DELETE passed to tabs `[index.tsx:AlertingSettings]`
- An enabled fleet rule cannot be deleted (disable first) `[RulesTab.tsx:RulesTab]`
- A scheduled job is listed once as its Data Health promise; jobs with no channels are omitted `[sources.ts:toSourceRows]`
- Unknown URL filter values fall back to ''; filter changes reset the page; unknown `?view` falls back to overview `[shared.tsx:useUrlFilters]` `[index.tsx:isView]`
- Sources the viewer cannot fetch are hidden with a permission note `[RulesTab.tsx:RulesTab]`

## Side Effects

- TanStack queries: `getAlertingOverview` (60s refetch), `listChannels`, `listRules`, `getRemediationChannels` (`@/api/alerting`), `listAllAlerts`, `listDataHealthPromises`, `listScheduledQueries`, `getTriageRules` `[OverviewTab.tsx:OverviewTab]` `[RulesTab.tsx:RulesTab]`
- Mutations `deleteChannel`, `testChannel`, `deleteRule`, `saveRemediationChannels`, `clearEvents` invalidating `ALERTING_KEYS.*` `[ChannelsTab.tsx:ChannelsTab]` `[RulesTab.tsx:RulesTab]` `[ActivityTab.tsx:ActivityTab]`
- `useInfiniteQuery(searchEvents)` limit 50 `[ActivityTab.tsx:ActivityTab]`
- URL writes via `setSearchParams` (replace) and a 250ms search debounce `[shared.tsx:useUrlFilters]` `[shared.tsx:SearchBox]`

## Verification

- Run: `bunx vitest run src/features/admin/components/AlertingSettings` (from repo root; full suite: `bunx vitest run`)
