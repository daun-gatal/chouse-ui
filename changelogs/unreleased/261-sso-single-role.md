type: patch

### Fixed
- **SSO role mapping now respects the one-role-per-user model** ([#261](https://github.com/daun-gatal/chouse-ui/issues/261)) — when an IdP claim matched multiple mapped groups, SSO tried to assign several roles at once, which violated the `user_id` unique constraint and made the login fail (leaving the user with no role at all). Role sync now collapses multiple matches to the single highest-privilege role (using the same `ROLE_HIERARCHY` precedence as the rest of RBAC) and writes it via an atomic upsert, so a sync can never strip a user's role mid-update. Affected users self-heal on their next login.
