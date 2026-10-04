/**
 * Explorer deep links. The Explorer opens a table-information tab from
 * `?database=<db>&table=<table>` (WorkspaceTabs); build every link here so
 * callers cannot drift to a different parameter name.
 */

export interface ExplorerTarget {
  database: string;
  table: string;
}

/** `/explorer?database=…[&table=…]`, or `/explorer` when no database is given. */
export function explorerPath(database?: string, table?: string): string {
  if (!database) return "/explorer";
  const params = new URLSearchParams({ database });
  if (table) params.set("table", table);
  return `/explorer?${params.toString()}`;
}

/**
 * Read the target from Explorer search params. `db` is accepted as an alias
 * because earlier builds linked with it; a table without a database is not a
 * target (it would open an info tab for the wrong object).
 */
export function readExplorerTarget(params: URLSearchParams): ExplorerTarget | null {
  const database = params.get("database") || params.get("db") || "";
  const table = params.get("table") || "";
  if (!database) return null;
  return { database, table };
}
