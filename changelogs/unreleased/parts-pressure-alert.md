type: minor

### Added
- **Predictive "too many parts" alert** — a new fleet alert rule fires when a table is projected to hit its `parts_to_throw_insert` limit within a configurable number of minutes, turning the parts-pressure trend into an early warning before inserts start failing. Configurable in the fleet alert delivery dialog (server-side, delivered to Slack/Google Chat/email) and the in-app alerts bell, and surfaced as a "Parts limit ETA" tile on each fleet card.
