/**
 * Column wiring for grids that show raw ClickHouse result rows.
 *
 * ClickHouse column names are arbitrary strings: `device.name` (a dotted
 * alias), `n.a` (a Nested column), `j.device.name` (a JSON subcolumn), `a[0]`,
 * or the same name twice (`SELECT 1, 1`). TanStack Table reads an
 * `accessorKey` containing `.` as a nested path (`row.device.name`) and turns
 * it into the column id `device_name`, so those cells render as NULL and
 * `a.b` collides with `a_b`. Each row from the API is a flat object keyed by
 * the exact column name, so read that key directly and give every column its
 * own id.
 */

/** Row shape returned by the query API: one flat key per result column. */
export type ResultRow = Record<string, unknown>;

/** The `id` + `accessorFn` pair to spread into a TanStack `ColumnDef`. */
export interface ResultColumnAccessor {
  id: string;
  accessorFn: (row: ResultRow) => unknown;
}

/**
 * Builds one accessor per result column, in order. The id is the column name,
 * suffixed with `#2`, `#3`, ... when the name repeats, so ids stay unique.
 */
export function resultColumnAccessors(names: readonly string[]): ResultColumnAccessor[] {
  const seen = new Map<string, number>();
  const used = new Set<string>(names);
  return names.map((name) => {
    let count = (seen.get(name) ?? 0) + 1;
    let id = count === 1 ? name : `${name}#${count}`;
    // A later name may itself look like a suffixed id (`x` then `x#2`).
    while (count > 1 && used.has(id)) {
      count += 1;
      id = `${name}#${count}`;
    }
    seen.set(name, count);
    used.add(id);
    return {
      id,
      accessorFn: (row: ResultRow): unknown =>
        Object.prototype.hasOwnProperty.call(row, name) ? row[name] : undefined,
    };
  });
}
