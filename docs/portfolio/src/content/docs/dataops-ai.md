---
app: Data › Scheduled queries and Data › Datasets (detail pages)
permissions: ai:optimize
---
# Operational brief

The **AI operational brief** is a card on each [scheduled query](/docs/scheduled-queries/)'s page and each [promise](/docs/data-health/)'s page. Chouse AI reads that job's or promise's definition and its recent runs, evaluations and incidents, and writes a short summary of what's going on and what to do next. It needs `ai:optimize` and a configured [AI model](/docs/ai-models/).

## What it shows

| Section | Shows |
| --- | --- |
| **Observed facts** | What the evidence says — failed or slow runs, breaches, gaps |
| **Impact** | What is affected downstream |
| **Blockers** and **Warnings** | What needs attention now, and what to watch |
| **Recommendations** and **Safe next actions** | Concrete steps, in order |
| **Evidence and freshness** | The runs and incidents it was based on, and how current they are |

Investigations of a specific run or incident open in a dialog with the same sections.

## Using it

- **Refresh AI brief** regenerates it from the latest evidence.
- **Useful?** — mark it useful or not; the feedback helps tune it.
- The model button on Data pages picks the AI model for every AI feature there; your choice is stored for you. *System default* uses the default [deployment](/docs/ai-models/#3-create-a-deployment).

## What it sees

Job and promise definitions, run history, statuses and error text, evaluations and incidents. It doesn't read rows from your tables. If the AI is unavailable, the card says so and the rest of the page works as usual.

## Related

- [Incidents, root cause & fixes](/docs/data-incidents/) — the cross-layer investigation with Chouse AI's explanation
- [Doctor](/docs/doctor/) — the AI health check for whole servers
- [AI agents](/docs/ai-agents/) — the agents behind these briefs, which administrators can edit and test
