# First login

After [installing](/docs/quick-start/) CHouse UI, the first sign-in establishes your admin identity and walks you through the essentials.

## Sign in

| Field | Value |
| --- | --- |
| URL | `http://localhost:5521` (or your host) |
| Email | `admin@localhost` |
| Password | `admin123!` |

> **Warning:** These defaults exist only for the seeded first-run account. Rotate the password before exposing the instance to anyone.

## Rotate the default password

1. Open the user menu (bottom dock) → **Preferences**.
2. In **Account**, set a new password (hashed with Argon2id server-side).
3. Save — the next sign-in requires the new password.

If SSO is configured, users [sign in through the identity provider](/docs/sso/) instead; the password field can be disabled entirely.

## First-run tour

On the first authenticated visit CHouse UI starts a guided tour:

- **Getting-started hub** — a checklist of the core setup steps (connect a cluster, run a query, explore monitoring)
- **Contextual coachmarks** — short highlights anchored to the dock, connection selector and editor, dismissible at any time
- Tour state is stored per user, so each teammate sees it once

## Set your preferences

**Preferences** (`/preferences`) stores per-user settings, synced server-side:

- **Theme** — light, dark or auto (light 06:00–18:00 local time, dark otherwise)
- **Max result rows** — the default row cap for query results
- **Personal access tokens** — mint and revoke [`ch_pat_…` tokens](/docs/personal-access-tokens/)

## Add your first connection

CHouse UI never talks to ClickHouse directly from the browser — it connects through the server. Add a connection:

1. **Admin → Connections** → add (requires `connections:edit`).
2. Enter host, port, user and password. Passwords are encrypted with AES-256-GCM and never reach the frontend.
3. Save, then pick the connection from the connection selector.

Details in [Connections](/docs/explorer-connections/). From there, head to the [SQL editor](/docs/workspace-editor/) and run your first query.

## If login fails

- **Wrong credentials** — the seeded admin is only created on first run; check the server log for the `RBAC` seed line.
- **Session expired** — CHouse UI auto-reconnects ClickHouse sessions; a full re-login fixes expired JWTs.
- More in [Troubleshooting](/docs/troubleshooting/).
