# Remediation

## Overview
Remediation (ADR 0016 §8): a closed catalog of typed fix actions, the propose -> approve -> execute -> verify lifecycle with rollback and rejection, the worker, persistence, and approvals over Slack and alert channels.

## Interface
- `[catalog.ts:ACTION_TYPES]`, `[catalog.ts:actionParamsSchema]`, `[catalog.ts:buildAction]`, `[catalog.ts:REQUIRED_GRANTS]`, `[catalog.ts:CONTEXT_ONLY_TYPES]`.
- `[executor.ts:proposeAction]`, `[executor.ts:approveAction]`, `[executor.ts:rejectAction]`, `[executor.ts:executeAction]`, `[executor.ts:verifyAction]`, `[executor.ts:rollbackAction]`, `[executor.ts:RemediationWorker]`, `[executor.ts:RemediationError]`.
- `[store.ts:createAction]`, `[store.ts:transitionStatus]`, `[store.ts:addApproval]`, `[store.ts:startExecution]`, `[store.ts:finishExecution]`, `[store.ts:getCredential]`, `[store.ts:setCredential]`, `[store.ts:deleteCredential]`.
- `[notify.ts:notifyProposed]`, `[notify.ts:refreshRemediationMessages]`, `[notify.ts:getRemediationNotify]`, `[notify.ts:saveRemediationNotify]`.
- `[slack.ts:postApprovalRequest]`, `[slack.ts:handleInteraction]`, `[slack.ts:verifySlackSignature]`, `[slack.ts:slackConfigured]`.

## Invariants
- SQL is generated from validated parameters only, never free-form text (`[catalog.ts:buildAction]`).
- Parameters are re-validated against the catalog on every transition; preconditions are re-checked before execution and execution is refused if prior state changed (`[executor.ts:executeAction]`).
- Class 1 needs `remediation:approve`; class 2 needs `remediation:approve_high` from two distinct approvers, never the proposer; AI and MCP proposals cannot be approved by their proposer (`[executor.ts:approveAction]`).
- SQL runs only with the connection's dedicated remediation credential, with no fallback to the read credential (`[store.ts:getCredential]`, `[executor.ts:executeAction]`).
- Window-only actions run only inside `REMEDIATION_MAINTENANCE_WINDOW` (`[executor.ts:inWindow]`).

## Side Effects
- Writes `remediation_actions`, `remediation_approvals`, `remediation_executions`, `remediation_credentials` (`[store.ts:createAction]` etc.), and audit logs (`[executor.ts:approveAction]`).
- Executes ClickHouse DDL/DML with the remediation credential (`[executor.ts:executeAction]`).
- `[executor.ts:RemediationWorker]`: `setInterval` tick under the `remediation:worker` lease.
- Slack Web API calls using `SLACK_BOT_TOKEN` / `REMEDIATION_SLACK_CHANNEL` (`[slack.ts:postApprovalRequest]`); `[slack.ts:slackConfigured]` also requires `SLACK_SIGNING_SECRET`, and approval messages link back via `PUBLIC_BASE_URL` (`[slack.ts:approvalBlocks]`); settings in `obs_settings` (`[notify.ts:saveRemediationNotify]`).

## Verification
- Run (from repo root): `./scripts/test-isolated-server.sh` (Bun Test; co-located `*.test.ts` files cover this package).
