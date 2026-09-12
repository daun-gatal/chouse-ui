type: patch

### Fixed
- **CLI `auth login` remembers the server** — `--server` is now saved to your profile (`~/.config/chouse/config.yaml`), so `auth status` and all commands work in fresh shells with no environment set. Env-provided values stay session-scoped and are never written to disk; `--profile` also switches the current profile.
