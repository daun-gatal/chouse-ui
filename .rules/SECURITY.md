# Security Rules

The security baseline for CHouse UI: every change keeps these properties, and
every review checks them. It covers the app (`src/`), the server
(`packages/server/`), the docs site, the CLI (`cli/`), the Docker image, the
Helm chart and CI. Coding standards live in [CODE_CHANGES.md](CODE_CHANGES.md);
the general review checklist in [CODE_REVIEWER.md](CODE_REVIEWER.md) links here.
How to *report* a vulnerability, and the accepted-risk list, live in the root
[SECURITY.md](../SECURITY.md).

CHouse UI sits between users and ClickHouse clusters that often hold an
organization's most sensitive data, and it usually connects to ClickHouse with a
**shared, highly privileged ClickHouse user**. That makes CHouse UI's own RBAC
and data access rules the *only* boundary between a restricted user and
everything that ClickHouse user can read. Treat every rule below as protecting
that boundary.

---

## 1. Threat model

Assume an **authenticated but restricted user** (custom role, data access policy
limited to some databases) is the attacker, and that they can send any request
the API accepts — not just what the UI sends. Also assume an **unauthenticated
internet client** can reach every public endpoint, and that **any website** the
user visits can make requests to CHouse UI from their browser. Agents (MCP /
PAT clients and the built-in AI SRE) are users too: their SQL and tool arguments
are model-generated and can be steered by a prompt. An **admin who is not a
super admin** is an attacker too: everything `admin` holds must not add up to
`super_admin` power or a way around data access rules.

Before writing code, ask: what is the worst a restricted user could do with
this endpoint, parameter or SQL shape?

---

## 2. Authorization

- Every server route is behind `rbacAuthMiddleware` + `requirePermission` (or
  `requireAnyPermission`), applied server-side.
- **Check the object, not just the action.** A permission says what kind of
  action is allowed; you still have to check *which* object. Scope per-user
  objects to their owner or share (saved queries filter on `userId` /
  `isPublic`; dashboards on role shares). Never load by an id from the request
  and act on it without that scope.
- **Connections:** resolve them through `connectionContextMiddleware` /
  `resolveRequestedConnection`, which re-checks the user's access on every
  request.
- **No privilege escalation.** Anyone who isn't a super admin may only:
  - assign roles whose permissions they already hold, never `super_admin`
    (`assertCanGrantRoles` in `rbac/routes/users.ts`);
  - put permissions they already hold into a role
    (`assertCanGrantPermissions` in `rbac/routes/roles.ts`).

  They also can't modify a super admin or a system role. Any new route that
  grants roles, permissions, data access policies, PAT scopes or ClickHouse
  grants needs the same rule, plus a test that an `admin` can't use it to
  become `super_admin`.
- **Fail closed:** an unknown role, permission, connection or policy means
  deny.

## 3. Data access rules and SQL

Data access rules are enforced by parsing SQL (`middleware/sqlParser.ts`) and
checking every table it finds (`middleware/dataAccess.ts` →
`validateQueryAccess`). A table the parser misses is a table the rules never
see.

- **Every table a statement reads or writes must be checked** — including
  scalar subqueries, `IN`/`EXISTS` subqueries, `UNION` arms, CTE bodies,
  `INSERT … SELECT` and `CREATE … AS SELECT` sources, joins, and
  `dictGet`/`joinGet` lookups. When you extend the parser, walk the whole AST;
  never read a fixed list of keys.
- **Fail closed.** If a statement can't be parsed, its type is unknown, or the
  splitter and parser disagree on statement boundaries, deny it.
  "No tables found → allow" is only safe because the walk is complete.
- **Identity of a table is `database + table`.** Never deduplicate, cache or
  compare on the table name alone. A db-qualified name is never a CTE.
- **Table functions and engines reach outside the rules.** `remote`, `cluster`,
  `merge`, `url`, `file`, `s3`, `mysql`, `Distributed`, `Merge`, `URL`, … read
  data the per-table check never sees. Non-admins get only the inline-data
  table functions in `SAFE_TABLE_FUNCTIONS` and the local-storage engines in
  `utils/sqlIdentifier.ts`. Add to those lists only for things that cannot read
  another table, file, URL or server.
- **Every route that runs SQL goes through `validateQueryAccess`**, or — for
  server-built DDL like the explorer's create/drop buttons — through
  `checkDatabaseAccess` / `checkTableAccess`. A button must never be able to do
  what the same statement typed into the SQL editor would be denied. That
  covers notebooks, dashboards, scheduled queries, exports, AI tools and MCP.
- **Background work runs as its owner.** Scheduled queries, reports, alerts and
  agent runs re-check the owner's *current* permissions and data access when
  they run, so revoking a user stops their schedules.
- Add a regression test in `dataAccess.test.ts` for every new statement shape,
  phrased as "a user limited to `public` cannot read `secret.t` via …".

## 4. Building SQL on the server

- **Identifiers**: `escapeIdentifier` / `escapeQualifiedIdentifier` from
  `utils/sqlIdentifier.ts` (validated names), or `quoteIdent` from
  `rbac/services/clickhousePrivileges.ts` for free-form ClickHouse
  user/role/grant names.
- **String literals**: `quoteStringLiteral` (or `escapeLiteral` inside the
  ClickHouse user/role builders). ClickHouse treats `\` as an escape character
  inside both `'…'` and `` `…` ``, so doubling the quote alone is **not**
  escaping. Never write a fresh `.replace(/'/g, "''")`; use the helpers.
- **Every value from a request is untrusted**, including ids
  (`query_id`, connection ids, usernames). Quote them even when they "should"
  be UUIDs.
- **Anything else interpolated into SQL** (column types, engines, ORDER BY /
  PARTITION BY / PRIMARY KEY, settings) must be validated as a *whole string*
  against a strict grammar (`validateColumnType`, `validateTableEngine`,
  `isSafeKeyExpression`). Checking a prefix, or rejecting a few "dangerous
  characters", leaves room to close the clause and append more SQL.
- Prefer ClickHouse query parameters (`{name:Type}`) for values over string
  building whenever the client supports it.

## 5. Authentication, sessions and rate limits

- **Passwords:** Argon2id via `Bun.password`, checked with
  `validatePasswordStrength`. Never log, return or store them in plaintext.
  Seeding with the default `admin123!` sets `requiresPasswordChange`;
  production deployments set `RBAC_ADMIN_PASSWORD`.
- **JWTs:** `jose`, HS256 with a 32+ character `JWT_SECRET`, always verified
  with issuer and audience. Never read claims from a token whose signature
  hasn't been verified.
- **Sessions:** refresh tokens are bound to a server-side session row and are
  revocable. Logout, password change, deactivation and deletion revoke them.
- **Personal access tokens:** stored only as a SHA-256 hash, shown once, with
  optional expiry and a scope subset; a revoked token fails at once. A PAT
  never carries more than its owner currently holds.
- Compare secrets, signatures and token hashes with `timingSafeEqual`.
- Keep tokens out of URLs; query strings end up in logs and `Referer`. Use
  headers, or a one-time handoff code as the SSO complete flow does.
- **Never key a security limit on a header the client controls.** The client
  writes all of `X-Forwarded-For` unless a proxy appends to it; use
  `rateLimitClientKey` (rightmost hop) and pair IP limits with a per-account
  limit (`loginAccountKey`) on anything that checks a credential.
- Public endpoints (`publicPaths` in `routes/index.ts`, CORS `bypassPaths`)
  must authenticate the request some other way — a signature (Slack), a signed
  one-time state cookie (SSO), or XML-DSig (SAML). Adding a path to either list
  needs a comment saying what protects it.

## 6. Browser-facing controls

- **CORS**: a wildcard origin must never be combined with
  `Access-Control-Allow-Credentials`. Match `*.example.com` on the parsed
  hostname, not with a string suffix.
- **Redirects** after login: same-app relative paths only. Reject `//`, `/\`,
  and control characters (URL parsing drops tabs/newlines, turning `/\t/x` into
  `//x`). Server (`safeRedirect`) and client (`safeClientRedirect`) both check.
- **HTML**: never `dangerouslySetInnerHTML` without DOMPurify and an explicit
  tag/attribute allowlist. Don't enable raw HTML in `react-markdown`. Any link
  or image URL built from data must be `http(s)` or same-app relative.
- **CSRF:** `/api` routes outside `publicPaths` require
  `X-Requested-With: XMLHttpRequest`, or a PAT bearer token (`routes/index.ts`).
  Keep that check in front of every new state-changing route. Don't make
  cookies carry authority on their own.
- **Security headers:** non-API responses carry the CSP, `X-Frame-Options`,
  `frame-ancestors`, `nosniff` and `Referrer-Policy` set in `index.ts`. Don't
  loosen the CSP (new `script-src` / `connect-src` origins, `unsafe-eval` in
  production) without a reviewer agreeing.
- **Client-side tokens** live in `localStorage`, so any XSS is a session
  takeover. That is why the HTML and URL rules above are strict, and why no
  third-party scripts are loaded at runtime.

## 7. Outbound requests (SSRF)

Webhooks, alert channels, AI provider base URLs, ClickHouse connection hosts and
SSO issuers are all URLs the server will fetch.

- Only users with the matching *manage/edit* permission may set them.
- Pin callback URLs to their expected host where one exists (e.g. Slack
  `response_url` must start with `https://hooks.slack.com/`).
- Never return a fetched response body to the user verbatim — return status and
  a short, sanitized error.
- Always set a timeout (`AbortSignal.timeout`).

## 8. Secrets, cryptography, logging and audit

- Connection passwords and channel secrets are encrypted at rest (AES-256-GCM);
  decrypt only at the point of use and never return them from an API. Edit
  forms show "set / not set", never the value.
- Production must fail to start without `JWT_SECRET`, `RBAC_ENCRYPTION_KEY` and
  `RBAC_ENCRYPTION_SALT` (`validateEnvironmentVariables`). Don't add a silent
  default for a new secret, and never put one in `ENV` in the Dockerfile.
- **Randomness:** tokens, ids, state and nonces come from `crypto`
  (`randomUUID`, `getRandomValues`, `randomBytes`), never `Math.random`. Use
  the built-in primitives; don't invent crypto.
- **Logging:** never log passwords, tokens, API keys, full SQL results or PII.
  Log ids. Debug logs that dump SSO claims stay behind `LOG_LEVEL=debug`.
- **Errors:** return `AppError` codes and short messages. Stack traces and
  internal details are for non-production only (`middleware/error.ts`).
  ClickHouse error text may be shown, since the user wrote the query.
- **Audit trail:** security-relevant actions (login success/failure, role,
  permission, policy and user changes, PAT create/revoke, SSO link/JIT,
  connection changes, DDL) write an audit log entry with actor, target and
  outcome. Changing who can do what without an audit entry is a defect.

## 9. AI and agent surfaces

- AI tools run SQL **as the requesting user** through the same validation as
  the editor. A tool must never use a privileged path the user lacks.
- Treat model output and tool arguments as untrusted input: validate with Zod,
  apply the same data access checks, and keep destructive actions behind human
  approval.
- Content the model reads (query results, table comments, docs) can carry
  instructions; it must not be able to widen what the agent is allowed to do.
- AI provider keys are secrets (section 8). Don't log full prompts or model
  responses: they can contain query results.
- **MCP (`/mcp`):** off until an administrator turns it on in AI Governance ›
  MCP. PAT-only auth, an Origin allowlist checked by `mcp/origin.ts` (the MCP
  spec requires it), and per-tool permission checks. A new MCP tool goes
  through the same server routes and validation as the UI, never a shortcut
  into a service.

## 10. SSO (OIDC and SAML)

- **OIDC:** authorization code flow with PKCE. Keep `state` in a signed,
  short-lived, browser-bound cookie and check the `nonce`; `openid-client`
  validates issuer and audience. HTTPS issuers only.
- **SAML:** verify the XML signature over the assertion, plus audience,
  recipient, validity window and `InResponseTo` (the RelayState cookie), and
  reject replays. Parse XML only with the `@xmldom/xmldom` version pinned in
  `overrides`.
- **Account linking and JIT provisioning:** auto-link to an existing account
  only on a verified email from a trusted provider. Role mapping never yields
  `super_admin` unless an administrator mapped it explicitly. Every link and JIT
  creation writes an audit entry.
- Client secrets and signing keys are secrets (section 8). The SSO test
  endpoint never echoes them back.

## 11. Resource limits, uploads and parsing

- **Request bodies** are capped at 10 MB by `bodyLimit` in `index.ts`, which
  counts bytes actually read, so chunked requests are capped too. A route that
  needs more sets its own explicit limit; never remove the global one.
- **Queries:** keep the per-user query and AI rate limits, the
  `max_result_rows` / `result_overflow_mode` caps in `services/clickhouse.ts`,
  and row caps on samples and previews (`getTableSample` caps at 1000). New
  endpoints that return data need a cap.
- **Uploads** (`routes/upload.ts`): both routes require a signed-in user. An
  import is an INSERT, so it needs `table:insert` and a `write` data-access
  check on the target table. Only the formats the import wizard streams are
  accepted (`UPLOAD_FORMATS`). Never write uploaded files to disk paths built
  from user input.
- **Parsing untrusted input:** validate request bodies with Zod (`.strict()`
  where extra keys could change behaviour). Parse YAML with the `yaml` package
  defaults and JSON with `JSON.parse`; never `eval`, `new Function` or
  dynamic `import()` on data. Don't merge untrusted objects into config
  (prototype pollution).
- **Regexes on user input** must not backtrack catastrophically. Prefer
  anchored, linear patterns, and cap input length first.

## 12. ClickHouse user and role management

The Admin › ClickHouse users/roles screens run `CREATE USER`, `GRANT` and
`REVOKE` as the connection's ClickHouse user, which is usually very
privileged.

- Gate every route on its `clickhouse:users:*` / `clickhouse:roles:*`
  permission. These are admin-level powers; don't give them to default roles.
- Build statements only with the helpers in `clickhousePrivileges.ts`
  (`quoteIdent`, `escapeLiteral`, `assertValidPrivilege`, `formatGrantTarget`).
  Privilege names come from the allowlist, never from free text.
- Passwords set here are secrets: never logged, returned or kept in the audit
  log. Audit entries record the username and the grants, not the password.

## 13. CLI

- Tokens come from `CH_HOUSE_PAT` or `~/.config/chouse/credentials.yaml`,
  written `0600` (`cli/internal/config`). Never print a token, and never accept
  one as a plain flag value that ends up in shell history.
- TLS verification is on by default. Internal CAs go through `--ca-cert`.
  `--insecure-skip-tls-verify` is break-glass only, always warns, and is never
  the default or saved implicitly.
- Build with a supported Go release (`go-version` in `cli.yml` /
  `cli-release.yml`); release archives are signed with cosign.

## 14. Container, Helm and deployment

- **Image:** runs as non-root uid 1001, from digest-pinned base images, with
  `apk upgrade` and the OpenSSL floor in the Dockerfile. Only the server's
  production dependencies and the built frontend ship. Never bake secrets into
  `ENV` or layers.
- **Helm** (see [HELM_CHART.md](HELM_CHART.md)): keep `runAsNonRoot`,
  `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true` and the
  dropped capabilities. Secrets come from a Kubernetes Secret (prefer
  `existingSecret`), never a ConfigMap, and the chart never auto-generates the
  encryption key or salt. A new secret value follows the same pattern.
- **Network:** the optional `networkPolicy` limits who reaches the pods. Set
  `CORS_ORIGIN` to the real UI origin in production. Terminate TLS in front of
  the app, and keep the database and ClickHouse off the public network.
- Public health and status endpoints (`/api/health`, `/api/rbac/health`,
  `/api/rbac/status`) return status and version only. Raw errors, hostnames,
  config and secrets go to the server log, never the response.

## 15. Dependencies and images

ArtifactHub scans the published image with Trivy, and CI gates on it
(`trivy image … --severity HIGH,CRITICAL`) plus `grype dir:.`.

- Run `bun audit` (root **and** `docs/portfolio/`) before opening a PR that
  changes dependencies; fix within range with `bun audit fix`, raise the range
  floor in `package.json` so a fresh resolve can't regress, and use
  `overrides` for transitive pins.
- Remove unused dependencies instead of patching them (see
  [DEAD_CODE.md](DEAD_CODE.md)).
- An accepted risk goes in **both** `.trivyignore` (with an `exp:` date) and
  `.grype.yaml`, with the reason, the dependency chain and the exposure — and
  in SECURITY.md's known accepted vulnerabilities.
- Keep toolchains on supported releases (Go for the CLI, Bun/Alpine base image
  digests via Renovate). An EOL toolchain ships unfixed stdlib CVEs.
- **CI is part of the supply chain.** Give each workflow job the narrowest
  `permissions:` it needs. Never run untrusted PR code with secrets
  (`pull_request_target` + checkout of the PR head). Never echo secrets in
  logs. Pin third-party actions to a commit SHA; first-party `actions/*` may
  use a major tag. Don't `curl | sh` an installer outside CI's existing scanner
  steps.
- New dependencies need a reason: check maintenance, install scripts and
  transitive size first, and prefer what the stack already ships.

## 16. Handling a vulnerability

- Reports follow the root [SECURITY.md](../SECURITY.md): private disclosure,
  no public issue or PR description that explains how to exploit an
  unreleased fix.
- **Fix:** reproduce first, then fix the root cause (the shared helper or
  middleware, not the one call site), add a regression test that fails without
  the fix, and look for the same pattern elsewhere in the codebase.
- Ship the fix as a `patch` changelog fragment that names the impact in plain
  words, without a step-by-step exploit.
- Anything left unfixed is an accepted risk (section 15) with an owner and an
  expiry, or a tracked follow-up, never silence.

---

## Security review checklist

Use this alongside [CODE_REVIEWER.md](CODE_REVIEWER.md) for any change in the
areas above.

- [ ] Restricted-user test: could a user limited to one database reach another
      through this change (SQL shape, button, upload, AI tool, export,
      schedule)?
- [ ] Admin test: could an `admin` use this change to gain `super_admin`
      power, or to grant more than they hold?
- [ ] Object-level checks: every id from the request is scoped to the caller
      (owner, share or connection access)
- [ ] New SQL shapes or parser changes have `dataAccess.test.ts` regressions
- [ ] Server-built SQL uses the escaping/validation helpers for *every*
      interpolated value, including ids
- [ ] New routes have `requirePermission`; new public paths say what
      authenticates them; state-changing routes keep the CSRF header check
- [ ] Tokens, PATs and sessions: verified before use, revocable, never in URLs
      or logs
- [ ] No security limit keyed on a client-controlled header
- [ ] No credentialed CORS for wildcard origins; redirects stay same-app
- [ ] Outbound fetches: permission-gated, host-pinned where possible, timeout,
      no verbatim response echo
- [ ] No secrets or PII in logs, responses or URLs; public endpoints return no
      raw errors
- [ ] Security-relevant actions write an audit entry
- [ ] New data-returning endpoints have size/row caps; bodies stay under the
      global limit
- [ ] Helm/Docker changes keep non-root, read-only root FS, and secrets in
      Secrets
- [ ] CI changes: least-privilege `permissions:`, no secrets on untrusted code
- [ ] `bun audit` clean (or the exception is documented in both scanner files)
- [ ] Fix verified end to end where practical — reproduce first, then show it
      denied — and the regression test fails without the fix
