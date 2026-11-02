import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

const { closeDatabase, initializeDatabase } = await import("../../../rbac/db");
const { runMigrations } = await import("../../../rbac/db/migrations");
const { all, run, sql } = await import("../../observe/db");
const { getAssessment } = await import("../../upgrades/assess");
const { resetUpgradeHosts } = await import("../../upgrades/fetch");
const { resetNotesCache } = await import("../../upgrades/notes");
const { resetReleaseDataCache } = await import("../../upgrades/releaseData");
const { matchUpgradeNotesCapability: cap } = await import("./upgrades");
const { PERMISSIONS } = await import("../../../rbac/schema/base");

const testdata = (name: string): string => readFileSync(path.join(import.meta.dir, "../../upgrades/testdata", name), "utf-8");

let server: ReturnType<typeof Bun.serve>;
const ADMIN = { userId: "u1", isAdmin: true, permissions: [], connectionId: "c1" };
const META = { raw: "", steps: [], modelLabel: "test-model" } as never;

async function seedCheck(over: { status?: string; current?: string; target?: string } = {}): Promise<string> {
  const id = `as-${Math.random().toString(36).slice(2)}`;
  const summary = { stage: "done", mode: "notes", target: { version: over.target ?? "26.8.36.3", line: (over.target ?? "26.8").split(".").slice(0, 2).join(".") }, reference: null, workloadNames: ["JSONEachRow", "DateTime64", "snowflakeToDateTime", "Object"], counts: { blocker: 1, warning: 0, info: 0, note: 0 } };
  await run(sql`INSERT INTO upgrade_assessments (id, connection_id, current_version, target_version, status, summary, created_at) VALUES (${id}, 'c1', ${over.current ?? "26.6.1.1"}, ${over.target ?? "26.8.36.3"}, ${over.status ?? "done"}, ${JSON.stringify(summary)}, ${Date.now()})`);
  await run(sql`INSERT INTO upgrade_findings (id, assessment_id, category, severity, title, detail, evidence) VALUES (${`${id}-f`}, ${id}, 'removed-function', 'blocker', 'calls snowflakeToDateTime', 'd', '{}')`);
  return id;
}

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname;
      if (p.endsWith("/CHANGELOG.md")) return new Response(testdata("changelog-2026.md"));
      if (p.endsWith("/version_date.tsv")) return new Response(testdata("version_date.tsv"));
      if (p.startsWith("/v2/")) return new Response(testdata("hub-26.8.json"));
      return new Response("missing", { status: 404 });
    },
  });
  process.env.CHOUSE_ALLOW_TEST_OVERRIDES = "1";
  process.env.CHOUSE_UPGRADE_TEST_HOSTS = JSON.stringify({ github: `http://localhost:${server.port}`, dockerHub: `http://localhost:${server.port}` });
  process.env.UPGRADE_CHECK_ENABLED = "true";
  resetUpgradeHosts();
});

beforeEach(() => {
  resetNotesCache();
  resetReleaseDataCache();
});

afterAll(async () => {
  server.stop(true);
  delete process.env.CHOUSE_ALLOW_TEST_OVERRIDES;
  delete process.env.CHOUSE_UPGRADE_TEST_HOSTS;
  delete process.env.UPGRADE_CHECK_ENABLED;
  resetUpgradeHosts();
  await closeDatabase();
});

describe("match-upgrade-notes prepare", () => {
  it("sends the notes of the range, the workload's names and what CHouse already found", async () => {
    const id = await seedCheck();
    const p = await cap.prepare({ assessmentId: id }, ADMIN);
    expect(p.evidence.notes.map((n) => n.line)).toEqual([...Array(12).fill("26.7"), ...Array(21).fill("26.8")]);
    expect(p.evidence.workloadNames).toContain("JSONEachRow");
    expect(p.evidence.alreadyFound).toEqual([{ category: "removed-function", title: "calls snowflakeToDateTime" }]);
    expect(JSON.parse(String(cap.templateVariables(p, ADMIN).evidence)).notes[0].noteId).toBe("26.7#1");
  });

  it("refuses without upgrades:run, for an unknown or running check, and for a patch inside one line", async () => {
    const id = await seedCheck();
    await expect(cap.prepare({ assessmentId: id }, { userId: "u2", permissions: [PERMISSIONS.AI_OPTIMIZE], connectionId: "c1" })).rejects.toThrow("upgrades:run");
    await expect(cap.prepare({ assessmentId: "nope" }, ADMIN)).rejects.toThrow("not found");
    await expect(cap.prepare({ assessmentId: await seedCheck({ status: "running" }) }, ADMIN)).rejects.toThrow("finish");
    await expect(cap.prepare({ assessmentId: await seedCheck({ current: "26.8.1.1", target: "26.8.36.3" }) }, ADMIN)).rejects.toThrow("patch inside one line");
  });

  it("refuses a user without access to the connection", async () => {
    const id = await seedCheck();
    await expect(cap.prepare({ assessmentId: id }, { userId: "stranger", permissions: [PERMISSIONS.UPGRADES_RUN, PERMISSIONS.AI_OPTIMIZE], connectionId: "c1" })).rejects.toThrow("access to this connection");
  });

  it("refuses when release notes are off", async () => {
    const id = await seedCheck();
    process.env.UPGRADE_CHECK_ENABLED = "false";
    await expect(cap.prepare({ assessmentId: id }, ADMIN)).rejects.toThrow("UPGRADE_CHECK_ENABLED");
    process.env.UPGRADE_CHECK_ENABLED = "true";
  });
});

describe("match-upgrade-notes finalize", () => {
  it("keeps only findings that cite a sent note and the workload's names, and stores them", async () => {
    const id = await seedCheck();
    const p = await cap.prepare({ assessmentId: id }, ADMIN);
    const jsonNote = p.evidence.notes.find((n) => n.text.includes("JSONEachRow"))!;
    const result = await cap.finalize({
      findings: [
        { noteId: jsonNote.noteId, severity: "warning", title: "ingest sends JSONEachRow to DateTime64", detail: "Bare numbers become Unix timestamps.", action: "Check what the client sends.", matched: ["jsoneachrow", "DateTime64", "made_up_name"] },
        { noteId: jsonNote.noteId, severity: "warning", title: "duplicate", detail: "", action: "", matched: ["JSONEachRow"] },
        { noteId: "99.1#1", severity: "blocker", title: "invented note", detail: "", action: "", matched: ["JSONEachRow"] },
        { noteId: p.evidence.notes[0].noteId, severity: "info", title: "no workload name", detail: "", action: "", matched: ["Kafka"] },
      ],
    }, p, ADMIN, META);
    expect(result).toEqual({ findings: 1, dropped: 3, model: "test-model" });
    const a = (await getAssessment(id))!;
    const ai = a.findings.filter((f) => f.category === "ai-note");
    expect(ai).toHaveLength(1);
    expect(ai[0].evidence.matched).toEqual(["JSONEachRow", "DateTime64"]);
    expect(ai[0].evidence.source.notes?.[0].prs).toEqual([108091]);
    expect(ai[0].evidence.source.ai?.model).toBe("test-model");
    expect(a.summary.ai).toMatchObject({ status: "done", model: "test-model", dropped: 3 });
    expect(a.summary.counts).toEqual({ blocker: 1, warning: 1, info: 0, note: 0 });
  });

  it("takes notes an AI finding now covers out of the to-judge count", async () => {
    const id = await seedCheck();
    const p = await cap.prepare({ assessmentId: id }, ADMIN);
    const note = p.evidence.notes.find((n) => n.text.includes("JSONEachRow"))!;
    const other = p.evidence.notes.find((n) => n.noteId !== note.noteId)!;
    for (const n of [note, other]) {
      await run(sql`INSERT INTO upgrade_findings (id, assessment_id, category, severity, title, detail, evidence) VALUES (${`${id}-${n.noteId}`}, ${id}, 'release-note', 'note', 't', 'd', ${JSON.stringify({ source: { notes: [{ id: n.noteId, line: n.line, prs: [] }] } })})`);
    }
    await cap.finalize({ findings: [{ noteId: note.noteId, severity: "warning", title: "t", detail: "d", action: "", matched: ["JSONEachRow"] }] }, p, ADMIN, META);
    expect((await getAssessment(id))!.summary.counts).toEqual({ blocker: 1, warning: 1, info: 0, note: 1 });
  });

  it("replaces the previous AI findings on a rerun", async () => {
    const id = await seedCheck();
    const p = await cap.prepare({ assessmentId: id }, ADMIN);
    const note = p.evidence.notes.find((n) => n.text.includes("JSONEachRow"))!;
    const finding = { noteId: note.noteId, severity: "warning" as const, title: "t", detail: "d", action: "", matched: ["JSONEachRow"] };
    await cap.finalize({ findings: [finding] }, p, ADMIN, META);
    await cap.finalize({ findings: [] }, p, ADMIN, META);
    expect(await all(sql`SELECT id FROM upgrade_findings WHERE assessment_id = ${id} AND category = 'ai-note'`)).toHaveLength(0);
  });
});
