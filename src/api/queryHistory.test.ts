import { describe, expect, it } from "vitest";

import { clearQueryHistory, deleteQueryHistoryItem, getQueryHistory, recordQueryHistory } from "./queryHistory";

const item = {
  id: "history-2",
  query: "SELECT count() FROM system.tables",
  connectionId: "conn-1",
  connectionName: "Production",
  executedAt: 1_700_000_000_100,
  durationMs: 20,
  rows: 1,
  status: "success" as const,
};

describe("Query History API", () => {
  it("loads persisted history", async () => {
    const history = await getQueryHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: "history-1", query: "SELECT 1" });
  });

  it("records an execution", async () => {
    await expect(recordQueryHistory(item)).resolves.toEqual(item);
  });

  it("deletes one item or all items", async () => {
    await expect(deleteQueryHistoryItem("history/2")).resolves.toBeUndefined();
    await expect(clearQueryHistory()).resolves.toBeUndefined();
  });
});
