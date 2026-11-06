# content

## Overview

Site content: the release announcement module, the markdown docs pages (`docs/*.md`, one per manifest entry, no source code) and the reference data in [`reference/`](./reference/README.md).

## Interface

- `[release.ts:RELEASE]` - the announced feature release: `version` (`major.minor`), `kind`, one-line `summary`, `highlights` (docs links).
- `[release.ts:Release]`, `[release.ts:ReleaseHighlight]`, `[release.ts:ReleaseKind]` (`"major" | "minor"`).
- `[release.ts:WHATS_NEW_PATH]` - `/docs/whats-new/`.
- `docs/` - markdown source of every `/docs` page, parsed by `src/docs-site/content.ts`.
- reference: [./reference/README.md](./reference/README.md) - server config keys, CLI and permission snapshots for the generated reference pages.

## Invariants

- `RELEASE.version` must not be behind the version the unreleased `minor`/`major` changelog fragments will produce; `gen-reference.ts --check` fails otherwise `[release.ts:RELEASE]`, `[../../scripts/gen-reference.ts:checkReleaseNotes]`.
- Every `highlights[].href` is a docs path that the docs build checks resolves `[release.ts:ReleaseHighlight]`.
- Generated pages in `docs/` (frontmatter `generated:`) are written by `gen-reference.ts` and must not be edited by hand.

## Side Effects

- None. Static content.

## Verification

- Run: `cd docs/portfolio && bun scripts/gen-reference.ts --check && bun run build`
