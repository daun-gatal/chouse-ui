/**
 * CHouse management tools against the real API router (ADR 0019 §9): the
 * in-process client must pass API protection and JWT auth, and the route's own
 * permission check must decide — the tool can never see more than the user.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { closeDatabase } from "../../../rbac/db";
import { runMigrations } from "../../../rbac/db/migrations";
import { freshDatabase, rawRun } from "../../../rbac/db/migrationTestHarness";
import { generateAccessToken } from "../../../rbac/services/jwt";
import { errorHandler } from "../../../middleware/error";
import api from "../../../routes";
import { buildGrantedTools } from "./catalog";
import { registerInProcessApi } from "./inProcessApi";

const USER = "in-process-user";

async function token(roles: string[], permissions: string[]): Promise<string> {
  return generateAccessToken({ sub: USER, email: "ip@test.local", username: "inprocess", roles, permissions, sessionId: "s1" });
}

beforeAll(async () => {
  process.env.RBAC_ENCRYPTION_KEY ||= "e2e0000000000000000000000000000000000000000000000000000000000000";
  process.env.RBAC_ENCRYPTION_SALT ||= "e2e1111111111111111111111111111111111111111111111111111111111111";
  await freshDatabase("sqlite");
  await runMigrations();
  await rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES (${USER}, 'ip@test.local', 'inprocess', 'x', 1, unixepoch(), unixepoch())`);
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/api", api);
  registerInProcessApi(app);
});

afterAll(async () => {
  registerInProcessApi(new Hono());
  await closeDatabase();
});

describe("management tools through the real API", () => {
  it("whoami answers with the caller's own profile", async () => {
    const [whoami] = buildGrantedTools(["whoami"], { ctx: { bearerToken: await token(["custom"], []), permissions: [] } });
    const result = (await whoami.invoke({})) as Record<string, unknown>;
    expect(result.error).toBeUndefined();
    expect(JSON.stringify(result)).toContain("inprocess");
  });

  it("lists users when the caller may, and returns the route's refusal when not", async () => {
    const allowed = buildGrantedTools(["list_users"], { ctx: { bearerToken: await token(["custom"], ["users:view"]), permissions: ["users:view"] } });
    const rows = (await allowed[0].invoke({})) as { rows?: Array<{ username: string }>; error?: string };
    expect(rows.error).toBeUndefined();
    expect(rows.rows?.some((u) => u.username === "inprocess")).toBe(true);

    // The catalog would not even offer the tool; force-build it the way an admin
    // (who sees every tool) would, but call with a token lacking the permission.
    const forced = buildGrantedTools(["list_users"], { ctx: { bearerToken: await token(["custom"], []), isAdmin: true } });
    const refused = (await forced[0].invoke({})) as { error?: string };
    expect(refused.error).toMatch(/permission/i);
  });
});
