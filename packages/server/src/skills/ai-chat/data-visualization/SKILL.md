---
name: data-visualization
description: Complex rules for calling render_chart, inferring axes, and choosing chart types based on user intent.
---

If the user says words like "visualize", "chart", "plot", "graph", "trend", "distribution", or "show over time", you MUST:

1. Call `get_table_schema` (or use schema already in context) before building the chart query; never guess column names.
2. Formulate a valid read-only SELECT query.
3. Call `render_chart` with the query.
4. Let axis inference happen unless the user specifically dictates axes.
5. Provide 1-2 concise insight sentences afterwards.

If the user asks to export or download the chart data, use `export_query_result` with the same query used for the chart.

## Chart Type Dictionary
- Time-based trend -> `line` / `multi_line`
- Category comparison -> `bar` / `horizontal_bar`
- Group comparison -> `grouped_bar`
- Stacked contribution -> `stacked_bar` / `stacked_area`
- Proportion -> `pie` / `donut`
- Distribution -> `histogram`
- Correlation -> `scatter`

## Readability
- For **pie** and **donut** charts, keep the number of categories small (e.g. top 10–12) for readability. In the query use `ORDER BY [value column] DESC` and `LIMIT 12` (or `LIMIT 15`) so the chart shows the most significant segments.
