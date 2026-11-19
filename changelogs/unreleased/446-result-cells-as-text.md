type: patch

### Fixed
- Result grid cells (SQL results and the table **Data sample** tab) show values exactly as ClickHouse returned them. A string containing HTML-like text such as `<b>`, `<img …>` or `a<b` was interpreted as markup, so parts of the value disappeared or turned bold. Numbers are no longer rounded to three decimals, which showed `1.23456789` as `1.235` and `0.00000015` as `0`.
- The SQL editor no longer throws an uncaught error each time it opens. Monaco's editor worker pointed at a file the build never produced, so it fell back to running in the main thread; the worker is now bundled and starts normally.
