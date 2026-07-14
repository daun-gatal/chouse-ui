# 0005 — Unified first-install and product onboarding

**Status:** Accepted

## Context

CHouse UI has a large permission-gated surface: authentication, a movable dock,
Fleet and Doctor, Overview, Explorer and the SQL workspace, seven Monitoring
areas with nested views, two DataOps products, ten Administration sections,
and Preferences. Individual pages provide occasional info dialogs, but there is
no first-install setup, shared progress model, contextual coachmark system, or
durable way for a user to resume guidance on another device.

First-install setup and ordinary product education have different triggers but
must not become separate products. A fresh bootstrap administrator must secure
the seeded account and connect ClickHouse before exploring the application. A
new operator or analyst should only see chapters allowed by current RBAC
permissions and runtime prerequisites. Existing installations must not be
mistaken for fresh installations when they upgrade.

The user-preferences table already provides cross-device JSON storage, but its
current workspace update replaces the whole object. Onboarding writes must not
erase dock, Explorer, Logs, pagination, or appearance preferences. The seeded
user metadata already provides a durable way to distinguish a genuinely fresh
bootstrap account without adding a deployment-wide table or migration.

## Decision

### One product contract and release

Implement one onboarding system with two connected entry experiences:

- a bootstrap checklist for the administrator created during fresh seeding;
- a permission-aware Getting Started hub and contextual chapters for every user.

Both experiences use one registry, progress contract, overlay implementation,
launcher, copy style, and restart/resume behavior. The complete route and nested
feature inventory ships together. Incomplete coverage remains disabled and is
not exposed as successive product versions.

### Fresh-install identity

When seeding a new super administrator, store an onboarding marker in the
existing user metadata. The marker records that bootstrap setup is pending and
whether the built-in default password must be changed. Existing users receive no
marker, so an upgraded deployment is never treated as a fresh installation.

Changing the current user's password clears the password requirement. Bootstrap
completion is accepted only for the marked system administrator after the
password requirement is clear and at least one ClickHouse connection is
available. Password and completion updates compare the metadata they read before
writing, preserving concurrent sibling metadata and preventing a late password
write from reverting completed setup. No password, connection secret, SQL text,
or other sensitive value is stored in onboarding state or logs.

### Per-user progress

Persist a compact onboarding object under
`workspacePreferences.onboarding`. Add a dedicated authenticated GET/PATCH API
whose schema only accepts known bounded fields. Workspace preference updates
merge top-level keys on the server so onboarding cannot overwrite unrelated
preferences. Dedicated progress writes use compare-and-swap retries so
concurrent tabs and devices merge against the latest committed row; chapter
completion is monotonic and wins over a simultaneous dismissal. Progress
contains a format revision, welcome state, completed and dismissed chapter IDs,
the resumable chapter/step, and completion timestamps.

### Central registry and anchors

Create a feature-owned onboarding registry. Every chapter declares:

- stable ID, title, summary, route, and ordered steps;
- required permissions and runtime prerequisites;
- a stable `data-onboarding-id` target when contextual highlighting helps;
- safe behavior when the target or prerequisite is unavailable.

Steps navigate to real routes and use actual controls. They never duplicate
configuration forms or automatically execute destructive, costly, or
production-changing actions. Missing targets fall back to a centered guidance
card instead of blocking progress.

An automated inventory test maps every authenticated route and all registered
nested areas to a chapter or an explicit non-tour classification. Future route
work must update that inventory.

### Authorization and accessibility

Eligibility is derived from the same RBAC store and permission constants used by
navigation and route guards. Hidden or denied features do not contribute to a
user's progress denominator. Newly granted chapters appear without resetting
completed work.

The overlay supports keyboard navigation, focus management, screen readers,
reduced motion, zoom, scroll, resize, responsive layouts, and every dock mode.
Users may exit, skip a chapter, resume, or restart at any time. Dangerous actions
are explained but never performed by the guide.

### Verification

Add service, route, API, registry, state, component, permission, missing-anchor,
and route-inventory tests. Browser-level scenarios cover a fresh administrator,
an upgraded deployment, analyst/operator/view-only personas, no connection,
disabled AI, deep links, cross-device resume, responsive layouts, and keyboard
operation. Existing lint, typecheck, frontend, isolated-server, and migration
suites remain required; migrations are only required if the implementation can
no longer use existing JSON/metadata columns.

## Consequences

Users receive one durable map of the whole product and administrators reach a
secure, connected first-value state without leaving the UI. Centralized content
and inventory checks prevent page-by-page guidance from drifting.

The registry and anchor attributes add maintenance responsibility whenever
routes or major controls change. Server-side preference merging changes an
existing write behavior and therefore requires focused regression tests. Seeded
metadata is intentionally scoped to the bootstrap administrator; deployment
readiness is derived from real configuration instead of duplicated flags.

## Alternatives considered

- **Independent tours embedded in each page.** Rejected because progress,
  permissions, copy, accessibility, and future coverage would drift.
- **One long forced tour across every route.** Rejected because it interrupts
  work, cannot fit every role, and requires fake or destructive interactions.
- **Browser-only local storage.** Rejected because users change devices and
  shared workstations must not leak or merge progress.
- **A new deployment onboarding table.** Rejected because fresh seed metadata
  distinguishes new installations without a migration or new global state.
- **Infer fresh install from zero connections.** Rejected because an upgraded or
  intentionally disconnected deployment could be misclassified.
- **Adopt a third-party tour dependency.** Rejected initially because existing
  Radix, Framer Motion, and React primitives are sufficient and a custom thin
  layer keeps routing, permissions, styling, and accessibility under project
  control.
