type: patch

### Fixed
- **CLI installer PATH setup** — `install-cli.sh` now appends the install directory to your shell rc file automatically (`~/.bashrc`+`~/.profile`, `~/.zshrc`, or fish `config.fish`; opt out with `CHOUSE_NO_MODIFY_PATH=1`), falls back to `shasum` on stock macOS, and creates an explicit `INSTALL_DIR` when missing.
