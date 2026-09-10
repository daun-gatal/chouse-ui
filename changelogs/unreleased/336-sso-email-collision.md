type: patch

### Fixed
- **SSO email auto-link** — GitHub logins using a verified `/user/emails` address now auto-link to the existing account when `auto_link_by_email` is enabled (previously failed with a duplicate-email error); email collisions without verification proof now return `409 Conflict` with an actionable message instead of a raw database error
