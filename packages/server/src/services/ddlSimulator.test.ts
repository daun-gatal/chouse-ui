import { describe, it, expect } from "bun:test";
import { mutationCountStatement, parseMutationStatement, type ParsedMutation } from "./ddlSimulator";

describe("ddlSimulator parseMutationStatement", () => {
  it("parses a qualified UPDATE with a predicate", () => {
    const r = parseMutationStatement("ALTER TABLE demo.events UPDATE col = 1 WHERE id < 5");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ database: "demo", table: "events", kind: "update", where: "id < 5" });
  });

  it("parses a DELETE and an unqualified table (null database)", () => {
    const r = parseMutationStatement("ALTER TABLE events DELETE WHERE ts < now()");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.database).toBeNull();
    expect(r.value.table).toBe("events");
    expect(r.value.kind).toBe("delete");
    expect(r.value.where).toBe("ts < now()");
  });

  it("strips backticks and tolerates ON CLUSTER", () => {
    const r = parseMutationStatement("ALTER TABLE `db`.`t` ON CLUSTER my_cluster DELETE WHERE 1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.database).toBe("db");
    expect(r.value.table).toBe("t");
  });

  it("treats a missing WHERE as an empty predicate", () => {
    const r = parseMutationStatement("ALTER TABLE db.t DELETE");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.where).toBe("");
  });

  it("strips comments before parsing", () => {
    const r = parseMutationStatement("/* cleanup */ ALTER TABLE db.t DELETE WHERE id = 1 -- trailing");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("delete");
  });

  it.each([
    ["a SELECT", "SELECT 1"],
    ["a DROP", "DROP TABLE db.t"],
    ["a non-mutating ALTER", "ALTER TABLE db.t ADD COLUMN x Int32"],
    ["a TRUNCATE", "TRUNCATE TABLE db.t"],
    ["an empty string", "   "],
  ])("rejects %s", (_label, sql) => {
    expect(parseMutationStatement(sql).ok).toBe(false);
  });

  it("rejects multiple statements", () => {
    const r = parseMutationStatement("ALTER TABLE db.t DELETE WHERE 1; DROP TABLE db.t");
    expect(r.ok).toBe(false);
  });

  it("rejects a predicate that smuggles a second statement", () => {
    const r = parseMutationStatement("ALTER TABLE db.t DELETE WHERE id = 1; DROP TABLE x");
    expect(r.ok).toBe(false);
  });
});

describe("mutationCountStatement", () => {
  const parsed = (sql: string): ParsedMutation => {
    const result = parseMutationStatement(sql);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };

  it("builds the count for a qualified table with its predicate", () => {
    expect(mutationCountStatement(parsed("ALTER TABLE db.t DELETE WHERE id > 5"))).toEqual({
      database: "db",
      table: "t",
      sql: "SELECT count() AS c FROM `db`.`t` WHERE id > 5 SETTINGS max_execution_time = 15",
    });
  });

  it("uses the given default database for an unqualified table, then 'default'", () => {
    expect(mutationCountStatement(parsed("ALTER TABLE t DELETE WHERE 1"), "analytics")?.sql).toContain("FROM `analytics`.`t`");
    expect(mutationCountStatement(parsed("ALTER TABLE t DELETE WHERE 1"))?.database).toBe("default");
  });

  it("counts the whole table when the mutation has no WHERE", () => {
    expect(mutationCountStatement(parsed("ALTER TABLE db.t UPDATE a = 1"))?.sql).toBe("SELECT count() AS c FROM `db`.`t` WHERE 1 SETTINGS max_execution_time = 15");
  });

  it("keeps a predicate that reads another table in the text, so the access check sees it", () => {
    expect(mutationCountStatement(parsed("ALTER TABLE db.t DELETE WHERE id IN (SELECT id FROM other.s)"))?.sql).toContain("(SELECT id FROM other.s)");
  });

  it("returns null when the default database is not a plain identifier", () => {
    expect(mutationCountStatement(parsed("ALTER TABLE t DELETE WHERE 1"), "bad`name")).toBeNull();
  });
});
