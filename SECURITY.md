# Security Policy

## Supported Versions

We provide security updates for the following versions:

| Version | Supported |
| ------- | :-------: |
| 2.x.x   | ✅        |
| < 2.0   | ❌        |

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public issue. Instead, please report it privately:

1. **Preferred**: Open a [private security advisory](https://github.com/daun-gatal/chouse-ui/security/advisories/new) on GitHub
2. **Alternative**: Email the maintainers directly (if contact information is available)

### What to Include

Please provide the following information in your report:

- Description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Potential impact
- Suggested fix (if available)

### Response Timeline

- **Acknowledgment**: We will acknowledge receipt within 7 business days
- **Initial Assessment**: We will provide an initial assessment within 14 business days
- **Resolution**: We aim to provide a fix or mitigation based on severity:
  - Critical: As soon as possible (typically within 2-4 weeks)
  - High: Within 60 days
  - Medium/Low: Within 120 days

### Disclosure

We follow coordinated disclosure practices. Security advisories will be published on GitHub when fixes are available. We will credit reporters (unless they prefer to remain anonymous).

### Safe Harbor

We consider security research and vulnerability disclosure activities conducted in accordance with this policy to be "authorized" conduct. We will not pursue legal action against security researchers who act in good faith and follow this policy.

## Security Best Practices

When using CHouse UI in production:

- Change default admin credentials immediately
- Use strong, unique secrets for `JWT_SECRET` and `RBAC_ENCRYPTION_KEY`
- Configure proper CORS settings
- Use HTTPS via reverse proxy
- Keep dependencies up to date
- Follow the security checklist in the [README.md](README.md)

## Scope

### In Scope

We are interested in security vulnerabilities related to:

- Authentication and authorization bypasses
- SQL injection or query manipulation
- Data exposure or leakage
- Cross-site scripting (XSS)
- Cross-site request forgery (CSRF)
- Server-side request forgery (SSRF)
- Remote code execution
- Privilege escalation
- Cryptographic weaknesses
- Sensitive data exposure

### Out of Scope

The following are **not** considered security issues:

- UI/UX bugs and spelling mistakes
- Denial of service (DoS) attacks
- Issues requiring physical access
- Issues in third-party dependencies (report to the dependency maintainer)
- Social engineering attacks
- Missing security headers without demonstrated impact

## Security Features

CHouse UI includes several security features:

- Encrypted credential storage (AES-256-GCM)
- Password hashing (Argon2id)
- JWT-based authentication
- Role-based access control (RBAC)
- Query validation and access rules
- Audit logging

For more details, see the [Security Best Practices](README.md#security-best-practices) section in the README.
