import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/mocks/server";
import {
  approveAction,
  deleteCredential,
  getAction,
  getCatalog,
  getCredential,
  isTerminal,
  listActions,
  previewAction,
  proposeAction,
  rejectAction,
  rollbackAction,
  runAction,
  setCredential,
} from "./remediation";

function capture(data: unknown): Array<{ method: string; path: string; params: Record<string, string>; body: unknown }> {
  const seen: Array<{ method: string; path: string; params: Record<string, string>; body: unknown }> = [];
  server.use(
    http.all("/api/remediation/*", async ({ request }) => {
      const url = new URL(request.url);
      const text = request.method === "GET" || request.method === "DELETE" ? "" : await request.text();
      seen.push({ method: request.method, path: url.pathname, params: Object.fromEntries(url.searchParams), body: text ? JSON.parse(text) : undefined });
      return HttpResponse.json({ success: true, data });
    }),
  );
  return seen;
}

describe("remediation API", () => {
  it("lists actions with a comma-joined status filter", async () => {
    const seen = capture({ actions: [{ id: "a1" }] });
    expect(await listActions({ connectionId: "c1", status: ["proposed", "approved"] })).toEqual([{ id: "a1" }]);
    expect(seen[0].params).toEqual({ connectionId: "c1", status: "proposed,approved" });
  });

  it("proposes, decides and executes through the action endpoints", async () => {
    const seen = capture({ id: "a1" });
    await getCatalog();
    await getAction("a1");
    await previewAction({ type: "kill_query", queryId: "q1" });
    await proposeAction({ connectionId: "c1", params: { type: "kill_query", queryId: "q1" }, rationale: "runaway" });
    await approveAction("a1", "ok");
    await rejectAction("a1");
    await runAction("a1");
    await rollbackAction("a1");
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      "GET /api/remediation/catalog",
      "GET /api/remediation/actions/a1",
      "POST /api/remediation/actions/preview",
      "POST /api/remediation/actions",
      "POST /api/remediation/actions/a1/approve",
      "POST /api/remediation/actions/a1/reject",
      "POST /api/remediation/actions/a1/run",
      "POST /api/remediation/actions/a1/rollback",
    ]);
    expect(seen[4].body).toEqual({ comment: "ok" });
    expect(seen[5].body).toEqual({ comment: null });
  });

  it("manages the remediation credential", async () => {
    const seen = capture({ configured: true, username: "fixer", updatedAt: 1 });
    expect(await getCredential("c1")).toMatchObject({ configured: true });
    await setCredential("c1", "fixer", "secret");
    await deleteCredential("c1");
    expect(seen.map((s) => s.method)).toEqual(["GET", "PUT", "DELETE"]);
    expect(seen[1].body).toEqual({ username: "fixer", password: "secret" });
  });

  it("knows terminal states", () => {
    expect(isTerminal("verified")).toBe(true);
    expect(isTerminal("rejected")).toBe(true);
    expect(isTerminal("approved")).toBe(false);
    expect(isTerminal("executing")).toBe(false);
  });
});
