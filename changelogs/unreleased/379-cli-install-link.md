type: patch

### Fixed
- **CLI install link** — `curl -sSL https://github.com/daun-gatal/chouse-ui/releases/latest/download/install-cli.sh | bash` returned 404 because `releases/latest` points to the newest app release, which didn't ship the installer. App releases now attach `install-cli.sh` too.
