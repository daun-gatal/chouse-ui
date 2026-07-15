type: patch

### Fixed
- **Provider-neutral AI structured output** — Scheduled Queries, Data Health, and other structured AI features now negotiate bounded native, tool-calling, and schema-guided JSON strategies without masking authentication, throttling, or timeout errors. Administrators can optionally override the strategy per model from AI settings.
