/**
 * /api/ai-actions (ADR 0024 §Phase 2): who sees which actions, and how a
 * background proposal is approved (run once, as the approver), edited, or
 * rejected; chat actions are refused here because their run waits in chat.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../rbac/db";
import { runMigrations } from "../rbac/db/migrations";
import * as h from "../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../rbac/services/jwt";
import { errorHandler } from "../middleware/error";
import { registerInProcessApi } from "../services/ai/registry/inProcessApi";
import { createAction, getAction } from "../services/ai/actions/store";
import aiActions from "./ai-actions";

const ALICE = "actions-alice";
const BOB = "actions-bob";
const kills: Array<{ queryId: string; auth: string | undefined }> = [];

async function token(sub: string, permissions: string[]): Promise<string> {
  return generateAccessToken({ sub, email: `${sub}@test.local`, username: sub, roles: ["custom"], permissions, sessionId: "s1" });
}

function app(): Hono {
  const a = new Hono();
  a.onError(errorHandler);
  a.route("/ai-actions", aiActions);
  return a;
}

async function call<T>(method: string, path: string, bearer: string, body?: unknown): Promise<{ status: number; data: T; error?: { message: string; code?: string } }> {
  const res = await app().request(path, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as { data: T; error?: { message: string; code?: string } };
  return { status: res.status, data: json.data, error: json.error };
}

type View = { id: string; status: string; title: string; risk: string; canDecide: boolean; args: Record<string, unknown>; error: string | null };

beforeAll(async () => {
  await h.freshDatabase("sqlite");
  await runMigrations({ skipSeed: true });
  for (const id of [ALICE, BOB]) {
    await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at)
      VALUES (${id}, ${`${id}@test.local`}, ${id}, 'x', 1, unixepoch(), unixepoch())`);
  }
  const api = new Hono();
  api.post("/api/live-queries/kill", async (c) => {
    const body = (await c.req.json()) as { queryId: string };
    kills.push({ queryId: body.queryId, auth: c.req.header("Authorization") });
    if (body.queryId === "denied") return c.json({ success: false, error: { message: "Permission denied" } }, 403);
    return c.json({ success: true, data: { killed: true } });
  });
  registerInProcessApi(api);
}, 60_000);

afterAll(async () => {
  await closeDatabase();
});

const background = (userId: string, queryId = "q1") => createAction({
  source: "background", userId, connectionId: "conn-1", tool: "kill_query", args: { queryId }, description: `KILL ${queryId}`,
});

describe("/api/ai-actions", () => {
  it("needs an AI permission", async () => {
    expect((await call("GET", "/ai-actions", await token(ALICE, []))).status).toBe(403);
  });

  it("shows a user their own actions, and an actor every background proposal", async () => {
    const own = await background(ALICE);
    const others = await background(BOB);
    const chat = await createAction({ source: "chat", runId: "run-1", userId: ALICE, tool: "kill_query", args: { queryId: "q2" }, description: "KILL q2" });

    const alice = await call<{ canAct: boolean; actions: View[] }>("GET", "/ai-actions", await token(ALICE, ["ai:chat"]));
    expect(alice.data.canAct).toBe(false);
    const ids = alice.data.actions.map((a) => a.id);
    expect(ids).toContain(own.id);
    expect(ids).toContain(chat.id);
    expect(ids).not.toContain(others.id);
    const ownView = alice.data.actions.find((a) => a.id === own.id);
    expect(ownView).toMatchObject({ title: "Kill a query", risk: "low", canDecide: true, userName: ALICE, decidedByName: null });
    expect(alice.data.actions.find((a) => a.id === chat.id)?.canDecide).toBe(false);

    const actor = await call<{ canAct: boolean; actions: View[] }>("GET", "/ai-actions?status=pending", await token(ALICE, ["ai:chat", "ai:act"]));
    expect(actor.data.canAct).toBe(true);
    expect(actor.data.actions.map((a) => a.id)).toContain(others.id);
    expect(actor.data.actions.every((a) => a.status === "pending")).toBe(true);

    const count = await call<{ count: number }>("GET", "/ai-actions/pending-count", await token(ALICE, ["ai:chat"]));
    expect(count.data.count).toBeGreaterThanOrEqual(2);
  });

  it("refuses approval without ai:act, and refuses chat actions here", async () => {
    const action = await background(ALICE);
    expect((await call("POST", `/ai-actions/${action.id}/approve`, await token(ALICE, ["ai:chat"]), {})).status).toBe(403);
    const chat = await createAction({ source: "chat", runId: "run-2", userId: ALICE, tool: "kill_query", args: { queryId: "q3" }, description: "KILL q3" });
    expect((await call("POST", `/ai-actions/${chat.id}/approve`, await token(ALICE, ["ai:act"]), {})).status).toBe(409);
    expect((await call("POST", "/ai-actions/missing/approve", await token(ALICE, ["ai:act"]), {})).status).toBe(404);
  });

  it("runs an approved proposal once, as the approver, and refuses a second answer", async () => {
    kills.length = 0;
    const action = await background(BOB, "q-approve");
    const bearer = await token(ALICE, ["ai:act"]);
    const approved = await call<View>("POST", `/ai-actions/${action.id}/approve`, bearer, {});
    expect(approved.status).toBe(200);
    expect(approved.data.status).toBe("executed");
    expect(kills).toEqual([{ queryId: "q-approve", auth: `Bearer ${bearer}` }]);
    expect((await call("POST", `/ai-actions/${action.id}/approve`, bearer, {})).status).toBe(409);
    expect(kills).toHaveLength(1);
  });

  it("runs the edited arguments, and rejects invalid edits", async () => {
    kills.length = 0;
    const action = await background(BOB, "q-orig");
    const bearer = await token(ALICE, ["ai:act"]);
    const bad = await call("POST", `/ai-actions/${action.id}/approve`, bearer, { args: { queryId: "" } });
    expect(bad.status).toBe(400);
    expect((await getAction(action.id))?.status).toBe("pending");
    const edited = await call<View>("POST", `/ai-actions/${action.id}/approve`, bearer, { args: { queryId: "q-edit" } });
    expect(edited.data).toMatchObject({ status: "executed", args: { queryId: "q-edit" } });
    expect(kills.map((k) => k.queryId)).toEqual(["q-edit"]);
  });

  it("records a failure when the action is refused downstream", async () => {
    const action = await background(BOB, "denied");
    const failed = await call<View>("POST", `/ai-actions/${action.id}/approve`, await token(ALICE, ["ai:act"]), {});
    expect(failed.status).toBe(200);
    expect(failed.data.status).toBe("failed");
    expect(failed.data.error).toContain("Permission denied");
  });

  it("lets the owner or an actor reject, but not another user", async () => {
    const action = await background(BOB);
    expect((await call("POST", `/ai-actions/${action.id}/reject`, await token(ALICE, ["ai:chat"]), {})).status).toBe(403);
    const rejected = await call<View>("POST", `/ai-actions/${action.id}/reject`, await token(BOB, ["ai:chat"]), { message: "not now" });
    expect(rejected.data.status).toBe("rejected");
  });

  it("refuses an expired proposal", async () => {
    const action = await createAction({ source: "background", userId: ALICE, tool: "kill_query", args: { queryId: "q" }, description: "KILL q", expiresAt: Date.now() - 1 });
    const res = await call("POST", `/ai-actions/${action.id}/approve`, await token(ALICE, ["ai:act"]), {});
    expect(res.status).toBe(410);
    expect(res.error?.code).toBe("APPROVAL_EXPIRED");
  });
});
