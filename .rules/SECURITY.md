# Security Rules

Security awareness and review rules for CHouse UI. Read this before writing or
reviewing code that touches **authentication, authorization, data access rules,
SQL generation, outbound requests, HTTP headers, or dependencies**. Coding
standards live in [CODE_CHANGES.md](CODE_CHANGES.md); the general review
checklist in [CODE_REVIEWER.md](CODE_REVIEWER.md) links here for its security
section.

CHouse UI sits between users and ClickHouse clusters that often hold an
organization's most sensitive data, and it usually connects to ClickHouse with a
**shared, highly privileged ClickHouse user**. That makes CHouse UI's own RBAC
and data access rules the *only* boundary between a restricted user and
everything that ClickHouse user can read. Treat every rule below as protecting
that boundary.

---

## 1. Threat model in one paragraph

Assume an **authenticated but restricted user** (custom role, data access policy
limited to some databases) is the attacker, and that they can send any request
the API accepts — not just what the UI sends. Also assume an **unauthenticated
internet client** can reach every public endpoint, and that **any website** the
user visits can make requests to CHouse UI from their browser. Agents (MCP /
PAT clients and the built-in AI SRE) are users too: their SQL and tool arguments
are model-generated and can be steered by a prompt.

---

## 2. Data access rules and SQL

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
  what the same statement typed into the SQL editor would be denied.
- Add a regression test in `dataAccess.test.ts` for every new statement shape,
  phrased as "a user limited to `public` cannot read `secret.t` via …".

## 3. Building SQL on the server

- **Identifiers**: `escapeIdentifier` / `escapeQualifiedIdentifier` only.
- **String literals**: `quoteStringLiteral`. ClickHouse treats `\` as an escape
  character, so doubling `'` alone is **not** escaping.
- **Anything else interpolated into SQL** (column types, engines, ORDER BY /
  PARTITION BY / PRIMARY KEY, settings) must be validated as a *whole string*
  against a strict grammar (`validateColumnType`, `validateTableEngine`,
  `isSafeKeyExpression`). Checking a prefix, or rejecting a few "dangerous
  characters", leaves room to close the clause and append more SQL.
- Prefer ClickHouse query parameters (`{name:Type}`) for values over string
  building whenever the client supports it.

## 4. Authentication, sessions and rate limits

- Server routes use `rbacAuthMiddleware` + `requirePermission`; the client's
  `PermissionGuard` is a UX nicety, never a control.
- Passwords: Argon2id via `Bun.password`. JWTs: `jose`. Compare secrets and
  signatures with `timingSafeEqual`.
- **Never key a security limit on a header the client controls.** The client
  writes all of `X-Forwarded-For` unless a proxy appends to it; use
  `rateLimitClientKey` (rightmost hop) and pair IP limits with a per-account
  limit (`loginAccountKey`) on anything that checks a credential.
- Public endpoints (`publicPaths` in `routes/index.ts`, CORS `bypassPaths`)
  must authenticate the request some other way — a signature (Slack), a signed
  one-time state cookie (SSO), or XML-DSig (SAML). Adding a path to either list
  needs a comment saying what protects it.

## 5. Browser-facing controls

- **CORS**: a wildcard origin must never be combined with
  `Access-Control-Allow-Credentials`. Match `*.example.com` on the parsed
  hostname, not with a string suffix.
- **Redirects** after login: same-app relative paths only. Reject `//`, `/\`,
  and control characters (URL parsing drops tabs/newlines, turning `/\t/x` into
  `//x`). Server (`safeRedirect`) and client (`safeClientRedirect`) both check.
- **HTML**: never `dangerouslySetInnerHTML` without DOMPurify and an explicit
  tag/attribute allowlist. Don't enable raw HTML in `react-markdown`.
- Tokens stay out of URLs; use one-time handoff codes (see SSO complete flow).

## 6. Outbound requests (SSRF)

Webhooks, alert channels, AI provider base URLs, ClickHouse connection hosts and
SSO issuers are all URLs the server will fetch.

- Only users with the matching *manage/edit* permission may set them.
- Pin callback URLs to their expected host where one exists (e.g. Slack
  `response_url` must start with `https://hooks.slack.com/`).
- Never return a fetched response body to the user verbatim — return status and
  a short, sanitized error.
- Always set a timeout (`AbortSignal.timeout`).

## 7. Secrets and logging

- Connection passwords and channel secrets are encrypted at rest (AES-256-GCM);
  decrypt only at the point of use and never return them from an API.
- Never log passwords, tokens, API keys, full SQL results or PII. Log ids.
- Production must fail to start without `JWT_SECRET`, `RBAC_ENCRYPTION_KEY` and
  `RBAC_ENCRYPTION_SALT` — don't add a silent default for a new secret.

## 8. AI and agent surfaces

- AI tools run SQL **as the requesting user** through the same validation as
  the editor. A tool must never use a privileged path the user lacks.
- Treat model output and tool arguments as untrusted input: validate with Zod,
  apply the same data access checks, and keep destructive actions behind human
  approval.
- Content the model reads (query results, table comments, docs) can carry
  instructions; it must not be able to widen what the agent is allowed to do.

## 9. Dependencies and images

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

---

## Security review checklist

Use this alongside [CODE_REVIEWER.md](CODE_REVIEWER.md) for any change in the
areas above.

- [ ] Restricted-user test: could a user limited to one database reach another
      through this change (SQL shape, button, AI tool, export, schedule)?
- [ ] New SQL shapes or parser changes have `dataAccess.test.ts` regressions
- [ ] Server-built SQL uses the escaping/validation helpers for *every*
      interpolated value
- [ ] New routes have `requirePermission`; new public paths say what
      authenticates them
- [ ] No security limit keyed on a client-controlled header
- [ ] No credentialed CORS for wildcard origins; redirects stay same-app
- [ ] Outbound fetches: permission-gated, host-pinned where possible, timeout,
      no verbatim response echo
- [ ] No secrets or PII in logs, responses or URLs
- [ ] `bun audit` clean (or the exception is documented in both scanner files)
- [ ] Fix verified end to end where practical — reproduce first, then show it
      denied — and the regression test fails without the fix
