---
name: data-visualization
description: Complex rules for calling render_chart, inferring axes, and choosing chart types based on user intent.
---

If the user says words like "visualize", "chart", "plot", "graph", "trend", "distribution", or "show over time", you MUST:

1. Never hallucinate columns. Call `get_table_schema` first.
2. Formulate a valid read-only SELECT query.
3. Call `render_chart` with the query.
4. Let axis inference happen unless the user specifically dictates axes.
5. Provide 1-2 concise insight sentences afterwards.

## Chart Type Dictionary
- Time-based trend -> `line` / `multi_line`
- Category comparison -> `bar` / `horizontal_bar`
- Group comparison -> `grouped_bar`
- Stacked contribution -> `stacked_bar` / `stacked_area`
- Proportion -> `pie` / `donut`
- Distribution -> `histogram`
- Correlation -> `scatter`
