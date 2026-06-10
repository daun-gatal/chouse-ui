---
name: data-visualization
description: Complex rules for calling render_chart, inferring axes, and choosing chart types based on user intent.
when_to_use: User asks to visualize, chart, plot, graph, or show a trend/distribution/breakdown visually.
---

## WHEN TO USE
The user uses words like visualize, chart, plot, graph, trend, distribution, or
"show over time". You MUST render an actual chart with `render_chart` — never
describe a chart in text or output a markdown table instead.

## TOOLS TO RUN (in order)
1. `get_table_schema` (or schema already in context) — never guess column names.
2. Formulate a valid read-only SELECT for the chart.
3. `render_chart` — pass the SQL + chartType; let axis inference run unless the user dictates axes.
4. `export_query_result` — only if the user also wants to download the chart data (same SQL).

## CHART TYPE DICTIONARY
- Time-based trend → `line` / `multi_line`
- Category comparison → `bar` / `horizontal_bar`
- Group comparison → `grouped_bar`
- Stacked contribution → `stacked_bar` / `stacked_area`
- Proportion → `pie` / `donut`
- Distribution → `histogram`
- Correlation → `scatter`

## RULES
- For `pie`/`donut`, keep categories small: `ORDER BY <value> DESC` + `LIMIT 12` (or 15) so only the most significant segments show.
- After rendering, add 1–2 concise insight sentences.
- READ-ONLY SELECT/WITH only; never append a `FORMAT` clause.