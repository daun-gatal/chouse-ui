type: minor

### Added
- **Clear & rerun (ADR 0007)** — every run in a Scheduled Query's history and a Data Health promise's evaluation timeline gains a per-run **Rerun** action that re-executes exactly that slot over its original window; rerunning a materializing slot automatically re-verifies its linked Data Health promises over the same window. The recovery planner additionally supports range reruns — including already-succeeded slots — and Data Health promises gain a "Rerun range" action. Replays are idempotent: samples are replaced in place, and only the newest slot can change current status, incidents, or notifications — historical slots are corrected silently.
