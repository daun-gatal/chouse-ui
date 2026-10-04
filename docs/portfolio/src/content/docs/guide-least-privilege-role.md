# Give a team least-privilege access

Example: the analytics team should query the `analytics` database on the production connection, see Monitoring and Data, and nothing else. This takes a data access policy and a custom role. You need `data_access:create`, `roles:create` and `roles:assign`.

## 1. Create the data access policy

**Admin › Data access › New policy**:

1. Name: *Prod analytics — read*.
2. Connection: *Production*.
3. Allow `analytics` / `*`.
4. To keep personal data out, add a **deny** rule `analytics` / `pii_*` with a **higher priority** than the allow — the first matching rule wins.
5. Save.

How matching works: [Data access rules](/docs/data-access-rules/#how-a-table-is-checked).

## 2. Create the role

**Admin › Roles › Create role**:

1. Role name `analytics_team`, display name *Analytics team*.
2. Permissions — start from the [Analyst column of the permission catalog](/docs/permissions/), for example:
   - Explore and query: `database:view`, `table:view`, `table:select`, `query:execute`, `query:history:view`
   - Saved queries: `saved_queries:view`, `saved_queries:create`, `saved_queries:update`
   - Monitoring: `logs:view`, `metrics:view`
   - Data: `observe:view`, `data_health:view`
3. Data access policies: *Prod analytics — read*.
4. Save.

## 3. Assign it

**Admin › Users** → edit each person → set the role. With [SSO](/docs/sso/), map your IdP group to `analytics_team` instead, so new team members get it automatically.

## 4. Check it

Ask a team member to open **Preferences › Identity & access**: it lists their roles, data access and every permission they hold. Quick checks:

- `SELECT * FROM analytics.orders` works; `SELECT * FROM analytics.pii_customers` is refused.
- Other databases don't appear in the Explorer.
- Admin isn't in the dock.

Changes to the role or policy apply on their next request — no sign-out needed.

## Remember

- ClickHouse's own grants on the connection user are the outer limit: CHouse UI can only narrow them.
- Tokens the team creates carry these same limits, so their CLI and agents can't do more than they can.
