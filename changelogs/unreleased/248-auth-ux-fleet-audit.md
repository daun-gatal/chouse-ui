type: minor

### Changed
- **User management** — replaced hard user deletion on the user card with an Activate/Deactivate action; deactivated users keep their data but cannot sign in until an admin reactivates them.
- **Audit log coverage** — added audit entries for fleet alert-config updates, AI doctor scans/schedule changes/report deletions, and query EXPLAIN; migrated live-query kill logging to capture full client context.

### Fixed
- **SSO users** — the "Reset password" action is now hidden for SSO-linked accounts (both on the user card and the edit-user screen), since they have no local password.
- **Inactive login message** — password sign-in by an inactive account now returns a clear "account is inactive, contact an administrator" message (after password verification, to avoid user enumeration); SSO wording aligned.
- **Fleet doctor** — the "analyzing…" progress now reflects the selected investigation window instead of always showing "6h".
