type: major

### Added
- **chouse CLI** — safe browserless operations for CHouse UI as independently versioned Go binaries (`cli-vX` releases cut only on `cli/` changes, `curl | bash` installer). PAT-only auth (`CH_HOUSE_PAT`), operator-complete commands (query, explorer, metrics/logs, live, fleet/doctor, scheduled, data health, alerting, AI optimize, upload preview, audit), safe-by-default guards (`--yes` + `--dry-run`, exit codes `0/2/3/4/5/6`). Break-glass admin stays UI-only. See `docs/cli.md` and ADR 0012.
- **CLI `--help` guidance everywhere** — all 83 commands carry a Long description plus runnable real-world examples (`system.numbers` queries, proven flag combos, fake ids that 404 instead of destroying). A completeness test fails the build if any future command ships without them.

### Changed
- **Machine-parseable output by default** — every command prints JSON with no flags (`--output json|yaml`, JSON is the only default). Unknown or legacy formats (`table`, `csv`) fail fast with `unknown --output "table" (want json|yaml)` and exit code 2. `-q/--quiet` suppresses human diagnostics on stderr so stdout pipes cleanly.
- **CLI `auth login` prints machine-readable `{profile, server}`** on stdout honoring `-o` (human note stays on stderr).
- **CLI `ai optimize` and `connection use` now need `--yes`** outside a TTY (LLM spend and server-side state change, matching every other mutation).

### Fixed
- **CLI explicit server config** — no silent `http://localhost:5521` default; commands needing a server fail fast with setup guidance (`--server`, `CHOUSE_SERVER`, or `chouse auth login --server …`), mirroring the missing-PAT error.
- **CLI `version` is offline** — prints the binary version instantly without contacting any server; use `chouse status` for server version and migrations.
- **CLI installer PATH setup** — `install-cli.sh` installs to a dedicated `~/.chouse/bin` (predictable on Linux and macOS, never needs root) and appends it to your shell rc file automatically (`~/.bashrc`+`~/.profile`, `~/.zshrc`, or fish `config.fish`; opt out with `CHOUSE_NO_MODIFY_PATH=1`), even when `PATH` is injected by containers/IDEs rather than shell init, falls back to `shasum` on stock macOS, creates an explicit `INSTALL_DIR` when missing, and warns when a stale copy elsewhere on `PATH` shadows the fresh binary.
- **CLI installer `latest` resolution** — scan the 100 newest releases for `cli-v*` tags so frequent app releases can no longer push the CLI off the lookup page.
- **CLI `auth login` remembers the server** — `--server` is now saved to your profile (`~/.config/chouse/config.yaml`), so `auth status` and all commands work in fresh shells with no environment set. Env-provided values stay session-scoped and are never written to disk; `--profile` also switches the current profile.
- **CLI flags work as advertised everywhere** — `--dry-run` previews standalone and fails fast where unsupported (it can no longer silently execute with `--yes`); `-c`/`--connection` is one flag on all commands; `auth login`/`logout` honor `-o`; `--timeout` applies above 60s; confirm prompts go to stderr.
