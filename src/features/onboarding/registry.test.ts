import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { RBAC_PERMISSIONS } from "@/stores";

import {
  AUTHENTICATED_ROUTE_INVENTORY,
  NON_GUIDED_ROUTE_INVENTORY,
  ONBOARDING_CHAPTERS,
  REQUIRED_ONBOARDING_SURFACES,
  getEligibleChapters,
} from "./registry";

describe("onboarding registry", () => {
  it("covers every declared nested product surface exactly once", () => {
    const stepIds = ONBOARDING_CHAPTERS.flatMap((chapter) => chapter.steps.map((step) => step.id));
    expect(new Set(stepIds).size).toBe(stepIds.length);
    expect([...stepIds].sort()).toEqual([...REQUIRED_ONBOARDING_SURFACES].sort());
  });

  it("classifies every route declared by App", () => {
    const appPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../App.tsx");
    const appSource = readFileSync(appPath, "utf8");
    const declaredRoutes = Array.from(appSource.matchAll(/<Route[\s\S]*?path="([^"]+)"/g), (match) => match[1]);
    const classifiedRoutes = [
      ...AUTHENTICATED_ROUTE_INVENTORY,
      ...NON_GUIDED_ROUTE_INVENTORY,
    ];

    expect([...new Set(declaredRoutes)].sort()).toEqual([...classifiedRoutes].sort());
  });

  it("removes inaccessible chapters and inaccessible steps", () => {
    const chapters = getEligibleChapters({
      permissions: [RBAC_PERMISSIONS.LOGS_VIEW],
      hasConnection: true,
    });

    expect(chapters.map((chapter) => chapter.id)).toEqual(["shell", "overview", "monitoring", "preferences"]);
    const monitoring = chapters.find((chapter) => chapter.id === "monitoring");
    expect(monitoring?.steps.every((step) => step.id.startsWith("monitoring.logs."))).toBe(true);
  });

  it("makes the entire documented surface eligible for a fully privileged user", () => {
    const chapters = getEligibleChapters({
      permissions: Object.values(RBAC_PERMISSIONS),
      hasConnection: true,
    });
    const stepIds = chapters.flatMap((chapter) => chapter.steps.map((step) => step.id));

    expect(stepIds.sort()).toEqual([...REQUIRED_ONBOARDING_SURFACES].sort());
  });

  it("gives every Monitoring sub-view a routable guide state and precise target", () => {
    const monitoring = ONBOARDING_CHAPTERS.find((chapter) => chapter.id === "monitoring");
    const nestedSteps = monitoring?.steps.filter((step) => step.id !== "monitoring.live-queries") ?? [];

    expect(nestedSteps).toHaveLength(29);
    expect(nestedSteps.every((step) => step.route.includes("?guide="))).toBe(true);
    expect(nestedSteps.every((step) => step.target?.startsWith("monitoring-"))).toBe(true);
    expect(nestedSteps.every((step) => step.target !== "monitoring-content")).toBe(true);
  });

  it("keeps Doctor guide states on the base page and targets precise controls", () => {
    const doctorSteps = ONBOARDING_CHAPTERS
      .find((chapter) => chapter.id === "fleet")
      ?.steps.filter((step) => step.id.startsWith("doctor.")) ?? [];

    expect(doctorSteps).toHaveLength(4);
    expect(doctorSteps.map((step) => step.route)).toEqual([
      "/doctor?guide=doctor-run",
      "/doctor?guide=doctor-history",
      "/doctor?guide=doctor-report",
      "/doctor?guide=doctor-schedule",
    ]);
    expect(doctorSteps.every((step) => (step.routeMatch ?? "exact") === "exact")).toBe(true);
    expect(doctorSteps.map((step) => step.target)).toEqual([
      "doctor-run",
      "doctor-history",
      "doctor-report",
      "doctor-schedule",
    ]);
  });

  it("uses compact DataOps and Admin controls instead of whole-page targets", () => {
    const dataOpsTargets = ONBOARDING_CHAPTERS
      .find((chapter) => chapter.id === "dataops")
      ?.steps.map((step) => step.target) ?? [];
    const adminTargets = ONBOARDING_CHAPTERS
      .find((chapter) => chapter.id === "admin")
      ?.steps.filter((step) => step.id !== "admin.user-create")
      .map((step) => step.target) ?? [];

    expect(dataOpsTargets.every((target) => target?.startsWith("dataops-") && target !== "dataops-content")).toBe(true);
    expect(adminTargets.every((target) => target?.startsWith("admin-section-") && target !== "admin-content")).toBe(true);
  });

  it("hides connection-bound chapters until a connection is active", () => {
    const chapters = getEligibleChapters({
      permissions: Object.values(RBAC_PERMISSIONS),
      hasConnection: false,
    });
    const chapterIds = chapters.map((chapter) => chapter.id);
    const fleetStepIds = chapters
      .find((chapter) => chapter.id === "fleet")
      ?.steps.map((step) => step.id) ?? [];
    const dataOpsStepIds = chapters
      .find((chapter) => chapter.id === "dataops")
      ?.steps.map((step) => step.id) ?? [];

    expect(chapterIds).not.toContain("overview");
    expect(chapterIds).not.toContain("explorer");
    expect(chapterIds).not.toContain("monitoring");
    expect(fleetStepIds).toEqual([
      "doctor.run",
      "doctor.history",
      "doctor.report",
      "doctor.schedule",
    ]);
    expect(dataOpsStepIds).not.toContain("dataops.scheduled.wizard");
    expect(dataOpsStepIds).not.toContain("dataops.scheduled.macros");
    expect(dataOpsStepIds).not.toContain("dataops.health.promise-wizard");
    expect(chapterIds).toContain("admin");
  });

  it("shows import guidance only when table insertion is available", () => {
    const chapters = getEligibleChapters({
      permissions: [RBAC_PERMISSIONS.TABLE_CREATE],
      hasConnection: true,
    });
    const explorerStepIds = chapters
      .find((chapter) => chapter.id === "explorer")
      ?.steps.map((step) => step.id) ?? [];

    expect(explorerStepIds).not.toContain("explorer.import");
  });

  it("hides the Fleet chapter from a Fleet-only user without an active connection", () => {
    const chapters = getEligibleChapters({
      permissions: [RBAC_PERMISSIONS.FLEET_VIEW],
      hasConnection: false,
    });

    expect(chapters.map((chapter) => chapter.id)).not.toContain("fleet");
  });
});
