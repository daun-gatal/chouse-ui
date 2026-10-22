---
app: Dashboards › Ask AI
route: /dashboards
permissions: dashboards:edit, ai:optimize
screenshot: dashboards-ask-ai
---
# Draft dashboards with AI

**Ask AI** on the [Dashboards](/docs/dashboards/) page drafts a new dashboard from a goal. On a dashboard you can edit, it drafts new panels for that dashboard. The model button in the dialog's header picks the AI model, the same pick as on the Data page. Describe what you want to watch, for example *"the orders Kafka to MergeTree pipeline, so I see problems before they hit users"*.

The *Dashboard Drafter* agent reads the schemas it needs on your active connection and drafts a title, variables, and a few panels, each with its SQL, chart settings and a one-line reason. For each panel it also says what the panel is for, and that decides the chart and the layout:

| Role | The question it answers | Charts it may use |
| --- | --- | --- |
| Current value | What is it now? | stat |
| Trend | How is it changing? | line, area, bar |
| Breakdown | What contributes? | bar, pie, donut, treemap, funnel, radar |
| Ranking | What are the top N? | horizontal bar, bar, table |
| Distribution | How is it spread? | histogram, heatmap, scatter |
| Detail | Show me the rows | table |

The model does not size panels. It marks each one primary or secondary and names its section, and CHouse places them the same way [Tidy up](/docs/dashboards/#the-canvas) does: a heading per section, current values in a row at the top, primary trends at full width, other charts two to a row, tables at the bottom.

## Every panel is checked before you see it

Each drafted panel goes through the same checks as a save and a run, with **your** access:

1. Its chart settings are valid, and its chart type fits its role.
2. Its SQL is one read-only `SELECT` that compiles with the drafted variables.
3. Your data access rules allow every table it reads.
4. A **dry run** of the query, with the [dashboard limits](/docs/dashboards/#limits), succeeds and returns every column the chart uses.
5. The [checks](/docs/dashboards/#things-to-check) for charts that look right but are wrong, including whether the chart suits the result: too many slices for a pie, a time chart whose x is not a time, too many series or categories.

Each panel comes back with one of three statuses:

- **Checked**: it passed all five checks.
- **Check this**: one of the chart checks flagged something. **Apply fix** makes a mechanical fix when there is one, such as switching a crowded pie to a horizontal bar.
- **Blocked**: it failed one of checks 1–4, with the reason. A blocked panel cannot be kept.

A drafted variable that is not valid is left out, and the review says so.

## Nothing is saved until you accept

Untick the panels you don't want and press **Create** (or **Add**, on an existing dashboard). The draft is then saved through the normal dashboard save, which checks it again. When adding to a dashboard, a variable the dashboard already has keeps its own definition, and the new panels are placed below the existing ones.

Drafting needs `dashboards:edit` and `ai:optimize`. Its tokens, cost and the schema details sent to the model provider appear in [AI activity](/docs/ai-usage/). Change the agent's model or prompt in [AI Governance › Assistant](/docs/ai-agents/).
