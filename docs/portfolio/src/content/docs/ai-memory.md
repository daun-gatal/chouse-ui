---
app: AI Governance › Memories
route: /ai/memories
permissions: ai:chat, ai:optimize, ai_memories:manage
screenshot: ai-memories
---
# Memory

Agents with memory turned on remember short notes between conversations: your own preferences, and what your team knows about a ClickHouse connection. **AI Governance › Memories** (`/ai/memories`) shows them, and is where team notes are reviewed.

## Your memories

When you state a lasting preference or fact — *show timestamps in UTC*, *I own the billing tables* — the agent saves it with its `remember` tool, and the reply says **Saved to your memory** with **Undo**. Every later conversation with an agent that has memory turned on sees your notes as background, never as instructions: what you ask now always wins.

After a conversation in [Chobi](/docs/chobi/#chat), Chobi may also **suggest** notes worth keeping; they are saved only when you pick **Save to me** or **Propose to team**.

On the Memories tab you can add, edit and delete your notes, **Export** them as JSON, and turn **Memory** off. With memory off, agents neither read nor keep notes about you; your notes stay until you delete them. Only you see your memories. They're deleted with your user.

## Team memories

Knowledge about a connection that helps everyone — *events.ts is stored in UTC*, *orders_v1 is deprecated, use orders* — is a **team memory**. When an agent or a person proposes one, it waits for review: agents only use it once someone with `ai_memories:manage` (Admin and Super Admin) approves it. Reviewers see a count on the tab and a **Review** prompt; they can approve, reject, edit and delete team notes. You can edit or withdraw your own proposal until it is reviewed. Everyone who can reach the connection sees its approved notes.

A team note that names a table — `sales.orders`, or `orders` on its own — also shows under **Team memories** on that table's page in [Data › Context](/docs/data-context/). Team memories are deleted with their connection, not with the person who proposed them.

## What is kept

- A note is one or two sentences, up to 500 characters. Saving the same note twice keeps one.
- A person keeps at most 100 notes, and a connection at most 100 team notes.
- Before a note is stored, the enforced pattern and keyword [guardrails](/docs/ai-guardrails/) check it, whatever their stage, since a note goes to the model in every later prompt. A match refuses your own note; a team proposal is saved but flagged for its reviewer.
- A prompt carries at most 40 notes of each kind, newest first.
- Notes are stored in CHouse's database only. The chat and [AI activity](/docs/ai-usage/) never copy them elsewhere. Changes are audited as `ai_memory.*` without the note itself.

## Turning memory on for an agent

Memory is a runtime setting of an agent: **Memory** on the editor's **Settings** tab. It is on for the built-in *ClickHouse Data* and *CHouse Assistant* chat agents. An agent with memory sees notes wherever it runs; it only gets `remember` in the chat, where someone sees what it keeps.
