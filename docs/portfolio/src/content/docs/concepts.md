# Core concepts

Four mental models explain everything CHouse UI does.

## 1. CHouse UI RBAC ≠ ClickHouse users

**CHouse UI RBAC** controls the web interface. It lives in CHouse UI's own database (SQLite or PostgreSQL), and every request — including every query — is checked against these permissions before reaching ClickHouse:

- Six built-in roles: Super Admin, Admin, Developer, Analyst, Viewer, Guest
- Granular permission strings (`logs:view`, `ai:optimize`, …) — see the [Permission catalog](/docs/permissions/)
- [Data access rules](/docs/data-access-rules/) restrict which databases/tables a user may touch
- [SSO](/docs/sso/) can delegate the authentication step to your identity provider

**ClickHouse user management** is a separate, optional feature: CHouse UI can create real ClickHouse users with native grants. It does not change how the UI authorizes you.

## 2. Connections

A **connection** is a stored ClickHouse server endpoint — host, port, credentials, optional defaults. Key properties:

- Multiple servers can be registered; a selector in the UI switches between them
- Passwords are encrypted with AES-256-GCM server-side; the browser never sees them
- The [fleet view](/docs/fleet-view/) treats every connection as a monitored cluster
- Admins manage connections in **Admin → Connections** (`connections:view`/`connections:edit`)

## 3. Everything is proxied through the server

The browser never queries ClickHouse directly:

```
Browser (React SPA)
   → /api/*  (Bun + Hono server)
      → auth (JWT) → RBAC check → SQL parse → data access rules
         → @clickhouse/client → ClickHouse
```

That path is what makes the security model possible — see the [Security model](/docs/security/).

## 4. The AI is read-only and advisory

Chouse AI — the Fleet Doctor and the in-tab Optimize/Fix/Diagnose actions — runs with `readonly=1` ClickHouse semantics and a guarded tool surface (single `SELECT`, `system.*` only). It writes reports and suggests rewrites; it never mutates a cluster. Permission gates:

- `doctor:view` / `doctor:run` for the Fleet Doctor
- `ai:optimize` / `ai:chat` for in-tab actions and chat
- `fleet:view` for the fleet page

## How the pieces map to pages

| You want to… | Go to |
| --- | --- |
| Run and save SQL | [SQL editor](/docs/workspace-editor/), [Saved queries](/docs/workspace-saved-queries/) |
| Understand cluster load | [Monitoring](/docs/monitoring-overview/) |
| Watch many clusters | [Fleet view](/docs/fleet-view/) |
| Automate without the browser | [MCP server](/docs/mcp/), [CLI](/docs/cli/) |
| Schedule SQL and watch data quality | [Scheduled queries](/docs/scheduled-queries/), [Data health](/docs/data-health/) |
