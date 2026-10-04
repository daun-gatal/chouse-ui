import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { closeDatabase } from "../../rbac/db";
import { runMigrations } from "../../rbac/db/migrations";
import { sql } from "drizzle-orm";

import { freshDatabase, rawRun } from "../../rbac/db/migrationTestHarness";
import * as scheduledStore from "../scheduledQueries/store";
import { approveAction, executeAction, inWindow, parseWindow, proposeAction, rejectAction, rollbackAction, verifyAction, RemediationError, type Actor } from "./executor";
import * as store from "./store";

const approver: Actor = { id: "approver-1", roles: ["admin"], permissions: ["remediation:approve", "remediation:approve_high"] };
const approver2: Actor = { id: "approver-2", roles: ["admin"], permissions: ["remediation:approve", "remediation:approve_high"] };
const proposer: Actor = { id: "proposer-1", roles: ["developer"], permissions: ["remediation:propose"] };
const lowApprover: Actor = { id: "low-1", roles: ["custom"], permissions: ["remediation:approve"] };

async function job(): Promise<string> {
  return scheduledStore.createJob({
    name: "finance_export", description: null, connectionId: "conn-1", query: "SELECT 1", enabled: true, frequency: "daily", hour: 12,
    dayOfWeek: 1, dayOfMonth: 1, cronExpr: null, timezone: "UTC", outputMode: "none", destDatabase: null, destTable: null, outputConfig: null,
    maxRows: 10, timeoutSecs: 60, useFinal: false, seqConsistency: false, maxAttempts: 1, retentionDays: 30,
  }, null);
}

beforeEach(async () => {
  await freshDatabase("sqlite");
  await runMigrations();
  for (const id of ["approver-1", "approver-2", "proposer-1", "low-1"]) {
    await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${id}, ${`${id}@test.local`}, ${id}, 'x', 1, unixepoch(), unixepoch())`);
  }
});

afterEach(async () => {
  await closeDatabase();
});

describe("remediation lifecycle", () => {
  it("rejects parameters outside the catalog", async () => {
    await expect(proposeAction({ connectionId: "conn-1", params: { type: "drop_everything" }, proposedBy: proposer.id, proposedSource: "user" })).rejects.toBeInstanceOf(RemediationError);
    await expect(proposeAction({ connectionId: "conn-1", params: { type: "restart_replica", database: "a;b", table: "t" }, proposedBy: proposer.id, proposedSource: "user" })).rejects.toThrow();
  });

  it("class 1: one approver; a human proposer may self-approve, AI proposals may not", async () => {
    const jobId = await job();
    const human = await proposeAction({ connectionId: "conn-1", params: { type: "pause_scheduled_job", jobId }, proposedBy: approver.id, proposedSource: "user" });
    expect(human.approvalClass).toBe(1);
    const outcome = await approveAction(human.id, approver, "ui", null);
    expect(outcome.action.status).toBe("approved");

    const ai = await proposeAction({ connectionId: "conn-1", params: { type: "pause_scheduled_job", jobId }, proposedBy: approver.id, proposedSource: "ai" });
    await expect(approveAction(ai.id, approver, "ui", null)).rejects.toThrow("proposer cannot approve");
    expect((await approveAction(ai.id, approver2, "slack", null)).action.status).toBe("approved");
  });

  it("class 2: needs approve_high and two approvers other than the proposer", async () => {
    const action = await proposeAction({ connectionId: "conn-1", params: { type: "restart_replica", database: "shop", table: "orders" }, proposedBy: proposer.id, proposedSource: "user" });
    expect(action.approvalClass).toBe(2);
    await expect(approveAction(action.id, lowApprover, "ui", null)).rejects.toThrow("remediation:approve_high");
    const first = await approveAction(action.id, approver, "ui", null);
    expect(first.action.status).toBe("proposed");
    expect(first.approvalsGiven).toBe(1);
    // Approving twice as the same person does not count twice.
    expect((await approveAction(action.id, approver, "ui", null)).approvalsGiven).toBe(1);
    expect((await approveAction(action.id, approver2, "cli", null)).action.status).toBe("approved");
  });

  it("executes internal job actions, verifies them and rolls back", async () => {
    const jobId = await job();
    const action = await proposeAction({ connectionId: "conn-1", params: { type: "pause_scheduled_job", jobId }, proposedBy: approver.id, proposedSource: "user" });
    await approveAction(action.id, approver, "ui", null);
    const executed = await executeAction(action.id);
    expect(executed.status).toBe("executed");
    expect((await scheduledStore.getJob(jobId))?.enabled).toBe(false);
    expect(await verifyAction(executed)).toBe(true);
    expect((await store.getAction(action.id))?.status).toBe("verified");
    const rolled = await rollbackAction(action.id, approver);
    expect(rolled.status).toBe("rolled_back");
    expect((await scheduledStore.getJob(jobId))?.enabled).toBe(true);
  });

  it("refuses to execute unapproved or rejected actions and SQL without a remediation credential", async () => {
    const jobId = await job();
    const pending = await proposeAction({ connectionId: "conn-1", params: { type: "pause_scheduled_job", jobId }, proposedBy: approver.id, proposedSource: "user" });
    await expect(executeAction(pending.id)).rejects.toThrow("only approved actions run");
    const rejected = await rejectAction(pending.id, approver, "ui", "not now");
    expect(rejected.status).toBe("rejected");
    await expect(approveAction(pending.id, approver, "ui", null)).rejects.toThrow("only proposed actions");

    const sqlAction = await proposeAction({ connectionId: "conn-1", params: { type: "kill_query", queryId: "q-1" }, proposedBy: approver.id, proposedSource: "user" });
    await approveAction(sqlAction.id, approver, "ui", null);
    await expect(executeAction(sqlAction.id)).rejects.toThrow();
    expect((await store.getAction(sqlAction.id))?.status).toBe("failed");
  });
});

describe("maintenance window", () => {
  it("parses HH:MM-HH:MM and wraps midnight", () => {
    expect(parseWindow("02:00-04:00")).toEqual({ start: 120, end: 240 });
    expect(parseWindow(undefined)).toEqual({ start: 120, end: 240 });
    const wrap = parseWindow("23:00-01:00");
    expect(inWindow(Date.UTC(2026, 0, 1, 23, 30), wrap)).toBe(true);
    expect(inWindow(Date.UTC(2026, 0, 1, 0, 30), wrap)).toBe(true);
    expect(inWindow(Date.UTC(2026, 0, 1, 12, 0), wrap)).toBe(false);
  });
});
