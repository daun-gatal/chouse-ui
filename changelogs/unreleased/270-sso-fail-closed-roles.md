type: patch

### Fixed
- **SSO no longer silently escalates privileges** (#270) — when an IdP claim resolved to more than one mapped role, the previous behaviour collapsed to the *highest-privilege* match, so a user in multiple groups could land in an unexpectedly powerful role. Role sync now fails closed: an ambiguous claim assigns no role and keeps the user's existing one, logging a warning so the misconfiguration can be fixed. Multi-group role mappings remain supported — only genuine overlap (one user resolving to several roles) is rejected.
