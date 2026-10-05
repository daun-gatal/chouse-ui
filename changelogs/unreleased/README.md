# Changelog Fragments

When opening a PR, drop a file here named `<pr-number>-<slug>.md`.

## Format

```md
type: minor

### Added
- **Feature name** — description of what was added and why
```

## Rules

- `type` is **required** — use `major`, `minor`, or `patch`
  - `major` — breaking change
  - `minor` — new feature (backwards-compatible)
  - `patch` — bug fix or internal improvement
- Use one or more of: `### Added`, `### Changed`, `### Fixed`, `### Removed`
- Follow the existing CHANGELOG style: bold name, en-dash, description

## `minor` and `major` fragments

Also update the release announcement in the same PR: the "New · X.Y" banner
(`docs/portfolio/src/content/release.ts`) and **What's new in X.Y**
(`docs/portfolio/src/content/docs/whats-new.md`). CI fails when the fragments
would release a newer version than the banner announces. See
[`.rules/RELEASE_NOTES.md`](../../.rules/RELEASE_NOTES.md).

## Example filename

```
changelogs/unreleased/226-sso-oidc.md
```

When this PR merges, the fragment is assembled into `CHANGELOG.md` automatically and a new release is cut. You do not need to edit `CHANGELOG.md` directly.
