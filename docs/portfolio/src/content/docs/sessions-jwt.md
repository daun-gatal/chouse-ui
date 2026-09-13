# Sessions & JWT

CHouse UI issues its own tokens after authentication (password or SSO). Understanding the token model explains session lifetime, multi-instance behavior and recovery.

## Token model

| Token | Lifetime | Purpose |
| --- | --- | --- |
| **Access token** | `JWT_ACCESS_EXPIRY` (default `4h`) | Sent with every API call, verified signature + claims |
| **Refresh token** | `JWT_REFRESH_EXPIRY` (default `7d`) | Silently renews the access token |

Configuration knobs: `JWT_SECRET` (signing), `JWT_ACCESS_EXPIRY`, `JWT_REFRESH_EXPIRY`, optional `JWT_ISSUER` / `JWT_AUDIENCE` claim overrides. Generate secrets with [openssl](/docs/configuration-secrets/).

## Session lifecycle

1. **Login** — credentials or [SSO](/docs/sso/) callback → tokens issued; role + permissions embedded from RBAC
2. **Active use** — access token verified on every request; RBAC checked live against the database (role changes apply immediately)
3. **Renewal** — the client refreshes transparently before expiry
4. **Expiry** — refresh token expiry ends the session; the user re-authenticates

## ClickHouse session recovery

CHouse UI also holds a *ClickHouse* session per connection (server-side). When that session expires mid-work:

- The client catches the failure and attempts to **reconnect automatically** using the stored, encrypted credentials
- Success is surfaced as a "Session recovered" toast; failure asks for a reconnect
- The recovery path re-uses the same RBAC checks — it never bypasses permissions

## Multi-instance notes

- All replicas must share `JWT_SECRET` (and ideally PostgreSQL for the RBAC database)
- SSO/auth config changes propagate replica-to-replica via the shared config-generation counter — see [SSO](/docs/sso/)
- SQLite deployments should stay single-instance; see [Architecture](/docs/architecture/)

## Token hygiene

- Rotate `JWT_SECRET` to invalidate all sessions at once (users just log in again)
- Set short access expiry if your threat model demands it; the refresh flow keeps UX smooth
- PATs are deliberately separate from this model — see [Personal access tokens](/docs/personal-access-tokens/)
