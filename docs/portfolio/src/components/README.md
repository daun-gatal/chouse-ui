# components

## Overview

React sections of the single-page marketing site (landing page), composed in order by `src/App.tsx`. Each section is a default-exported component; `Section.tsx` holds the shared layout primitives.

## Interface

- Sections (default exports): `[Navbar.tsx:Navbar]`, `[Hero.tsx:Hero]`, `[WhatsNew.tsx:WhatsNew]`, `[ClosedLoop.tsx:ClosedLoop]`, `[Features.tsx:Features]`, `[TryLab.tsx:TryLab]`, `[QuickStart.tsx:QuickStart]`, `[Automate.tsx:Automate]`, `[DockerDeploy.tsx:DockerDeploy]`, `[Sso.tsx:Sso]`, `[FAQ.tsx:FAQ]`, `[Changelog.tsx:Changelog]`, `[Footer.tsx:Footer]`.
- `[ReleaseBanner.tsx:ReleaseBanner]` - "New in X.Y" banner driven by `src/content/release.ts` (also shown on the docs home).
- Primitives `[Section.tsx]`: `Section`, `Container`, `Eyebrow`, `SectionHeader`, `PrimaryAction`, `SecondaryAction`, `Card`, `CodeBlock`, `Tag`.

## Invariants

- Changelog and logo URLs use Vite's `BASE_URL` `[Hero.tsx:Hero]`, `[Changelog.tsx:Changelog]`, `[Navbar.tsx:Navbar]`, `[Footer.tsx:Footer]`, and the release links go through `withBase` `[WhatsNew.tsx:WhatsNew]`, `[ReleaseBanner.tsx:ReleaseBanner]`. Other links are root-absolute and ignore the base path: `MCP_REFERENCE_URL`, `CLI_REFERENCE_URL` and the `/docs/mcp-tools/`, `/docs/agents/` buttons in `[Automate.tsx:Automate]`, `/docs/` in `[QuickStart.tsx:QuickStart]`, and the `/` home link in `[Navbar.tsx:Navbar]` — known issue, see [ARCHITECTURE.md › Known issues](../../../../ARCHITECTURE.md#known-issues).
- Internal links and anchors in these files are validated by the docs build (`LANDING_DIR` in `scripts/build-docs.ts`) `[../../scripts/build-docs.ts:checkLinks]`.
- A failed changelog fetch in `Hero` is silent: the version badge simply does not render `[Hero.tsx:Hero]`.

## Side Effects

- `Hero` and `Changelog` fetch `<BASE_URL>CHANGELOG.md` (synced into `public/` by the release workflow) and parse versions from it `[Hero.tsx:Hero]`, `[Changelog.tsx:Changelog]`.
- `Automate` and `Section.CodeBlock` write to the clipboard on copy `[Automate.tsx:Automate]`, `[Section.tsx:CodeBlock]`.

## Verification

- Run: `cd docs/portfolio && bun run build`
