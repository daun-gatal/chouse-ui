import { beforeEach, describe, expect, it } from "bun:test";

import { CREATE_RECHECK_MS, createCheckFailure, createCheckStatement, ensureCreateChecked, resetCreateChecks, runSelfTest } from "./selfTest";

function chError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code: String(code) });
}

const DENIED_CREATE = chError(497, "svc: Not enough privileges. To execute this query, it's necessary to have the grant CREATE DATABASE ON system.*. (ACCESS_DENIED)");

/** A server as 26.3.63.123 answers the four statements, with one answer replaced per case. */
function server(over: Record<string, string | Error> = {}): { send: (query: string) => Promise<string>; asked: string[] } {
  const asked: string[] = [];
  const answers: Record<string, string | Error> = {
    "EXECUTE AS `svc` SELECT 1": "1\n",
    "EXECUTE AS `svc` CREATE DATABASE IF NOT EXISTS system": DENIED_CREATE,
    "EXECUTE AS `svc` SELECT 1 AS a FORMAT JSONEachRow": '{"a":1}\n',
    "EXECUTE AS `svc` EXECUTE AS `svc` SELECT 1": chError(62, "Syntax error: failed at position 18 (EXECUTE)"),
    ...over,
  };
  return {
    asked,
    async send(query: string): Promise<string> {
      asked.push(query);
      const answer = answers[query];
      if (answer === undefined) throw new Error(`unexpected statement ${query}`);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}
const failing = async (over: Record<string, string | Error>): Promise<string[]> => (await runSelfTest(server(over).send, "svc")).filter((check) => !check.ok).map((check) => check.id);

describe("the self-test of a personal connection (ADR 0033 §7.1)", () => {
  it("passes a server that answers the four statements as 26.3.63 does", async () => {
    const { send, asked } = server();
    const checks = await runSelfTest(send, "svc");
    expect(checks.map((check) => [check.id, check.ok])).toEqual([["impersonation", true], ["create_checked", true], ["format", true], ["no_nesting", true]]);
    expect(asked).toHaveLength(4);
  });

  it("fails a build that runs CREATE under EXECUTE AS without checking grants (26.5.7)", async () => {
    expect(await failing({ "EXECUTE AS `svc` CREATE DATABASE IF NOT EXISTS system": "" })).toEqual(["create_checked"]);
  });

  it("does not take another refusal of the CREATE for the access check", async () => {
    expect(await failing({ "EXECUTE AS `svc` CREATE DATABASE IF NOT EXISTS system": chError(497, "svc: Not enough privileges. To execute this query, it's necessary to have the grant IMPERSONATE ON svc. (ACCESS_DENIED)") })).toContain("create_checked");
    expect(await failing({ "EXECUTE AS `svc` CREATE DATABASE IF NOT EXISTS system": chError(159, "Timeout exceeded") })).toEqual(["create_checked"]);
    expect(await failing({ "EXECUTE AS `svc` CREATE DATABASE IF NOT EXISTS system": new Error("socket hang up") })).toEqual(["create_checked"]);
  });

  it("names the missing grant when the role may not act as the login, and a server without EXECUTE AS", async () => {
    const lacking = await runSelfTest(server({ "EXECUTE AS `svc` SELECT 1": chError(497, "svc: Not enough privileges. To execute this query, it's necessary to have the grant IMPERSONATE ON svc.") }).send, "svc");
    expect(lacking[0]).toMatchObject({ id: "impersonation", ok: false });
    expect(lacking[0].detail).toContain("GRANT IMPERSONATE ON svc");
    const old = await runSelfTest(server({ "EXECUTE AS `svc` SELECT 1": chError(62, "Syntax error: failed at position 1 (EXECUTE)") }).send, "svc");
    expect(old[0].detail).toContain("does not know EXECUTE AS");
  });

  it("fails a wrong value, an ignored FORMAT, and nesting that runs or fails another way", async () => {
    expect(await failing({ "EXECUTE AS `svc` SELECT 1": "2\n" })).toEqual(["impersonation"]);
    expect(await failing({ "EXECUTE AS `svc` SELECT 1 AS a FORMAT JSONEachRow": "1\n" })).toEqual(["format"]);
    expect(await failing({ "EXECUTE AS `svc` EXECUTE AS `svc` SELECT 1": "1\n" })).toEqual(["no_nesting"]);
    expect(await failing({ "EXECUTE AS `svc` EXECUTE AS `svc` SELECT 1": chError(497, "denied") })).toEqual(["no_nesting"]);
  });

  it("the statement has no side effect even on a build that skips the check", () => {
    expect(createCheckStatement("svc")).toBe("EXECUTE AS `svc` CREATE DATABASE IF NOT EXISTS system");
  });
});

describe("the CREATE re-check before a statement runs as a person", () => {
  beforeEach(() => resetCreateChecks());
  const NOW = 1_800_000_000_000;

  it("asks once and remembers a pass for a minute, per connection", async () => {
    const { send, asked } = server();
    await ensureCreateChecked("c1", send, "svc", NOW);
    await ensureCreateChecked("c1", send, "svc", NOW + CREATE_RECHECK_MS - 1);
    expect(asked).toHaveLength(1);
    await ensureCreateChecked("c2", send, "svc", NOW);
    expect(asked).toHaveLength(2);
    await ensureCreateChecked("c1", send, "svc", NOW + CREATE_RECHECK_MS);
    expect(asked).toHaveLength(3);
  });

  it("throws on a build that stopped checking, and never remembers a failure", async () => {
    const good = server();
    await ensureCreateChecked("c1", good.send, "svc", NOW);
    const bad = server({ "EXECUTE AS `svc` CREATE DATABASE IF NOT EXISTS system": "" });
    // Still inside the minute: the remembered pass lets it through; after it, the upgraded server is caught.
    await ensureCreateChecked("c1", bad.send, "svc", NOW + 1000);
    await expect(ensureCreateChecked("c1", bad.send, "svc", NOW + CREATE_RECHECK_MS)).rejects.toThrow("without checking the user's grants");
    await expect(ensureCreateChecked("c1", bad.send, "svc", NOW + CREATE_RECHECK_MS + 1)).rejects.toThrow();
    expect(bad.asked).toHaveLength(2);
    expect(await createCheckFailure(good.send, "svc")).toBeNull();
  });
});
