type: patch

### Fixed
- **Incident notebooks with long titles** — an incident whose title was a whole ClickHouse error no longer fails with "The notebook could not be opened"; the notebook title is shortened instead. The same fix applies to Chobi's "Send to notebook" handoff.
- **Incident titles** — incident titles keep to one short line in the incident list, the incident page, related incidents and dashboard annotations, while alerts, the root-cause chain and the timeline keep the full error. The incident page heading is clamped to three lines, with **Show more** to read the complete text.
