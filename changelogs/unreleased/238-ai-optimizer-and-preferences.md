type: minor

### Added
- **Server-backed preferences** — theme and max result row limit now persist to the server (`workspacePreferences.app`) so they survive re-login and roam across devices
- **Custom row limit input** — type any value up to 100,000 directly in Preferences in addition to the quick-pick preset buttons
- **Extended row limit presets** — new options: 25k, 50k, 100k (server-side validation raised to match)

### Changed
- **AI Optimizer auto-enable** — removed the manual `AI_OPTIMIZER_ENABLED` env var; the optimizer now enables automatically whenever an active AI model is configured, matching the AI Chat behaviour

### Fixed
- **AI Optimizer empty query** — clicking "AI Optimize" from the hint strip no longer opens the dialog with an empty query
