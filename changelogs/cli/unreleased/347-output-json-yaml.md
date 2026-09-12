type: major

### Removed
- **`table` and `csv` output formats** — the CLI's `--output` contract is now `json|yaml` only. The table renderer was messy for nested values and CSV duplicated what any JSON consumer already handles; both are gone entirely (no deprecation — the CLI is pre-release). Unknown or legacy values (`-o table`, `-o csv`, `CHOUSE_OUTPUT=table`, `output: table` in config.yaml) fail fast with `unknown --output "table" (want json|yaml)` and exit code 2.

### Changed
- **JSON is the default output** — every command now prints machine-parseable JSON with no flags. Pass `-o yaml` for YAML. `-q/--quiet` no longer remaps output (stdout was already machine-format); it only suppresses human diagnostics on stderr.
