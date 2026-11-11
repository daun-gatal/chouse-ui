type: patch

### Fixed
- **`chouse logs` shows time, status and duration** — the columns read field names the API never returned, so they were empty. The help now explains that you see everyone's queries only with `query:history:view:all`, and that `--user` can only narrow the list.
