import { afterAll, describe, expect, it } from "bun:test";

import type { ConnectionConfig } from "../../types";
import { setExecutorClientForTests } from "./executor";
import { probeKindSupport, supportFrom, supportOf } from "./kindSupport";

function chError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code: String(code) });
}

/** How one ClickHouse build answers the three probe statements (as observed on the pinned builds). */
interface FakeBuild {
  version: string;
  takesRole: boolean;
  executeAs: boolean;
  /** Fail the named probe another way (a timeout, a refused grant). */
  breaks?: "role" | "executeAs" | "version";
}

const asked: Array<{ query: string; role: string | undefined }> = [];

function server(build: FakeBuild): void {
  asked.length = 0;
  setExecutorClientForTests(() => ({
    async query(args: { query: string; role?: string }) {
      asked.push({ query: args.query, role: args.role });
      const answer = ((): string => {
        if (args.query === "SELECT version()") {
          if (build.breaks === "version") throw new Error("connect ECONNREFUSED 10.0.0.1:8123");
          return build.version;
        }
        if (args.query === "SELECT 1") {
          if (build.breaks === "role") throw chError(159, "Timeout exceeded");
          if (!build.takesRole) throw chError(115, "Setting role is neither a builtin setting nor started with the prefix 'SQL_' registered for user-defined settings. (UNKNOWN_SETTING)");
          throw chError(511, `There is no role \`${args.role}\` in user directories. (UNKNOWN_ROLE)`);
        }
        if (args.query.startsWith("EXPLAIN AST EXECUTE AS")) {
          if (build.breaks === "executeAs") throw chError(497, "Not enough privileges");
          if (!build.executeAs) throw chError(62, "Syntax error: failed at position 21 ('AS')");
          return "ExecuteAsQuery (children 2)\n UserNameWithHost (children 1)\n  Identifier chouse_probe_no_such_user";
        }
        throw new Error(`fake server: unexpected statement ${args.query}`);
      })();
      return { query_id: "q", text: async () => answer };
    },
  }));
}

const CONFIG: ConnectionConfig = { url: "http://h:8123", username: "svc", password: "p" };
const states = async (build: FakeBuild): Promise<Record<string, string>> => {
  server(build);
  const support = await probeKindSupport(CONFIG);
  return Object.fromEntries(support.kinds.map((kind) => [kind.kind, kind.state]));
};

describe("which connection kinds a server can run (ADR 0033 §5 to §7)", () => {
  afterAll(() => setExecutorClientForTests(null));

  it("24.3: only a shared login (no role on a request, no EXECUTE AS)", async () => {
    expect(await states({ version: "24.3.18.7", takesRole: false, executeAs: false })).toEqual({ shared: "available", shared_ceiling: "unavailable", personal: "unavailable" });
  });

  it("24.4 and 25.10: a shared login and the role ceiling (a role, but no EXECUTE AS)", async () => {
    for (const version of ["24.4.4.113", "25.10.7.6"]) {
      expect(await states({ version, takesRole: true, executeAs: false })).toEqual({ shared: "available", shared_ceiling: "available", personal: "unavailable" });
    }
  });

  it("26.3 and 26.5: every kind may be tried", async () => {
    for (const version of ["26.3.63.123", "26.5.7.64"]) {
      expect(await states({ version, takesRole: true, executeAs: true })).toEqual({ shared: "available", shared_ceiling: "available", personal: "available" });
    }
  });

  it("says why, with the server's version and what the kind needs", async () => {
    server({ version: "24.3.18.7", takesRole: false, executeAs: false });
    const old = await probeKindSupport(CONFIG);
    expect(old.serverVersion).toBe("24.3.18.7");
    expect(supportOf(old, "shared_ceiling")?.reason).toBe("ClickHouse 24.3.18.7 does not take a ClickHouse role on a request. The role ceiling needs ClickHouse 24.4 or newer.");
    expect(supportOf(old, "personal")?.reason).toContain("ClickHouse 24.3.18.7");
    server({ version: "25.10.7.6", takesRole: true, executeAs: false });
    expect(supportOf(await probeKindSupport(CONFIG), "personal")?.reason).toContain("ClickHouse 25.10.7.6 has no EXECUTE AS statement");
    server({ version: "26.5.7.64", takesRole: true, executeAs: true });
    // Available is not a promise: the self-test still decides at the check.
    expect(supportOf(await probeKindSupport(CONFIG), "personal")?.reason).toContain("tested when you press Check");
    expect(supportOf(old, "federated")).toBeUndefined();
  });

  it("asks without a grant: a role that does not exist, and a parse that runs nothing", async () => {
    server({ version: "26.3.63.123", takesRole: true, executeAs: true });
    await probeKindSupport(CONFIG);
    expect(asked.find((entry) => entry.query === "SELECT 1")?.role).toBe("chouse_probe_no_such_role");
    expect(asked.find((entry) => entry.query.startsWith("EXPLAIN AST"))?.role).toBeUndefined();
    expect(asked.every((entry) => /^(SELECT version\(\)|SELECT 1|EXPLAIN AST EXECUTE AS \w+ SELECT 1)$/.test(entry.query))).toBe(true);
  });

  it("blocks nothing on a guess: a probe that fails another way is unknown, not unavailable", async () => {
    expect(await states({ version: "26.3.63.123", takesRole: true, executeAs: true, breaks: "role" })).toEqual({ shared: "available", shared_ceiling: "unknown", personal: "unknown" });
    expect(await states({ version: "26.3.63.123", takesRole: true, executeAs: true, breaks: "executeAs" })).toEqual({ shared: "available", shared_ceiling: "available", personal: "unknown" });
    // No role on a request settles personal whatever the parse said.
    expect(await states({ version: "24.3.18.7", takesRole: false, executeAs: true, breaks: "executeAs" })).toEqual({ shared: "available", shared_ceiling: "unavailable", personal: "unavailable" });
  });

  it("a server that does not answer makes the other kinds unknown and sends nothing more", async () => {
    server({ version: "x", takesRole: true, executeAs: true, breaks: "version" });
    const support = await probeKindSupport(CONFIG);
    expect(support.serverVersion).toBeNull();
    expect(support.kinds.map((kind) => kind.state)).toEqual(["available", "unknown", "unknown"]);
    expect(supportOf(support, "personal")?.reason).toContain("could not reach the server");
    expect(asked).toHaveLength(1);
  });

  it("a server whose version is unknown still gets a readable reason", () => {
    expect(supportOf(supportFrom(null, "no", "no"), "shared_ceiling")?.reason).toStartWith("This server does not take");
  });
});
