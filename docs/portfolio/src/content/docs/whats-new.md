# What's new in 3.15

3.15 makes the AI agent registry easy to start from. Instead of writing an agent, harness or skill from a blank template, describe what you want and review a complete draft that only uses what exists in your registry.

## Highlights

**Draft with AI** — **New agent**, **New harness** and **New skill** in **AI Governance › Assistant** get a **Draft with AI** button. Describe the goal in plain language, and Chouse AI fills in every section of the editor — prompt, tools, skills, subagents, harness and tuning for an agent; a decision for every built-in tool for a harness — each pick with a reason. A section left empty says why, and one that still needs work is flagged instead of left blank. Unknown tools and skills are dropped, slugs made unique and permissions worked out from the tools before the draft reaches you. Nothing is saved until you press **Create**. → [Draft with AI](/docs/ai-draft-with-ai/)

**Skills from a runbook** — Paste a runbook or doc into a skill draft, and it comes back as a `SKILL.md` that says when to use it, with a step-by-step procedure, examples and pitfalls, and long material split into linked reference files. → [Starting a draft](/docs/ai-draft-with-ai/#starting-a-draft)

**Redraft and refine** — Redraft any single section, or refine a draft — or any custom agent, harness or skill — with an instruction such as "make it stricter about DDL". You review the result before saving, as always. → [Refine with AI](/docs/ai-draft-with-ai/#refine-with-ai)

## Upgrading from 3.14

Migrations run on start; nothing to run by hand. Check these:

| What changed | What to do |
| --- | --- |
| Three built-in drafter agents (*Agent Author*, *Harness Author*, *Skill Author*) and their features are installed on start | Nothing to do. Drafting needs `ai_agents:manage` and `ai:optimize`; Admin and Super Admin have both |

The full list of changes is in the [changelog](https://github.com/daun-gatal/chouse-ui/blob/main/CHANGELOG.md).
