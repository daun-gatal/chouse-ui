# CLI Changelog Fragments

The CLI versions independently from the app (`cli/VERSION`, tags `cli-vX`).
When opening a CLI PR, drop a file here named `<pr-number>-<slug>.md` instead
of `changelogs/unreleased/` — the app release ignores this directory and the
CLI release (`cli-release.yml`) ignores that one.

## Format

```md
type: minor

### Added
- **Feature name** — description of what was added and why
```

## Rules

- `type` is **required** — use `major`, `minor`, or `patch`
  - `major` — breaking change (flags removed/renamed, output contract breaks, exit codes change)
  - `minor` — new command/flag (backwards-compatible)
  - `patch` — bug fix or internal improvement
- Use one or more of: `### Added`, `### Changed`, `### Fixed`, `### Removed`
- Follow the existing CHANGELOG style: bold name, en-dash, description

When a CLI release is cut, the fragments are assembled into the `cli-vX`
GitHub Release notes, `cli/VERSION` is bumped, and the fragments are deleted.
