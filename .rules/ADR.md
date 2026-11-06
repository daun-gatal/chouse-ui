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

1. **Draft** — write `docs/adr/NNNN-kebab-title.md` with status `Proposed`, using
   the MADR-style template (Context → Decision → Consequences → Alternatives
   considered).
2. **Discuss** — clash approaches and surface concerns until the decision
   settles: in review on a PR, or with the owner in the working session.
3. **Accept** — flip the status to `Accepted` once the owner approves the design.
   The accepted ADR is now the spec.
4. **Implement** — build it against the ADR, in one of two shapes:
   - **Same PR (default).** The accepted ADR and its implementation ship together
     in one PR, as with 0028 (#409) and 0029 (#412). The design is approved
     before any code is written; the PR then carries the spec and the code that
     meets it.
   - **ADR first.** Open an ADR-only PR (`Proposed` → discussed → merged as
     `Accepted`), then implement in follow-up PR(s) that reference it. Use this
     when the decision needs wider review than the owner, or when the
     implementation will span several PRs.

   Either way, if the implementation has to depart from the ADR, update the ADR
   (while still unmerged) or supersede it — never let the merged ADR and the code
   disagree.

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
