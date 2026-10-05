import { describe, expect, it } from "vitest";

import { applyContextDraft } from "./contextDraft";

const DRAFT = { description: "One row per order.", grain: "one row per order", owner: null, insteadOf: "shop.orders_v2", deprecated: true, tags: ["finance", "orders"] };

describe("applyContextDraft", () => {
  it("fills every empty field", () => {
    const result = applyContextDraft({ description: "", grain: null, owner: "", insteadOf: "", deprecated: false, tags: [] }, "", DRAFT);
    expect(result.form).toMatchObject({ description: "One row per order.", grain: "one row per order", owner: "", insteadOf: "shop.orders_v2", deprecated: true });
    expect(result.tags).toBe("finance, orders");
    expect(result.filled).toEqual(["description", "grain", "insteadOf", "tags", "deprecated"]);
  });

  it("never overwrites what a person wrote", () => {
    const form = { description: "Written by hand", grain: "  ", owner: "data-team", insteadOf: "", deprecated: false, tags: [] };
    const result = applyContextDraft(form, "pii", { ...DRAFT, owner: "someone-else", deprecated: false });
    expect(result.form.description).toBe("Written by hand");
    expect(result.form.owner).toBe("data-team");
    expect(result.form.grain).toBe("one row per order");
    expect(result.tags).toBe("pii");
    expect(result.filled).toEqual(["grain", "insteadOf"]);
  });

  it("fills nothing when the draft is empty", () => {
    const empty = { description: null, grain: null, owner: null, insteadOf: null, deprecated: false, tags: [] };
    const form = { description: "", grain: "", owner: "", insteadOf: "", deprecated: false, tags: [] };
    expect(applyContextDraft(form, "", empty)).toEqual({ form, tags: "", filled: [] });
  });
});
