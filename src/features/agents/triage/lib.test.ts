import { describe, expect, it } from "vitest";

import { TRIAGE_TRIGGERS } from "@/api/aiTriage";
import { budgetShare, cooldownLabel, ruleProblems, subjectLink, TRIGGER_HINT, TRIGGER_LABEL } from "./lib";

describe("triage lib", () => {
  it("links every trigger's subject", () => {
    expect(subjectLink("data_health_incident", "a/b")).toBe("/data/incidents/data_health/a%2Fb");
    expect(subjectLink("observe_incident", "i1")).toBe("/data/incidents/observe/i1");
    expect(subjectLink("doctor_report", "r1")).toBe("/doctor/r1");
    expect(subjectLink("scheduled_run_failed", "x")).toBe("/data/scheduled-queries/jobs");
    expect(subjectLink("fleet_alert", "x")).toBe("/fleet");
    expect(TRIAGE_TRIGGERS.every((t) => TRIGGER_LABEL[t] && TRIGGER_HINT[t])).toBe(true);
  });

  it("clamps the budget share", () => {
    expect(budgetShare(500, 1000)).toBe(0.5);
    expect(budgetShare(5000, 1000)).toBe(1);
    expect(budgetShare(-1, 1000)).toBe(0);
    expect(budgetShare(1, 0)).toBe(1);
  });

  it("describes the cooldown", () => {
    expect(cooldownLabel(0)).toBe("Every time");
    expect(cooldownLabel(60)).toBe("Once an hour per connection");
    expect(cooldownLabel(180)).toBe("Once every 3 hours per connection");
    expect(cooldownLabel(15)).toBe("Once every 15 min per connection");
  });

  it("explains invalid limits", () => {
    expect(ruleProblems({ cooldownMinutes: 30, dailyTokenBudget: 50_000 })).toEqual([]);
    expect(ruleProblems({ cooldownMinutes: -1, dailyTokenBudget: 10 })).toHaveLength(2);
    expect(ruleProblems({ cooldownMinutes: 1.5, dailyTokenBudget: 1000 })).toHaveLength(1);
  });
});
