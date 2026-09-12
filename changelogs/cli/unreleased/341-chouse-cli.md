type: minor

### Added
- **chouse CLI (`chouse`)** — new command-line companion for CHouse UI: safe browserless operations as an independently versioned Go binary (`cli-vX` releases cut only on `cli/` changes, `curl | bash` installer to `~/.chouse/bin` with automatic shell PATH wiring).
  - **Machine-first output** — every command prints JSON by default (`-o yaml` for YAML, `--output json|yaml` only); `table`/`csv` formats do not exist, and unknown values fail fast with a usage error (exit 2). `-q/--quiet` suppresses human diagnostics on stderr so stdout pipes cleanly.
  - **Operator-complete commands** — query, explorer, metrics/logs, live, fleet/doctor, scheduled, data health, alerting, AI optimize, upload preview, audit. Break-glass admin stays UI-only.
  - **Safe-by-default** — reads never prompt; mutations need TTY confirm or `--yes`, destructive actions support `--dry-run` previews; exit codes `0/2/3/4/5/6`; every mutation prints `action/target/permission`.
  - **PAT-only auth** — `CH_HOUSE_PAT` or `chouse auth login` (`--server` is remembered per profile in `~/.config/chouse/config.yaml`, tokens stay in 0600 `credentials.yaml`); no silent `localhost` server default — missing config fails fast with setup guidance.
  - **81+ guided commands** — every command carries a Long description and runnable examples; a completeness test fails the build if any future command ships without them.
- **`chouse version`** — offline install-verification command (instant, never contacts a server).

See `docs/cli.md` and ADR 0012 for the full contract.
