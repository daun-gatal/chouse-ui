import { describe, expect, it } from "vitest";

import { ChannelType } from "@/api/alerting";
import { actorsOf, actorsSummary, ANYONE, classifyEntry, withEntry, withoutEntry } from "./actors";

describe("who can act", () => {
  it("files each typed entry under the right list for its platform", () => {
    expect(classifyEntry(ChannelType.Slack, " U0123ABCD ")).toEqual({ field: "platformUsers", value: "U0123ABCD" });
    expect(classifyEntry(ChannelType.Slack, "S0123ABCD")).toEqual({ field: "platformGroups", value: "S0123ABCD" });
    expect(classifyEntry(ChannelType.Slack, "@ana")).toHaveProperty("error");
    expect(classifyEntry(ChannelType.GoogleChat, "Ana@Example.com")).toEqual({ field: "platformUsers", value: "ana@example.com" });
    expect(classifyEntry(ChannelType.GoogleChat, "example.com")).toEqual({ field: "domains", value: "example.com" });
    expect(classifyEntry(ChannelType.GoogleChat, "ana")).toHaveProperty("error");
    expect(classifyEntry(ChannelType.Telegram, "42424242")).toEqual({ field: "platformUsers", value: "42424242" });
    expect(classifyEntry(ChannelType.Telegram, "@ana")).toHaveProperty("error");
    expect(classifyEntry(ChannelType.Webhook, "x")).toEqual({ error: "This channel has no buttons" });
    expect(classifyEntry(ChannelType.Slack, "  ")).toEqual({ error: "Type an entry first" });
  });

  it("reads a stored list defensively and edits it without duplicates", () => {
    expect(actorsOf({})).toEqual(ANYONE);
    expect(actorsOf({ actors: { mode: "only", roles: ["dba", 3], users: "x" } })).toEqual({ ...ANYONE, mode: "only", roles: ["dba"] });
    const once = withEntry(withEntry(ANYONE, "roles", "dba"), "roles", "dba");
    expect(once.roles).toEqual(["dba"]);
    expect(withoutEntry(once, "roles", "dba").roles).toEqual([]);
  });

  it("summarizes the list", () => {
    expect(actorsSummary(ANYONE)).toBe("Anyone with the permission can act");
    expect(actorsSummary({ ...ANYONE, mode: "only", platformGroups: ["S01"], roles: ["r1"], users: ["u1", "u2"] }, new Map([["r1", "DBA"]]))).toBe("Only S01, Role: DBA, 2 users");
    expect(actorsSummary({ ...ANYONE, mode: "only" })).toBe("Nobody can act (the list is empty)");
  });
});
