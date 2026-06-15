type: minor

### Added
- **DDL impact simulator** — a read-only "what would this `ALTER` cost" estimator in the Cluster tab. Paste an `ALTER … UPDATE/DELETE` and it estimates rows matched, parts and bytes rewritten, projected duration (from mutation/merge history), and whether free disk can hold the transient rewrite — without executing anything.

### Changed
- **Mutation progress** — the Cluster → Mutations view now shows an approximate progress bar (parts done / total) and a Killed status, alongside the existing parts-remaining and failure-reason columns.
