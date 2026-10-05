---
app: AI Governance › Assistant › AI Governance › Prompt
route: /ai/assistant
permissions: ai_agents:view, ai_agents:manage
---
# Prompt templates

An agent's **system prompt** and **task template** are templates. They are deliberately logic-free: three forms are interpreted, and every other character — including other `{{…}}` text such as `{{slot_start}}` — is kept as written.

| Form | Effect |
| --- | --- |
| `{{ctx.name}}` | Insert the feature's variable `name` |
| `{{#ctx.flag}} … {{/ctx.flag}}` | Keep the text between the tags only when `flag` is set |
| `{{skill:name}}` | Insert the skill's `SKILL.md` (trimmed) |
| `{{skill:name/file.md}}` | Insert one file of the skill (trimmed) |

## Variables

A feature hands its agent a fixed set of variables: the query being optimized, the node under investigation, the evidence it gathered, and so on. Each feature's variables, with their types and values, are listed in the [AI feature catalog](/docs/ai-features/). A few examples:

| Feature | Variables |
| --- | --- |
| Optimize query | `ctx.query`, `ctx.additionalPrompt` |
| Diagnose a server error | `ctx.node.id`, `ctx.node.name`, `ctx.error.code`, `ctx.error.name`, `ctx.error.message` |
| Fleet Doctor scan | `ctx.hours`, `ctx.nodeCount`, `ctx.overview` (JSON), `ctx.needsPlaybook` (boolean) |
| DataOps and observability features | `ctx.evidence` (JSON) |

Rules:

- Only **feature agents** (with a task template) get variables. A chat agent or a subagent that uses `{{ctx.…}}` is rejected.
- A template may only use variables that **every feature bound to the agent** provides. The editor's palette shows exactly those.
- A variable that isn't provided at run time is an error, not an empty string: the run fails closed rather than sending the model a broken prompt.
- Values are inserted as plain text; JSON variables arrive as JSON text.

## Sections

A section keeps its text when the variable is *set*: a non-empty string, a number other than zero, or `true`. Empty strings, `0`, `false` and missing values drop the section. Sections can nest, and each must be closed by the same name.

The built-in SQL Optimizer uses one to add the user's extra instructions only when there are any:

````text
Optimize this ClickHouse SQL query:

```sql
{{ctx.query}}
```
{{#ctx.additionalPrompt}}

Additional instructions from the user:
{{ctx.additionalPrompt}}{{/ctx.additionalPrompt}}
````

The Fleet Doctor pulls in the ClickHouse playbook only when the scan found a heavy query worth optimizing:

```text
{{#ctx.needsPlaybook}}{{skill:clickhouse-playbook/reference.md}}{{/ctx.needsPlaybook}}
```

## Skill includes

`{{skill:…}}` inlines a skill's text where the token stands. It is the same text a [pinned skill](/docs/ai-skills/#on-demand-or-pinned) adds, but at a place you choose — inside a section, before the rules, in the task template. The skill must exist and be enabled, and the file must exist in it, or the save is rejected; disabling a skill that a template includes shows up under **Problems**. The palette's **Inline a skill…** menu lists every enabled skill and file.

## What the model receives

For a **feature agent**, the system prompt is assembled in this order:

1. the rendered system prompt
2. each pinned skill file, in the order the skills are listed
3. the feature's output contract — the JSON schema the answer must match (not editable)
4. the harness's prompt suffix

The rendered task template is the first user message. For a **chat agent** it is the same without the output contract and the task: the user's conversation follows the system prompt. Each subagent's prompt is rendered the same way with its own pinned skills and its own harness suffix.

The [test console](/docs/ai-test-console/) shows the exact system prompt and task message of a real run.

## Preview and validation

**Preview** in the editor renders both templates against the bound feature (or the feature you opened the editor from) with placeholder values — strings show as `«name»`, booleans as true so every section shows — and lists every problem the change would introduce. A feature agent that isn't bound yet has no variables to render with, so its preview reports its variables as unknown — try it in the [test console](/docs/ai-test-console/) instead, which picks the feature. The checks:

- a variable the feature doesn't provide (`Unknown template variable ctx.qurey`)
- a section that is never closed, or closed by another name
- an unknown or disabled skill, or a file the skill doesn't have
- `{{ctx.…}}` in a chat agent or subagent

The same checks run on save for the agent and for every feature it serves, directly or as a subagent.
