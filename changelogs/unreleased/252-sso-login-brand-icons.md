type: minor

### Changed
- **SSO provider brand icons** — enabled SSO providers now show a recognisable brand logo (Google, Microsoft, Okta, GitHub, GitLab, Apple, Slack, AWS, Auth0, …) inferred automatically from the provider, falling back to a generic glyph for unrecognised providers. Icons adapt to light/dark themes and appear on the login page, the admin SSO providers list, and each user's linked SSO identities.
- **Login page SSO** — providers render as compact labelled buttons with their brand icon; when more than three are enabled the extras collapse behind a "Show more" toggle so the password form stays in view.
- **Admin → SSO** — the Single sign-on section now has a proper titled header, and the "Global settings" / "Providers" sub-sections use distinct, meaningful icons.
