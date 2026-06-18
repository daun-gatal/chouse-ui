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
| [0001](0001-data-quality.md) | Data Health (scheduled column- and table-level checks) | Accepted |

## Conventions

- Filename: `NNNN-kebab-title.md`, zero-padded sequential number.
- Never edit an `Accepted` ADR's decision in place — supersede it with a new ADR
  and flip the old one's status to `Superseded by NNNN`.
