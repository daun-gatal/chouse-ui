# workspace

## Overview

SQL workspace feature. `components/` holds the tab bar, SQL/Home/Info tabs and EXPLAIN views; `editor/` holds the Monaco editor and language setup.

## Subdirectories & Boundaries

- components: [components](./components/README.md) - Query workspace UI: a drag-sortable tab bar rendering Home, SQL, Info and Schema-Inventory tabs, the SQL tab with results/chart/statistics/EXPLAIN, and EXPLAIN visualizers.
- editor: [editor](./editor/README.md) - Monaco SQL editor (`SqlEditor`) and Monaco setup: themes, ClickHouse tokenizer, language config and completion/hover/signature/formatting providers; `sqlCompletionUtils` holds pure context parsing.
