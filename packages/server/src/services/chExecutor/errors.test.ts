import { describe, expect, it } from "bun:test";

import {
  classifiedAppError,
  classifyClickHouseError,
  clickhouseErrorCode,
  clickhouseErrorType,
  deniedSystemTables,
  isGrantError,
  isReadOnlyError,
  requiredGrantFromError,
} from "./errors";

/** The shape of the client's ClickHouseError. */
function chError(code: string, type: string, message: string): Error {
  return Object.assign(new Error(message), { code, type });
}

const GRANT = "svc: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(a, b) ON shop.orders. (ACCESS_DENIED) (version 26.5.7.64)";
const READONLY = "svc: Cannot execute query in readonly mode. (READONLY) (version 26.5.7.64 (official build))";

describe("clickhouseErrorCode", () => {
  it("reads the client's code, a numeric code, and the code in a wrapped message", () => {
    expect(clickhouseErrorCode(chError("497", "ACCESS_DENIED", GRANT))).toBe(497);
    expect(clickhouseErrorCode({ code: 164 })).toBe(164);
    expect(clickhouseErrorCode(new Error("Query failed: Code: 164. DB::Exception: x"))).toBe(164);
  });

  it("is null for anything else", () => {
    expect(clickhouseErrorCode(new Error("socket hang up"))).toBeNull();
    expect(clickhouseErrorCode({ code: "ECONNREFUSED" })).toBeNull();
    expect(clickhouseErrorCode(null)).toBeNull();
    expect(clickhouseErrorType("x")).toBe("");
  });
});

describe("classifyClickHouseError", () => {
  it("classes a missing grant by code, by type and by text, and names the grant", () => {
    for (const error of [chError("497", "", "x"), chError("", "ACCESS_DENIED", "x"), new Error(GRANT)]) {
      expect(isGrantError(error)).toBe(true);
      expect(classifyClickHouseError(error)).toMatchObject({ class: "grant", code: "CLICKHOUSE_ACCESS_DENIED", status: 403 });
    }
    const classified = classifyClickHouseError(chError("497", "ACCESS_DENIED", GRANT));
    expect(classified?.grant).toBe("SELECT ON shop.orders");
    expect(classified?.message).toContain("isn't allowed to do this");
  });

  it("classes a refused write on a read-only request", () => {
    for (const error of [chError("164", "READONLY", READONLY), new Error(READONLY)]) {
      expect(isReadOnlyError(error)).toBe(true);
      expect(classifyClickHouseError(error)).toMatchObject({ class: "read-only", code: "READ_ONLY", status: 403 });
    }
    expect(classifyClickHouseError(chError("164", "READONLY", READONLY))?.message).toContain("You may only read");
  });

  it("says so when the login itself is read-only and refused a setting", () => {
    const classified = classifyClickHouseError(chError("164", "READONLY", "Cannot modify 'log_comment' setting in readonly mode. (READONLY)"));
    expect(classified?.class).toBe("read-only");
    expect(classified?.message).toContain("'log_comment'");
    expect(classified?.message).toContain("readonly = 2");
  });

  it("goes by the code when there is one, whatever words the statement put in its own error", () => {
    const unknownIdentifier = chError("47", "UNKNOWN_IDENTIFIER", "Missing columns: 'ACCESS_DENIED' while processing query 'SELECT ACCESS_DENIED FROM t'");
    expect(isGrantError(unknownIdentifier)).toBe(false);
    expect(classifyClickHouseError(unknownIdentifier)).toBeNull();
    expect(classifyClickHouseError(chError("62", "SYNTAX_ERROR", "Syntax error near '(READONLY)'"))).toBeNull();
    expect(classifyClickHouseError(new Error("Code: 47. DB::Exception: Not enough privileges is not a column"))).toBeNull();
  });

  it("leaves every other error alone, including text that only mentions read-only", () => {
    expect(classifyClickHouseError(chError("60", "UNKNOWN_TABLE", "Table x does not exist"))).toBeNull();
    expect(classifyClickHouseError(new Error("Authentication failed"))).toBeNull();
    expect(classifyClickHouseError(new Error("this role is readonly in users.xml"))).toBeNull();
    expect(classifyClickHouseError("timeout")).toBeNull();
  });

  it("becomes a 403 with its own code, never a sign-in failure", () => {
    const grant = classifiedAppError(classifyClickHouseError(chError("497", "ACCESS_DENIED", GRANT))!);
    expect(grant).toMatchObject({ statusCode: 403, code: "CLICKHOUSE_ACCESS_DENIED", category: "permission", details: { grant: "SELECT ON shop.orders" } });
    const readOnly = classifiedAppError(classifyClickHouseError(chError("164", "READONLY", READONLY))!);
    expect(readOnly).toMatchObject({ statusCode: 403, code: "READ_ONLY" });
    expect(readOnly.details).toBeUndefined();
  });
});

describe("grant helpers", () => {
  it("reads the grant ClickHouse asks for, without the column list", () => {
    expect(requiredGrantFromError(GRANT)).toBe("SELECT ON shop.orders");
    expect(requiredGrantFromError("Authentication failed")).toBeNull();
  });

  it("lists the system tables a grant error names, and nothing for another error", () => {
    expect(deniedSystemTables(new Error("necessary to have the grant SELECT ON system.query_log, SELECT ON system.query_log, SELECT ON system.parts. (ACCESS_DENIED)"))).toEqual(["query_log", "parts"]);
    expect(deniedSystemTables(new Error("Table system.query_log does not exist"))).toEqual([]);
  });
});

describe("on a connection that limits people to a ClickHouse role", () => {
  const ceiling = { mode: "shared_ceiling" };

  it("words a grant error as the person's role's, not the login's", () => {
    const classified = classifyClickHouseError(chError("497", "ACCESS_DENIED", GRANT), ceiling);
    expect(classified).toMatchObject({ class: "grant", code: "CLICKHOUSE_ACCESS_DENIED", status: 403, grant: "SELECT ON shop.orders" });
    expect(classified?.message).toContain("Your ClickHouse role");
    expect(classifyClickHouseError(chError("497", "ACCESS_DENIED", GRANT))?.message).toContain("This connection's ClickHouse user");
  });

  it("classes a role ClickHouse does not know or did not grant as the person's identity being unavailable", () => {
    for (const code of ["511", "512"]) {
      expect(classifyClickHouseError(chError(code, "", "There is no role `analyst_ro` in user directories"), ceiling)).toMatchObject({ class: "identity", code: "IDENTITY_UNAVAILABLE", status: 403 });
    }
    // On a shared connection CHouse names no role, so these are just ClickHouse's errors.
    expect(classifyClickHouseError(chError("511", "", "There is no role `x`"))).toBeNull();
    expect(classifyClickHouseError(chError("511", "", "There is no role `x`"), { mode: "shared" })).toBeNull();
  });

  it("classes a server that takes no role on a request as the connection being unavailable, and nothing else with that code", () => {
    const old = chError("115", "UNKNOWN_SETTING", "Setting role is neither a builtin setting nor started with the prefix 'SQL_'");
    const classified = classifyClickHouseError(old, ceiling);
    expect(classified).toMatchObject({ class: "connection", code: "CONNECTION_UNAVAILABLE", status: 503 });
    expect(classified?.message).toContain("24.4");
    expect(classifiedAppError(classified!)).toMatchObject({ statusCode: 503, category: "connection" });
    expect(classifyClickHouseError(chError("115", "UNKNOWN_SETTING", "Setting max_thraeds is neither a builtin setting"), ceiling)).toBeNull();
    expect(classifyClickHouseError(old)).toBeNull();
  });
});
