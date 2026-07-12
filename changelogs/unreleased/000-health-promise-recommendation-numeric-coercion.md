type: patch

### Fixed
- **Data Health promise recommendations failing on numeric fields returned as strings** — `breachAfter`, `recoverAfter`, and `graceSecs` in the `recommend-health-promise` AI output schema now coerce numeric strings (e.g. `"0"`) to numbers instead of failing Zod validation, which previously surfaced as a generic "Chouse AI could not complete 'recommend-health-promise'" error.
