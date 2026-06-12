type: major

### Added
- **Data Access Policies** — database/table access is now defined as named, reusable policies (one or more pattern rules, scoped to one or more connections or all connections) managed under a new **Admin → Data Access** tab. Policies are attached to roles many-to-many via a new `/rbac/data-access-policies` API and the new `data_access:view/create/update/delete/assign` permissions.
- **Roles carry data access** — the role form now requires at least one data access policy for custom (non-system) roles, making roles the primary access-control mechanism.

### Changed
- **One role per user** — each user now has exactly one role (enforced in the API and by a `UNIQUE(user_id)` index on `rbac_user_roles`). A user's effective data access is the union of the rules in the policies attached to their role; deny rules still take precedence by priority.
- **Migration** — on upgrade, existing role-level and user-level data access rules are converted into policies, the guest system-tables rule becomes the `System Tables (Guest)` policy, and any user with multiple roles or per-user rules is collapsed onto a single (de-duplicated) generated role so no access is lost. `super_admin`/`admin` users keep their privileged role.

### Removed
- **User-level data access rules** — per-user database/table rules and their UI (the data access section in user create/edit) have been removed. Data access is granted through the role's policies only. The `/rbac/data-access/user/*` endpoints, the `bulkSetForUser` client method, and the per-rule `accessType` field are gone (access type is determined by role permissions).

> **Note for operators:** after upgrading, non-admin users see no databases until an admin attaches a data access policy to their role (this matches prior secure-by-default behaviour; existing users' access is preserved by the migration).
