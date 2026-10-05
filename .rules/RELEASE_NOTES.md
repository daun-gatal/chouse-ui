# Release Notes Rules

When and how to update what the docs site *announces*. There are two places, and
both describe the **next** feature release, not the last one:

| Place | File | What it is |
|---|---|---|
| Landing page + docs home banner ("New · 3.14") | `docs/portfolio/src/content/release.ts` | `version`, `kind`, a one-line `summary` and 3–5 `highlights` linking to docs pages. Also sets the title of the What's new page |
| What's new page (`/docs/whats-new/`) | `docs/portfolio/src/content/docs/whats-new.md` | Highlights with links, and an **Upgrading from X.Y** table of what an operator must do |

`CHANGELOG.md` remains the complete list and is still never edited by hand. These
pages are the short, readable version for people deciding whether to upgrade.

---

## When to update (same PR as the fragment)

Decide from the `type:` of the changelog fragment you add in `changelogs/unreleased/`:

| Fragment type | What to do |
|---|---|
| `patch` | Nothing. A patch release keeps the current announcement |
| `minor` or `major` — **first** one since the last release | Start the next version. Set `release.ts` `version` to the next `major.minor` (current `package.json` version, minor + 1; for `major`, major + 1 and `.0`) and `kind`. Rewrite `whats-new.md` for that version: replace the previous release's highlights and upgrade table, since the changelog keeps the history. Update its manifest `description` in `docs/portfolio/src/docs-site/manifest.ts` |
| `minor` or `major` — the next version is already announced | Add your feature to `whats-new.md` if a user would want to know about it before upgrading: a highlight paragraph with a docs link, and an **Upgrading** row for anything an operator must do (new permissions for custom roles, removed settings, changed defaults, behaviour that changes on upgrade). If it's one of the release's biggest additions, add it to `release.ts` `highlights` (keep 3–5, most important first) and adjust `summary` |
| `major` while a minor release is announced | Move the announcement to the major version (`X+1.0`, `kind: "major"`) and carry the existing highlights over |

`bun scripts/gen-reference.ts --check` (run in CI by *Check Docs Reference &
Coverage*) fails when the unreleased fragments would produce a version newer than
`release.ts` announces. So the first `minor`/`major` PR of a cycle can't merge
without starting the new announcement. Adding later features to it is a review
item: see the checklist below.

## Writing them

- **Lead with the outcome for the user**, not the implementation. One short paragraph
  per highlight, ending with `→ [Page](/docs/<slug>/)` links. The docs build checks
  every link, including those in `release.ts`.
- **Upgrade rows say what to do**, in the `| What changed | What to do |` table. When
  nothing is required, don't add a row.
- Breaking changes (`major`) always get an upgrade row, at the top of the table.
- Keep `summary` to one sentence that fits on one line on desktop.
- Docs-only, CI, refactor and test changes never touch either file.

## Review checklist

- [ ] A `minor`/`major` fragment that users would notice has a highlight in `whats-new.md`
- [ ] Anything an operator must do on upgrade has a row in **Upgrading from X.Y**
- [ ] `release.ts` `version` matches the version the fragments will release, and its highlights are still the release's biggest additions
- [ ] `bun run build` in `docs/portfolio` passes (links in both files resolve)
