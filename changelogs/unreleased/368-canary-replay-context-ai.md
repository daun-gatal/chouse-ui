type: minor

### Added
- **Data › Context: Draft with Chouse AI** — fills the empty curated fields (description, grain, owner, use-instead-of, tags, deprecated) and suggests canonical metrics for one table. The model gets no tools: the server profiles only that table, read-only and capped, with summary numbers and never raw rows, and personal-looking columns get no values. Every suggestion is validated, and nothing is saved until a person clicks Save. Requires `context:edit` and `ai:optimize`; audited as `context.ai_draft`.

### Fixed
- **Workload replay on a canary** — queries whose tables were dropped from the baseline are now **skipped** instead of counted as canary errors; tables missing only on the canary show as **Missing on canary** instead of errors; the replayed query text is shown without the client's `FORMAT` clause; and the most serious differences are listed first. The panel also says that the active connection is the baseline.
- **Agents › Pause all agent access** — the button and the paused banner use the yellow/amber accent instead of alarm red.
