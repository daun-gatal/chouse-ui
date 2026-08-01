type: minor

### Fixed
- **Wrong ClickHouse cluster served behind multiple replicas** — the selected connection was held in a per-pod in-memory session map, so a request routed to a pod that had never seen the session silently answered from the user's *default* connection with a 200. This showed up as the Data Health promise editor "losing" database and table names until you reloaded a few times. Connection identity now travels with each request (`X-Connection-Id`) and is authorised against the RBAC database on every call, so any replica can serve it.
- **SAML login broken and replay protection ineffective across replicas** — the handoff codes, `InResponseTo` request ids, and the assertion replay cache were per-process Maps. SP-initiated login failed roughly (N-1)/N of the time, and the same assertion could be replayed successfully against a replica that had not seen it. All three now live in shared tables with atomic single-use claims.
- **Auth config changes applied to only one pod** — disabling password login or changing SSO providers rebuilt the cache only on the replica that served the mutation, leaving every other pod serving the old answer indefinitely (there was no TTL). A shared generation counter now propagates changes within seconds.
- **Alert storm after every rollout** — fleet breach latches were in memory, so poller-lease failover re-fired every still-breaching condition. Latches and the auto-RCA cooldown are now persisted.

### Changed
- **Unresolvable connection context now fails closed** — routes return `409 CONNECTION_CONTEXT_STALE` instead of quietly substituting a different connection; the client re-activates and retries once. Browsers holding a pre-upgrade bundle recover on reload.
- **Five near-identical hybrid auth middlewares collapsed into one** shared per-request connection context used by explorer, query, metrics, live-queries, ai-chat and upload.

### Added
- **`service.sessionAffinity` in the Helm chart** (default off). Not required for correctness any more — multi-replica is correct without stickiness — but available for operators who want it.
- **[ADR 0010](../../docs/adr/0010-pod-local-state-and-multi-replica-correctness.md)** defining the pod-local state contract: a cache may hold state that is derivable and self-healing; nothing may hold state that is authoritative for answering a request.
