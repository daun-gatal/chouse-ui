import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ColumnDef } from "@tanstack/react-table";

import { resultColumnAccessors, type ResultRow } from "@/lib/resultColumns";

import { DataTable } from "./data-table";

function columnsFor(names: string[]): ColumnDef<ResultRow>[] {
  return resultColumnAccessors(names).map((accessor) => ({
    ...accessor,
    header: accessor.id,
    cell: ({ getValue }) => String(getValue() ?? "NULL"),
  }));
}

describe("DataTable with ClickHouse result columns", () => {
  // The SQL results grid (#444) builds its columns this way.
  it("shows cells for dotted, bracketed and repeated column names", () => {
    const names = ["device.name", "a[0]", "1", "1", "events"];
    const data: ResultRow[] = [
      { "device.name": "firewall-01", "a[0]": "first", 1: "one", events: 100 },
      { "device.name": "switch-01", "a[0]": "second", 1: "one", events: 50 },
    ];

    render(<DataTable columns={columnsFor(names)} data={data} />);

    expect(screen.getByText("firewall-01")).toBeTruthy();
    expect(screen.getByText("switch-01")).toBeTruthy();
    expect(screen.getByText("first")).toBeTruthy();
    expect(screen.getAllByText("one")).toHaveLength(4);
    expect(screen.queryAllByText("NULL")).toHaveLength(0);
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "device.name",
      "a[0]",
      "1",
      "1#2",
      "events",
    ]);
  });
});
