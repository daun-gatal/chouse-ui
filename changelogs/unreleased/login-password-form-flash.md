type: patch

### Fixed
- **Login page no longer flashes the password form when password sign-in is disabled** — on refresh the login page optimistically rendered the email/password form and then yanked it away once the auth config loaded and reported password login disabled, leaving a visible flicker before the SSO-only view settled. The sign-in-method area now waits for both the SSO provider list and the auth config to resolve (showing a brief spinner) and renders once, so the correct set of options appears in a single paint. A failed config fetch still falls back to showing the password form, so a config error can't lock everyone out.
