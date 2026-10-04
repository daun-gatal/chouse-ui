# Approve and roll back a fix

Fixes change your clusters, so CHouse UI makes them deliberate: an action from a closed catalog, proposed by one person, approved by another, run with a separate credential, verified, and rolled back if needed. This guide goes through one fix end to end. Background: [Fixes with approval](/docs/data-incidents/#fixes-with-approval).

## Before the first fix: set up the connection

Do this once per connection (needs `connections:edit`):

1. Create a ClickHouse user for fixes, e.g. `chouse_fixer`, with only the grants the actions you plan to allow need — the **Propose a fix** form lists the grants per action.
2. **Admin › Connections › Edit › Remediation credential** — enter its username and password and save.
3. Optional: set `REMEDIATION_MAINTENANCE_WINDOW` (UTC, default `02:00-04:00`) for TTL and codec changes, and the `SLACK_*` settings to approve from Slack.

## 1. Propose

On the incident (or on a Doctor report), choose **Propose a fix** (needs `remediation:propose`):

1. Pick the **Action** and fill in its parameters — e.g. *restart an engine table* `shop.orders_kafka`.
2. Explain **Why this fix** — the evidence it addresses.
3. Review the exact statements, how it will be verified and how it rolls back. **Propose fix**.

Chouse AI drafts appear under **Fix drafts**; **Review & propose** turns one into a proposal you own.

## 2. Approve

An approver opens the incident, or `chouse remediation list --status proposed`:

- Low-impact fix: one approver with `remediation:approve`. You may approve your own low-impact fix.
- **High impact** (marked on the proposal): two approvers with `remediation:approve_high`, neither of them the proposer.
- A fix drafted by Chouse AI or proposed by an agent can't be approved by whoever submitted it.

Approve with a comment in the UI, with the Slack buttons, or:

```bash
chouse remediation approve <actionId> --comment "checked with the owner" --yes
```

Anyone with an approve permission can **Reject** instead.

## 3. Let it run

The worker runs approved fixes within seconds; **Run now** runs one immediately. Window-only actions wait for the maintenance window. Just before running, CHouse UI checks the target is unchanged since approval — if not, it refuses, and you propose again with fresh parameters.

## 4. Check the result

After running, a verification probe confirms the effect and the fix shows *verified*. Watch the incident: once the evidence says the problem is gone, it moves to *recovered*.

## 5. Roll back if needed

For TTL, codec and settings changes, **Roll back** restores the recorded previous value. Every step — propose, approve, reject, run, roll back — is in the [audit log](/docs/audit-events/).
