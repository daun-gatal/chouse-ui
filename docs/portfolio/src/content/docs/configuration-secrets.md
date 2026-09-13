# Secrets generation

Three secrets protect CHouse UI in production. Generate each with openssl before the first boot.

## What to generate

| Secret | Protects | Command |
| --- | --- | --- |
| `JWT_SECRET` | Session tokens (signing/verification) | `openssl rand -base64 32` |
| `RBAC_ENCRYPTION_KEY` | ClickHouse connection passwords at rest (AES-256-GCM) | `openssl rand -hex 32` |
| `RBAC_ENCRYPTION_SALT` | Key derivation for the encryption key | `openssl rand -hex 32` |

```bash
# JWT secret (min 32 bytes)
openssl rand -base64 32

# Encryption key + salt (32-byte hex each)
openssl rand -hex 32
openssl rand -hex 32

# Strong passwords, if you need one
openssl rand -base64 16
```

## Why each one matters

- **`JWT_SECRET`** — every access/refresh token is signed with it. A weak or leaked secret lets anyone forge sessions. Min 32 bytes.
- **`RBAC_ENCRYPTION_KEY`** — ClickHouse connection passwords are stored encrypted in the RBAC database. With the key, ciphertext is unreadable; the plaintext never reaches the browser.
- **`RBAC_ENCRYPTION_SALT`** — salts the key derivation, so identical keys produce different ciphertext stores across installs.

## Rotation caveats

- Rotating `JWT_SECRET` invalidates all sessions (users simply log in again) — safe to rotate anytime.
- Rotating the **encryption key or salt** makes existing stored ClickHouse passwords undecryptable. Connections must be re-entered (or re-saved) after rotation. Plan a maintenance window.
- Store secrets in your secret manager (Kubernetes Secrets, Vault, SSM) — never in the repo. The Helm chart accepts them via `secrets.*` values — see [Helm chart](/docs/deploy-helm/).

> **Warning:** Losing both the encryption key/salt and the stored passwords means losing the connections' credentials. Back up secrets alongside the database — see the [Production checklist](/docs/production-checklist/).
