# Architecture Decision Records (ADR) Rules

When and how to use Architecture Decision Records in this repository.

An ADR is a short document that captures a significant technical decision — the
context that forced it, the options weighed, and the consequences accepted. It is
the durable "why" a future maintainer (or AI agent) reads instead of
reverse-engineering intent from code. ADRs live in [`docs/adr/`](../docs/adr/);
see that directory's [`README.md`](../docs/adr/README.md) for the template and
conventions.

---

## When an ADR is required

Write an ADR **before** implementation when a change is **big** — it crosses
multiple components or introduces a decision that outlives the PR. Good triggers:

- Security boundaries, authn/authz, or credential handling
- Data flow, deployment topology, or new external interfaces
- Anything touching multiple subsystems (e.g. RBAC + ClickHouse + UI at once)
- A decision with non-obvious trade-offs where a second pair of eyes (human or AI)
  would catch challenges that don't bubble up until late

**Skip the ADR** for patches, minor features, bug fixes, refactors, and anything
small or self-contained. This is a **reasonable process, not a hard gate** —
adopt it where it adds clarity; don't let it hinder velocity.

> Not sure if a change is "big enough"? If you'd want to align on the approach
> before writing code, it's an ADR.

---

## The flow

1. **Draft** — open a PR adding `docs/adr/NNNN-kebab-title.md` with status
   `Proposed`, using the MADR-style template (Context → Decision → Consequences →
   Alternatives considered).
2. **Discuss** — review and comment on the PR; clash approaches and surface
   concerns until the decision settles.
3. **Accept & merge** — flip the status to `Accepted` and merge. The merged ADR is
   now the spec.
4. **Implement** — build it in follow-up PR(s) that reference the ADR. Implementation
   is separate from acceptance: merging the process or the ADR doc does not by
   itself ship the feature.

---

## Conventions

- **Filename:** `NNNN-kebab-title.md`, zero-padded sequential number.
- **Status lifecycle:** `Proposed` → `Accepted` → (`Superseded by NNNN` | `Deprecated`).
- **Never edit an `Accepted` ADR's decision in place** — supersede it with a new ADR
  and flip the old one's status to `Superseded by NNNN`.
- **Keep the index** (the table in `docs/adr/README.md`) up to date when adding an ADR.

---

## Relationship to releases

ADRs do **not** change the release flow. Semantic versioning and changelog
fragments in `changelogs/unreleased/` work exactly as before — an ADR is a
planning artifact, not a user-visible change, so it needs no changelog fragment.
