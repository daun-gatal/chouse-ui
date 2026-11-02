import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { linesBetween } from "./assess";
import { matchFindings, noteFindings, relevantNotes, workloadNames, type FindingDraft } from "./match";
import { parseChangelog, type ReleaseNote } from "./notes";
import { diffSnapshots, normaliseValue, type VersionSnapshot } from "./snapshot";
import { typeFamilies, type WorkloadFacts } from "./workload";
import { stripFormat } from "../observe/clickhouse";
import { visibleAssessment } from "../../routes/upgrades";

// Real system-table rows of 25.8.33.6 and 26.8.36.3, trimmed to the names these tests use.
type RawSnapshot = Record<string, Record<string, string>>;
const RAW = JSON.parse(readFileSync(path.join(import.meta.dir, "testdata", "snapshots.json"), "utf-8")) as Record<string, RawSnapshot>;

function snapshot(version: string): VersionSnapshot {
  const raw = RAW[version];
  const obsolete = new Set(Object.keys(raw.obsolete ?? {}));
  const unescape = (v: string): string => v.replace(/\\'/g, "'");
  return {
    version,
    settings: new Map(Object.entries(raw.setting).map(([n, v]) => [n, { value: normaliseValue(unescape(v)), obsolete: obsolete.has(n) }])),
    mergeTree: new Map(Object.entries(raw.mt_setting).map(([n, v]) => [n, normaliseValue(unescape(v))])),
    functions: new Set(Object.keys(raw.function)),
    types: new Set(Object.keys(raw.type)),
    engines: new Set(Object.keys(raw.engine)),
    formats: new Set(Object.keys(raw.format)),
    dbEngines: new Set(Object.keys(raw.db_engine)),
  };
}

const FROM = snapshot("25.8.33.6");
const TO = snapshot("26.8.36.3");

const NOTES: ReleaseNote[] = [
  ...parseChangelog(readFileSync(path.join(import.meta.dir, "testdata", "changelog-2025.md"), "utf-8")).get("25.11")!.notes,
  ...parseChangelog(readFileSync(path.join(import.meta.dir, "testdata", "changelog-2026.md"), "utf-8")).get("26.8")!.notes,
  ...parseChangelog(readFileSync(path.join(import.meta.dir, "testdata", "changelog-2026.md"), "utf-8")).get("26.7")!.notes,
];

const use = (shapes: number, users: string[] = ["grafana"], clients: string[] = ["Grafana 11.4"]): { shapes: number; runs7d: number; users: string[]; clients: string[] } => ({ shapes, runs7d: shapes * 10, users, clients });

function facts(over: Partial<WorkloadFacts> = {}): WorkloadFacts {
  return {
    columns: [
      { database: "logs", table: "events", column: "attrs", type: "Object('json')" },
      { database: "logs", table: "raw", column: "payload", type: "Nullable(Object('json'))" },
      { database: "shop", table: "orders", column: "id", type: "UInt64" },
    ],
    tableBytes: { "logs.events": 310 * 1024 ** 3 },
    tables: [{ database: "logs", table: "events", engine: "MergeTree" }, { database: "logs", table: "live", engine: "LiveView" }],
    databases: [{ database: "cache", engine: "Lazy" }, { database: "shop", engine: "Atomic" }],
    profileSettings: [
      { target: "reporting", setting: "compatibility", value: "24.8" },
      { target: "etl", setting: "allow_experimental_object_type", value: "1" },
    ],
    defaultProfileStorage: "users_xml",
    serverMergeTree: [],
    queries: {
      functions: { snowflakeToDateTime: use(14), count: use(900) },
      types: {},
      storages: {},
      formats: { JSONEachRow: use(3, ["ingest_api"], ["clickhouse-js 1.8"]) },
      settings: { max_insert_threads: { ...use(2, ["etl_svc"]), values: ["4"] } },
    },
    window: { days: 30, from: 1, shapes: 1912, readable: true },
    ...over,
  };
}

const byKey = (fs: FindingDraft[]): Record<string, FindingDraft> => Object.fromEntries(fs.map((f) => [f.key, f]));

describe("snapshot diff", () => {
  it("finds removals, changed defaults and newly obsolete settings between real versions", () => {
    const d = diffSnapshots(FROM, TO);
    expect(d.removed.functions).toEqual(["searchAny", "snowflakeToDateTime"]);
    expect(d.removed.types).toEqual(["Object"]);
    expect(d.removed.engines).toEqual(["LiveView"]);
    expect(d.removed.dbEngines).toEqual(["Lazy"]);
    expect(d.changedSettings.map((c) => `${c.name}:${c.from}→${c.to}`)).toContain("async_insert:0→1");
    expect(d.changedSettings.map((c) => c.name)).toContain("max_insert_threads");
    expect(d.newlyObsolete).toEqual(["allow_deprecated_snowflake_conversion_functions", "allow_experimental_object_type"]);
  });

  it("does not report machine-dependent defaults as changes, quoted or not", () => {
    expect(normaliseValue("'auto(18)'")).toBe("auto");
    expect(normaliseValue("auto(4)")).toBe("auto");
    expect(normaliseValue("'LZ4'")).toBe("'LZ4'");
    expect(diffSnapshots(FROM, TO).changedSettings.map((c) => c.name)).not.toContain("max_threads");
  });

  it("is empty between a server and itself", () => {
    const d = diffSnapshots(FROM, FROM);
    expect(d.changedSettings).toEqual([]);
    expect(Object.values(d.removed).flat()).toEqual([]);
    expect(d.newlyObsolete).toEqual([]);
  });
});

describe("matching the workload", () => {
  const diff = diffSnapshots(FROM, TO);
  const found = byKey(matchFindings({ diff, current: FROM, targetVersion: "26.8.36.3", facts: facts(), notes: NOTES }));

  it("reports removed things only where the workload uses them", () => {
    expect(found["removed-type:Object"].severity).toBe("blocker");
    expect(found["removed-type:Object"].evidence.totalRows).toBe(2);
    expect(found["removed-function:snowflakeToDateTime"].severity).toBe("blocker");
    expect(found["removed-function:searchAny"]).toBeUndefined();
    expect(found["removed-engine:LiveView"].evidence.rows[0].table).toBe("logs.live");
    expect(found["removed-db-engine:Lazy"]).toBeDefined();
  });

  it("links the release note that names the change", () => {
    expect(found["removed-type:Object"].evidence.source.notes?.[0]).toMatchObject({ line: "25.11", prs: [85718] });
    expect(found["removed-function:snowflakeToDateTime"].evidence.source.notes?.[0].line).toBe("26.7");
  });

  it("builds the JSON migration with escaped identifiers", () => {
    const sql = found["removed-type:Object"].evidence.fix?.sql ?? "";
    expect(sql).toContain("MODIFY COLUMN `attrs` JSON");
    expect(sql).toContain("EXCHANGE TABLES `logs`.`events` AND `logs`.`events_json`");
  });

  it("groups changed defaults, workload-related first, with a way to keep today's values", () => {
    const f = found["default-changes"];
    expect(f.severity).toBe("warning");
    expect(f.evidence.rows[0].cells[0]).toBe("max_insert_threads");
    // Not the old values: max_insert_threads = 0 means one thread on 25.8 but "auto" on 26.8.
    expect(f.evidence.keep?.sql).toContain("<compatibility>25.8</compatibility>");
    expect(f.evidence.keep?.title).toContain("users.xml");
    const sqlManaged = byKey(matchFindings({ diff, current: FROM, targetVersion: "26.8", facts: facts({ defaultProfileStorage: "local_directory" }), notes: [] }));
    expect(sqlManaged["default-changes"].evidence.keep?.sql).toBe("ALTER SETTINGS PROFILE default SETTINGS compatibility = '25.8';");
  });

  it("leaves out defaults the default profile already pins", () => {
    const pinned = byKey(matchFindings({ diff, current: FROM, targetVersion: "26.8", facts: facts({ profileSettings: [{ target: "default", setting: "async_insert", value: "0" }] }), notes: [] }));
    expect(pinned["default-changes"].evidence.rows.map((r) => r.cells[0])).not.toContain("async_insert");
  });

  it("flags obsolete settings the workload still sets, and compatibility pins", () => {
    expect(found["obsolete-setting:allow_experimental_object_type"].severity).toBe("info");
    expect(found["obsolete-setting:allow_deprecated_snowflake_conversion_functions"]).toBeUndefined();
    expect(found["compatibility-pinned"].title).toContain("reporting");
  });

  it("without a diff, keeps only the checks that need none", () => {
    const keys = matchFindings({ diff: null, current: FROM, targetVersion: "26.8", facts: facts(), notes: NOTES }).map((f) => f.key);
    expect(keys).toEqual(["compatibility-pinned"]);
  });

  it("finds nothing for a workload that uses none of it", () => {
    const empty = facts({ columns: [], tables: [], databases: [], profileSettings: [], queries: { functions: {}, types: {}, storages: {}, formats: {}, settings: {} } });
    const keys = matchFindings({ diff, current: FROM, targetVersion: "26.8", facts: empty, notes: NOTES }).map((f) => f.key);
    expect(keys).toEqual(["default-changes"]);
  });

  it("keeps table names out of titles and details", () => {
    for (const f of Object.values(found)) {
      expect(f.title).not.toContain("logs.events");
      expect(f.detail).not.toContain("logs.events");
    }
  });
});

describe("release notes to judge", () => {
  it("lists notes naming what the workload uses, minus those already on a finding", () => {
    const diff = diffSnapshots(FROM, TO);
    const findings = matchFindings({ diff, current: FROM, targetVersion: "26.8", facts: facts(), notes: NOTES });
    const names = workloadNames(facts(), FROM);
    const { findings: notes } = noteFindings(NOTES, names, findings);
    const texts = notes.map((n) => n.evidence.noteText ?? "");
    expect(texts.some((t) => t.includes("JSONEachRow"))).toBe(true);
    expect(texts.some((t) => t.startsWith("Remove deprecated `Object` type"))).toBe(false);
    expect(notes.every((n) => n.severity === "note")).toBe(true);
  });

  it("does not list a note that names only common types and engines", () => {
    const note = { id: "26.8#99", line: "26.8", date: "2026-08-27", text: "`String` and `MergeTree` change.", prs: [], names: ["String", "MergeTree"] };
    expect(relevantNotes([note], new Set(["string", "mergetree"]))).toEqual({ relevant: [], general: 1 });
  });

  it("matches a note's spaced name to the engine it means", () => {
    const note = { id: "25.11#2", line: "25.11", date: "2025-11-27", text: "Remove the obsolete `LIVE VIEW` feature.", prs: [88706], names: ["LIVE VIEW"] };
    expect(relevantNotes([note], new Set(["liveview"])).relevant).toHaveLength(1);
  });

  it("matches names regardless of case", () => {
    const note = { id: "26.8#98", line: "26.8", date: "2026-08-27", text: "`jsonEachRow` thing", prs: [], names: ["jsonEachRow"] };
    expect(relevantNotes([note], new Set(["jsoneachrow"])).relevant).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("reads type families out of nested column types, ignoring quoted arguments", () => {
    const known = new Set(["Nullable", "Object", "String", "Tuple", "DateTime64"]);
    expect(typeFamilies("Nullable(Object('json'))", known)).toEqual(["Nullable", "Object"]);
    expect(typeFamilies("Tuple(a String, b DateTime64(3, 'UTC'))", known)).toEqual(["Tuple", "String", "DateTime64"]);
    expect(typeFamilies("Enum8('Object' = 1)", known)).toEqual([]);
  });

  it("lists the lines between two versions, from the release list or by month", () => {
    expect(linesBetween("25.8", "26.3", null)).toEqual(["25.9", "25.10", "25.11", "25.12", "26.1", "26.2", "26.3"]);
    expect(linesBetween("26.8", "26.10", ["26.10", "26.9", "26.8", "26.3"])).toEqual(["26.9", "26.10"]);
    expect(linesBetween("26.8", "26.8", null)).toEqual([]);
  });

  it("hides evidence rows on tables the reader may not see, and counts them", () => {
    const a = {
      id: "a", connectionId: "c", currentVersion: "25.8.33.6", targetVersion: "26.8", status: "done" as const, createdAt: 0, finishedAt: 1,
      summary: { stage: "done" as const, mode: "exact" as const, target: { version: "26.8", line: "26.8" }, reference: null, workloadNames: ["secret_fn"] },
      findings: [{ id: "f", key: "k", category: "removed-type", severity: "blocker" as const, title: "t", detail: "d", evidence: { source: {}, head: ["Table"], rows: [{ table: "logs.events", cells: ["logs.events"] }, { table: "hr.salaries", cells: ["hr.salaries"] }, { cells: ["no table"] }], totalRows: 3 } }],
    };
    const v = visibleAssessment(a, (db) => db !== "hr");
    expect(v.findings[0].evidence.rows.map((r) => r.cells[0])).toEqual(["logs.events", "no table"]);
    expect(v.findings[0].evidence.totalRows).toBe(2);
    expect(v.hiddenRows).toBe(1);
    expect("workloadNames" in v.summary).toBe(false);
  });
});

describe("stripFormat, used to plan logged queries", () => {
  it("removes the logged FORMAT clause", () => {
    expect(stripFormat("SELECT * FROM public.test_2 LIMIT 100 FORMAT JSON")).toBe("SELECT * FROM public.test_2 LIMIT 100");
  });

  it("strips the client's multi-line FORMAT clause so EXPLAIN can wrap the query", () => {
    const logged = "SELECT query, type\n    FROM system.query_log\n    WHERE type IN ('QueryFinish')\n\nFORMAT JSONEachRow";
    expect(stripFormat(logged)).toBe("SELECT query, type\n    FROM system.query_log\n    WHERE type IN ('QueryFinish')");
    expect(stripFormat("SELECT 1 FORMAT JSONEachRow;")).toBe("SELECT 1");
    expect(stripFormat("SELECT 'FORMAT JSON' AS f")).toBe("SELECT 'FORMAT JSON' AS f");
  });
});
