type: minor

### Fixed
- **CLI flags work as advertised everywhere** — `--dry-run` previews standalone and fails fast where unsupported (it can no longer silently execute with `--yes`); `-c`/`--connection` is one flag on all commands; `auth login`/`logout` honor `-o`; `--timeout` applies above 60s; confirm prompts go to stderr.
- **CLI table output contract** — nested values render as compact JSON cells; maps with scalar or nested `data` fields keep all columns; `-q` means machine (JSON) mode.

### Removed
- **CLI `--no-color`** — it never controlled anything (output is always plain); passing it now errors like any unknown flag.

### Changed
- **CLI `ai optimize` and `connection use` now need `--yes`** outside a TTY (LLM spend and server-side state change, matching every other mutation).
- **CLI `auth login` prints machine-readable `{profile, server}`** on stdout honoring `-o` (human note stays on stderr).
