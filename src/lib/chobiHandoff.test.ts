import { describe, expect, it } from "vitest";

import { HANDOFF_MESSAGE_MAX, HANDOFF_NOTE_MAX, handoffMarkdown, handoffMessage, type HandoffInput } from "./chobiHandoff";

const INPUT: HandoffInput = {
  title: "Orders are late",
  connection: "prod",
  at: new Date("2026-10-24T22:15:00Z"),
  messages: [
    { role: "user", content: "Why is shop.orders\nlate?", attachments: ["incident.json"] },
    { role: "assistant", content: "Looking." },
    { role: "user", content: "Can you rerun the loader?" },
    { role: "assistant", content: "The loader failed at 03:10 on a timeout. I reran it; rows are flowing again." },
  ],
  actions: [
    { title: "Run a scheduled job now", description: "Run job loader now", status: "executed", undone: false },
    { title: "Save a query", description: "Save the query 'check'", status: "executed", undone: true },
  ],
};

describe("handoffMarkdown", () => {
  it("leads with what was asked, where it landed and what changed", () => {
    const md = handoffMarkdown(INPUT);
    expect(md.startsWith("# Handoff: Orders are late\n\n_From Chobi, 2026-10-24 22:15 UTC · connection prod._")).toBe(true);
    expect(md).toContain("## What was asked\n- Why is shop.orders late?\n- Can you rerun the loader?");
    expect(md).toContain("## Where it landed\nThe loader failed at 03:10 on a timeout. I reran it; rows are flowing again.");
    expect(md).toContain("- **Run a scheduled job now** — executed: Run job loader now");
    expect(md).toContain("- **Save a query** — undone:");
    expect(md).toContain("**Asked:** Why is shop.orders\nlate? _(attached: incident.json)_");
  });

  it("fits a notebook note, and says when it was cut", () => {
    const long = handoffMarkdown({ ...INPUT, messages: [{ role: "assistant", content: "x".repeat(HANDOFF_NOTE_MAX * 2) }] });
    expect(long.length).toBeLessThanOrEqual(HANDOFF_NOTE_MAX);
    expect(long.endsWith("(cut for length)")).toBe(true);
  });

  it("leaves out sections it has nothing for", () => {
    const md = handoffMarkdown({ ...INPUT, connection: null, messages: [], actions: [] });
    expect(md).toBe("# Handoff: Orders are late\n\n_From Chobi, 2026-10-24 22:15 UTC._");
  });
});

describe("handoffMessage", () => {
  it("is short: the answer, the changes and the connection", () => {
    expect(handoffMessage(INPUT)).toEqual({
      title: "Handoff: Orders are late",
      text: "The loader failed at 03:10 on a timeout. I reran it; rows are flowing again.\n\nChanges made:\n• Run a scheduled job now — executed\n• Save a query — undone\n\nConnection: prod",
    });
  });

  it("fits a channel message", () => {
    const message = handoffMessage({ ...INPUT, messages: [{ role: "assistant", content: "y".repeat(10_000) }], actions: [] });
    expect(message.text.length).toBeLessThanOrEqual(HANDOFF_MESSAGE_MAX);
    expect(handoffMessage({ ...INPUT, messages: [], actions: [], connection: null }).text).toBe("No answer yet.");
  });
});
