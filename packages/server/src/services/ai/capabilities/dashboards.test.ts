import { describe, expect, it } from "bun:test";

import { PERMISSIONS } from "../../../rbac/schema/base";
import { draftDashboardCapability } from "./dashboards";

const REQUEST = { goal: "Watch the orders pipeline", connectionId: "c1", existing: null };
const CTX = { userId: "u1", permissions: [PERMISSIONS.DASHBOARDS_EDIT], connectionId: "c1" };
const PREVIOUS = { title: "Orders", description: "", variables: [], panels: [{ title: "Parts", sql: "SELECT 1", viz: {}, role: "trend", importance: "primary", section: null, rationale: "x", included: true }] };

describe("draftDashboardCapability.prepare", () => {
  it("drafts for an editor on the connection the request names", () => {
    expect(draftDashboardCapability.prepare(REQUEST, CTX)).toEqual(REQUEST);
    expect(() => draftDashboardCapability.prepare(REQUEST, { ...CTX, permissions: [] })).toThrow("dashboards:edit");
    expect(() => draftDashboardCapability.prepare(REQUEST, { ...CTX, connectionId: "c2" })).toThrow("Draft on the connection you are on");
  });

  it("takes a revision only when it says what to change, or names a panel of the draft to regenerate", () => {
    const refine = { ...REQUEST, revision: { previous: PREVIOUS, feedback: "Add disk usage", panelIndex: null } };
    expect(draftDashboardCapability.prepare(refine, CTX)).toEqual(refine);
    expect(draftDashboardCapability.prepare({ ...REQUEST, revision: { previous: PREVIOUS, feedback: "", panelIndex: 0 } }, CTX).revision?.panelIndex).toBe(0);
    expect(() => draftDashboardCapability.prepare({ ...REQUEST, revision: { previous: PREVIOUS, feedback: "", panelIndex: null } }, CTX)).toThrow("Say what to change");
    expect(() => draftDashboardCapability.prepare({ ...REQUEST, revision: { previous: PREVIOUS, feedback: "", panelIndex: 3 } }, CTX)).toThrow("not in the draft");
  });
});
