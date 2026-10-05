---
app: AI Governance › Assistant › History
route: /ai/assistant
permissions: ai_agents:view, ai_agents:manage
---
# Versions, upgrades & audit

Every agent, harness, skill and feature binding is versioned. Nothing you change is lost, nothing CHouse ships overwrites your changes, and every change is in the audit log.

## History and restore

Each save creates a new version and a revision that records the whole entity as it was saved, who saved it and why:

| Revision | Meaning |
| --- | --- |
| **Installed** | CHouse added the built-in on first start (or after an upgrade that introduced it) |
| **Upgraded with CHouse** | A CHouse upgrade replaced an unchanged built-in with its newer definition |
| **Created** / **Edited** / **Deleted** | A person changed it in AI Governance › Assistant |
| **Reset to built-in** | Someone restored the shipped definition |
| **Rolled back** | Someone restored an older version |

Revisions written by CHouse itself are marked *by CHouse*. Open **History** in the agent editor, or at the bottom of a harness or skill, and **Restore** any version. Restoring doesn't rewrite history: it saves the old content as a new version, after the same validation as any save — a version that would break a feature today (because a skill it pins has since been deleted, say) is refused with the problems.

Feature bindings are versioned the same way. The UI shows the current binding in **Features**; rebinding back is the quickest undo, and the API exposes binding revisions at `GET /api/ai-agents/revisions/binding/<feature-id>`.

## Built-ins and CHouse upgrades

Each built-in agent, harness and skill carries a fingerprint of the definition CHouse shipped. On every start, on every replica, CHouse compares it with the version it ships now:

| Built-in is… | On upgrade |
| --- | --- |
| **built-in** (unchanged) | Replaced with the new definition, keeping your **Enabled** switch. Recorded as *Upgraded with CHouse* |
| **customized** (you edited it) | Left alone. It shows **update available**, and the header counts it under *Customized built-ins* |
| missing (new in this release) | Added |

A feature whose binding is missing or points at a deleted agent is bound back to its built-in agent at start-up. A binding you changed to another existing agent is kept.

**Reset to built-in** restores the definition shipped with the running version, clears *customized*, and lets future upgrades apply again. It is offered on a customized built-in and on one with an update available. To keep your change *and* get the update, open the agent's **History** to copy what you changed, reset, then re-apply your edit.

Built-ins can't be deleted. Disable them, rebind their features, or reset them.

## Changes across replicas

The registry lives in CHouse's metadata database (SQLite or PostgreSQL), not in the container. Each replica keeps a copy in memory and checks a version counter on every request, so a change saved on one replica is used by every replica on its next AI request — there's nothing to restart or roll out.

Two people editing the same agent can't overwrite each other: the second save is refused with "changed by someone else" and must be re-applied on the current version.

## Audit trail

Every change made in AI Governance › Assistant is written to the [audit log](/docs/audit-log/) with the user, the entity and its id:

| Action | When |
| --- | --- |
| `ai_agent.create`, `ai_agent.update`, `ai_agent.delete` | An agent is added, saved or deleted |
| `ai_harness.create`, `ai_harness.update`, `ai_harness.delete` | The same for harnesses |
| `ai_skill.create`, `ai_skill.update`, `ai_skill.delete` | The same for skills |
| `ai_binding.update` | A feature is bound to another agent |
| `ai_registry.reset` | An agent, harness or skill is reset to its built-in |
| `ai_registry.rollback` | An older version is restored |

Filter **Admin › Audit** by these actions — or ask CHouse Admin in the chat, *"what changed in the AI agents this week?"*. All audit actions are listed in [Audit events](/docs/audit-events/).
