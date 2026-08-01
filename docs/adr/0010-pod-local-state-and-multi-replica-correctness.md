# 0010 — Pod-local State and Multi-Replica Correctness

- **Status:** Accepted
- **Date:** 2026-08-01
- **Implementation:** same PR as this ADR (deliberate deviation from the usual
  two-PR flow — the ADR documents a contract that the accompanying fixes are the
  first enforcement of, and the bug it describes is live in released charts)
- **Amends:** [0008](0008-helm-chart-and-oci-distribution.md), whose comparison
  table describes the PostgreSQL/HA topology's web pods as "stateless". They are
  not, and this ADR is the correction.

## Context

[ADR 0008](0008-helm-chart-and-oci-distribution.md) shipped a Helm chart whose
PostgreSQL mode advertises `replicaCount > 1`, an HPA, a PodDisruptionBudget,
and topology spread constraints. Its storage row reads `none (stateless pods)`.

The pods are not stateless. The server has never had a written rule about what
may live in process memory, so each subsystem decided independently. Several
decided correctly, and the reasoning is visible in-tree:

- `fleetPoller` takes an advisory DB lease so exactly one instance polls, with a
  TTL so a dead holder's lease expires
  (`services/fleetPoller.ts`).
- The scheduled-query scheduler claims per-job leases with a crash-only reaper.
- `DbRateLimitStore` exists specifically because "hono-rate-limiter defaults to
  an in-process MemoryStore, which counts hits per-pod. Behind multiple replicas
  that silently multiplies every limit by the replica count"
  (`middleware/rateLimitStore.ts`) — with a *documented, deliberate* exemption
  keeping the high-volume resource guards in memory.
- The SQLite path forces `strategy: Recreate` and fails chart render above one
  replica.

So the hazard was understood. What was missing is a rule that generalises it, and
four subsystems fell through the gap:

| State | Location | Behaviour at N replicas |
|---|---|---|
| ClickHouse connection sessions | `services/clickhouse.ts` | A request routed to a pod that never saw the session ID silently answers from the **default** connection — metadata from the wrong cluster, HTTP 200 |
| Password-login resolution | `rbac/authConfig.ts` | Cached with no TTL, recomputed only on the pod that handled the mutation. An admin disabling password login leaves it **enabled indefinitely** on every other pod |
| SSO provider config | `rbac/sso/config.ts` | Same shape — provider add/remove/disable never reaches other pods |
| SAML handoff codes + assertion replay cache | `rbac/sso/saml/handoff.ts` | ACS lands on pod A, the SPA exchanges the code on pod B → login fails. `markAssertionSeen` is the replay defence, so the same assertion **replays successfully against a different pod** |
| Fleet alert latches | `services/fleetAlerter.ts` | Poller-lease failover starts with empty latches, so every still-breaching condition re-fires — an alert storm after each rollout |

Two of these are security properties, not merely correctness: a disabled password
login that stays enabled on 2 of 3 pods, and SAML replay protection an attacker
sidesteps by reconnecting.

### The compounding factor: silent substitution

Every one of these fails by *substituting something plausible* rather than
erroring. An unknown session yields the default connection and a `200`. A stale
config cache keeps serving its old answer, forever, with no signal that it is
stale.

This is what made the originating bug expensive to diagnose. It presented as
"the Data Health promise editor is flaky — database and table names go missing,
reload a few times and it comes back", because the promise wizard issues five
independent metadata requests and each one independently landed on a pod that
either had the session or silently substituted a different cluster. Nothing in
any log said "wrong connection".

## Decision

### 1. The pod-local state rule

> **A cache may hold state that is *derivable* and *self-healing*. Nothing may
> hold state that is *authoritative* for answering a request.**

- **Derivable** — a cold pod can reconstruct it from the database, ClickHouse, or
  the request itself, without the user redoing anything.
- **Self-healing** — it carries a TTL or an invalidation signal that other pods
  observe, so divergence is bounded and converges without operator action.

Under this rule the AI strategy caches (`services/ai/structuredOutput.ts`,
`services/ai/engine.ts`, `services/ai/dataOpsEvidence.ts`) and the ClickHouse
client pool (`services/clientManager.ts`, keyed by connection config with idle
eviction) are legitimate: every one is reconstructible and bounded.

Security-relevant state — anything enforcing authn, authz, or replay protection —
is authoritative by definition and may never be pod-local, even with a TTL. A TTL
bounds divergence; it does not eliminate the window, and for a replay cache any
window is a bypass.

### 2. Fail closed, never substitute

When request-authoritative state cannot be resolved, the request fails with a
distinct, actionable status. It does not fall back to a different tenant,
connection, or default.

Specifically: an `X-Session-ID`/`X-Connection-Id` that cannot be resolved returns
`409 CONNECTION_CONTEXT_STALE`, which the client handles by re-activating its
stored connection and retrying once. The pre-existing behaviour — quietly serving
the default connection — is removed.

### 3. Connection identity travels with the request

The session map's only real payload was *which connection this browser selected*
— a string. Pooling was never its job; `ClientManager` already pools real
ClickHouse clients keyed by connection config.

So the browser sends `X-Connection-Id` on every request, and the server resolves
it per request against the RBAC database, authorising the user's access to that
connection each time. Pods become interchangeable and `replicaCount` stops
affecting correctness.

The derived facts previously carried on the session (`isAdmin`, `permissions`,
`version` — two ClickHouse round-trips) move into a TTL cache keyed by
`(connectionId, rbacUserId)`. That is legitimate under rule 1: derivable and
self-healing. Authorisation itself is **not** cached — access is re-checked
against the database on every request.

### 4. Shared storage for the rest

- SAML handoff codes and the assertion replay cache move to database tables with
  expiry columns and single-use claim semantics enforced by a conditional
  `DELETE ... RETURNING` / guarded read, so two pods cannot both claim one code.
- SSO and password-login config caches gain a monotonic generation counter in the
  database, bumped on every admin mutation. Pods compare their cached generation
  on a short interval and rebuild when it moves. Divergence is bounded by the
  poll interval instead of being unbounded.
- Fleet alert latches persist, so lease failover resumes the latch state rather
  than re-arming from empty.

## Consequences

**Easier.** `replicaCount > 1` becomes genuinely supported on the PostgreSQL
path, which is what the chart already advertises. Rollouts stop silently
degrading correctness. The five near-identical copies of the hybrid auth
middleware collapse into one shared implementation.

**Harder.** SAML login and config propagation now take database round-trips on
paths that were previously in-memory. These are low-volume (login, admin
mutation, a periodic generation check), so the cost is acceptable — but the SAML
tables need expiry sweeps, which are added alongside.

**Accepted.** Config propagation is eventually consistent, bounded by the
generation-check interval (default 15s), not instant. Instant propagation needs a
message bus, which this project deliberately does not require — the whole HA
design runs on "the existing database, no Redis" (ADR 0008).

**Accepted.** A client that sends neither `X-Connection-Id` nor a resolvable
session still falls back to the user's default connection. Removing that would
break non-browser API consumers holding only a JWT. It is retained *only* for the
no-identifier case, where there is no user intent to contradict, and it is logged.

**Migration.** Browsers holding a pre-upgrade SPA bundle send only
`X-Session-ID`. After upgrade that resolves to nothing and returns `409`; the
served bundle is the new one, so a reload fixes it. This is a visible, one-time,
self-correcting failure — which is the point of rule 2.

## Alternatives considered

**Sticky sessions at the ingress.** Pins a browser to one pod, so the session map
resolves. Rejected as a fix (retained as a documented mitigation): it does not
survive rollouts, eviction, or scale events — precisely the moments multi-replica
exists for — and it is unavailable on ingress controllers with no affinity lever,
which is how this bug was found in the field (a Tailscale-class Ingress silently
ignores `nginx.ingress.kubernetes.io/*` annotations). It also leaves the config
and SAML gaps untouched, including the replay bypass.

**Redis for shared state.** The conventional answer, and rejected for the reason
ADR 0008 already gives: requiring an external cache contradicts the chart's
"external PostgreSQL is the only dependency" contract. Everything here fits in
tables next to the leases and rate-limit counters that already live there.

**Sticky-by-connection routing.** Route by connection id so one pod owns a
connection's clients. Adds a routing dependency for no benefit — `ClientManager`
already pools per pod, and a few duplicate pooled clients across pods is far
cheaper than a topology constraint.

**Leave it and document single-replica.** Honest, and much less work. Rejected
because the chart already ships an HPA and PDB for the PostgreSQL path, so the
advertised topology would remain broken, and because the SAML replay bypass is
independently a defect worth fixing at any replica count.
