# Architecture Decision Records (ADR)

This directory holds Architecture Decision Records — short documents that capture
a significant technical decision, the context that forced it, the options we
weighed, and the consequences we accept.

## Why

Decisions about security boundaries, data flow, and deployment topology outlive
the PR that introduced them. An ADR is the durable "why" that a future
maintainer (or AI agent) can read instead of reverse-engineering intent from
code.

## Format

We use a lightweight [MADR](https://adr.github.io/madr/)-style template:

- **Status** — `Proposed` → `Accepted` → (`Superseded by NNNN` | `Deprecated`)
- **Context** — the forces at play; what makes this hard
- **Decision** — what we will do
- **Consequences** — what becomes easier/harder; what we accept
- **Alternatives considered** — and why they lost

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [0001](0001-data-quality.md) | Data Health (scheduled column- and table-level checks) | Deprecated |
| [0002](0002-scheduled-queries.md) | Scheduled Queries (a scheduled-execution backbone) | Accepted |
| [0003](0003-data-health-promises.md) | Data Health Promises | Accepted |
| [0004](0004-dataops-ai-operator-assistance.md) | Evidence-grounded DataOps AI operator assistance | Accepted |
| [0005](0005-unified-first-install-onboarding.md) | Unified first-install and product onboarding | Accepted |
| [0006](0006-event-triggered-data-health.md) | Event-triggered Data Health (pipeline-chained promises) | Accepted |
| [0007](0007-clear-and-rerun-for-scheduled-jobs-and-data-health.md) | Clear & Rerun for Scheduled Jobs and Data Health | Accepted |
| [0008](0008-helm-chart-and-oci-distribution.md) | Production Helm Chart and OCI Distribution | Accepted (amended by 0009, 0010) |
| [0009](0009-bundled-evaluation-databases.md) | Bundled Evaluation Databases in the Helm Chart | Accepted |
| [0010](0010-pod-local-state-and-multi-replica-correctness.md) | Pod-local State and Multi-Replica Correctness | Proposed |
| [0011](0011-personal-access-tokens.md) | Personal Access Tokens for CLI and MCP Machine Auth | Proposed |
| [0012](0012-chouse-cli.md) | CHouse CLI: Safe Browserless Operations with Go Binary Distribution | Proposed |

## Conventions

- Filename: `NNNN-kebab-title.md`, zero-padded sequential number.
- Never edit an `Accepted` ADR's decision in place — supersede it with a new ADR
  and flip the old one's status to `Superseded by NNNN`.
