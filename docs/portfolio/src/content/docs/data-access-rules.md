# Data access rules

Data access rules restrict which databases and tables each user or role may touch. Every query is parsed and validated against the applicable rules before it reaches ClickHouse. Manage them under **Admin → Data access** (requires `data_access:view`; edits need `data_access:update`/`create`/`delete`).

## Rule anatomy

```
Rule: Allow role "analyst" to access "analytics.*"
Rule: Deny  role "viewer"  from "system.*"
Rule: Allow user "john"    to access "sales.orders"
```

Each rule has:

| Field | Notes |
| --- | --- |
| Subject | Role or user |
| Effect | Allow / Deny |
| Database pattern | `*`, exact name, or regex |
| Table pattern | `*`, exact name, or regex |
| Priority | Higher priority rules evaluate first |

## Matching semantics

- **Wildcards**: `*` matches any database or table — `analytics.*` is all tables in `analytics`
- **Patterns**: regex support for complex cases (e.g. `stg_.*`)
- **Deny precedence**: an explicit deny always wins over any allow
- **Priority**: among same-effect rules, higher priority evaluated first
- Rules attach at both role and user level; effective access is the union, minus denies

## Evaluation flow

```
query arrives → SQL parsed (node-sql-parser) → referenced db/table extracted
  → collect rules for the user's roles + user → order by priority
  → deny match? → blocked   → allow match? → forwarded   → no match? → blocked
```

This is enforced in middleware on the server — see [Architecture](/docs/architecture/).

## Working with rules

1. **Admin → Data access** lists rules with subject, effect, patterns and priority.
2. Create/edit in dialogs; patterns are validated before save.
3. Deleting a rule takes effect immediately — the next evaluated query uses the new set.

> **Tip:** Keep a `deny system.*` rule for viewer-type roles if you don't want them reading cluster internals; note that some monitoring tabs legitimately need `system.*` read access — scope monitoring grants with the per-tab permissions instead (`logs:view`, `parts:view`, …) so the two layers stay independent.

## Related pages

- [Permission catalog](/docs/permissions/) — what users may *do*
- [Users & roles](/docs/rbac-roles/) — who holds which role
- [Security model](/docs/security/) — how enforcement composes
