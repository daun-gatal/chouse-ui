type: patch

### Fixed
- Columns whose names contain a dot (`device.name`, `Nested` columns such as `n.a`, JSON paths such as `j.device.name`) showed NULL in the SQL results grid and in the table **Data sample** tab, although ClickHouse returned values and the export was right. Both grids now read each column by its exact name, and two columns with the same name or with names like `a.b` and `a_b` get separate headers.
