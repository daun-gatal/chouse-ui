# DataOps AI

DataOps AI is the summarization layer over the DataOps suite: an AI-generated **operational brief** of what happened across your scheduled jobs and data-health incidents, right where you look at them.

## What it does

| Surface | AI role |
| --- | --- |
| **Operational brief card** | One card summarizing job runs + promise status: what succeeded, what's drifting, what needs a human |
| **Insight dialog** (`AiInsightDialog`) | Deep-dive on a specific run or incident: why it likely failed and what to check |
| **Model button** | Pick the provider/model per insight — same selector UX as [AI Assist](/docs/workspace-ai-assist/) |

## What it sees

The same telemetry the DataOps tabs already have: job definitions, run history, statuses, error text, promise evaluations and incidents. It does **not** see data rows — consistent with the read-only posture of all Chouse AI surfaces.

## Reading the brief

The brief is ordered by action-worthiness:

1. **Broken promises / failed jobs** — act now
2. **Drifting trends** (volume shrinking, durations growing) — watch
3. **Healthy confirmation** — skim and move on

Each insight links back to the underlying run/incident for verification — the AI proposes; the tabs prove.

## Setup

- Requires AI providers configured — see [AI Assist](/docs/workspace-ai-assist/) (Admin → AI models)
- Runs under the DataOps access permissions; usage is [audited](/docs/audit-log/)
- Spends provider tokens per insight — the same budget controls apply

## Related

| Feature | Relationship |
| --- | --- |
| [Fleet Doctor](/docs/ai-fleet-doctor/) | Cluster-level AI SRE; DataOps AI is the data-pipeline counterpart |
| [In-tab AI](/docs/ai-in-tab/) | Query-level diagnosis; DataOps AI is job/pipeline-level |
| [Data health](/docs/data-health/) | The signals the AI summarizes |

> **Tip:** The brief is the fastest morning stand-up artifact: one card, one paragraph, one set of links into the tabs that matter.
