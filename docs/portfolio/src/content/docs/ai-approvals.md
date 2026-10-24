---
app: AI Governance › Approvals
route: /ai/approvals
permissions: ai:act, ai:chat, ai:optimize
---
# Approvals

**AI Governance › Approvals** (`/ai/approvals`) lists every change an AI agent asked to make, and holds the ones nobody was there to approve. An agent never changes anything by itself: a person approves each action, and it then runs as that person, through the same CHouse checks, validation and audit as doing it in the UI.

## The action tools

| Tool | Risk | What it does |
| --- | --- | --- |
| `kill_query` | Low | Stops a running query |
| `create_saved_query` | Low | Saves a query to the user's saved queries |
| `create_scheduled_query` | Low | Creates a scheduled report query |
| `create_health_promise` | Low | Creates a Data Health promise on a table |
| `create_dashboard` | Low | Creates a dashboard from panels |
| `update_table_context` | Low | Updates a table's curated context; only the fields given change |
| `propose_remediation` | High | Files a fix proposal in **Fixes**; approvers decide there |

Agents get them like any other tool, on the editor's **Tools** tab, where they're marked **approval required** or **proposal only**. The built-in *ClickHouse Data* chat agent has them all. The [AI tool catalog](/docs/ai-tools/#action-tools) lists each one's permissions.

## Where an action is decided

| Where the agent runs | What happens |
| --- | --- |
| The chat | The reply pauses on an approval card; the user approves, edits or rejects it there. See [Using the chat](/docs/ai-chat/#actions-that-wait-for-you) |
| Without a person (AI features, [auto-triage](/docs/ai-triage/)) | The action is saved here as **waiting**, for someone with `ai:act` to approve or reject |
| The [test console](/docs/ai-test-console/) and [evals](/docs/ai-evals/) | Nothing is recorded: the tool only says what it would do |

## Who sees what

| Permission | Can |
| --- | --- |
| `ai:act` | Approve actions, and see and decide every waiting background action. Admin, Developer and Super Admin have it |
| `ai:chat` or `ai:optimize` | See their own actions, and reject their own background ones |

The tab's badge counts what waits for you.

## Reviewing an action

Each row shows the action, who asked (*Alice, in chat* or *Background run as Alice*), its risk, its status and when it expires. **Approve** runs it at once; **Reject** declines it; **Review** opens the arguments, the result or the error. In the review you can edit the arguments as JSON — **Approve with changes** validates and runs the edited version — and give a reason when rejecting.

A chat action waiting in its chat shows **Answered in its chat**, which opens the thread; it can only be decided there, where the reply is waiting.

| Status | Means |
| --- | --- |
| Waiting | Nobody has decided yet |
| Done | Approved and ran |
| Failed | Approved, but CHouse refused it or it failed — the reason is shown, as you'd see it doing it yourself |
| Rejected | Declined; the agent was told why |
| Expired | Nobody decided in time: 15 minutes in the chat, 24 hours here |

## Audit

Every decision is recorded as `ai_action.approve` or `ai_action.reject` with the tool and what it would do; what the action then does is audited by the route it calls, as for any change you make yourself. See [Audit events](/docs/audit-events/).
