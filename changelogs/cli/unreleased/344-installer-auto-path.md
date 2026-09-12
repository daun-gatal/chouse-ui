type: patch

### Fixed
- **CLI installer PATH setup** — `install-cli.sh` installs to a dedicated `~/.chouse/bin` (predictable on Linux and macOS, never needs root) and appends it to your shell rc file automatically (`~/.bashrc`+`~/.profile`, `~/.zshrc`, or fish `config.fish`; opt out with `CHOUSE_NO_MODIFY_PATH=1`), even when `PATH` is injected by containers/IDEs rather than shell init, falls back to `shasum` on stock macOS, creates an explicit `INSTALL_DIR` when missing, and warns when a stale copy elsewhere on `PATH` shadows the fresh binary.
- **CLI installer `latest` resolution** — scan the 100 newest releases for `cli-v*` tags so frequent app releases can no longer push the CLI off the lookup page.
