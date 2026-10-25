/**
 * Auto-triage end to end on a real RBAC database (ADR 0024 §Phase 4): each
 * trigger's subjects, and the runner's dedupe, cooldown, budget, notebook
 * findings, notices and failures. The AI run and channel delivery are stubbed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { sql } from "drizzle-orm";
import { ToolMessage } from "@langchain/core/messages";

process.env.RBAC_DB_TYPE = "sqlite";
process.env.RBAC_SQLITE_PATH = ":memory:";

type Findings = { summary: string; likelyCause: string; confidence: "low" | "medium" | "high"; severity: "low" | "medium" | "high"; findings: string[]; nextSteps: string[]; model: string; generatedAt: number };
type Call = { input: Record<string, unknown>; ctx: Record<string, unknown>; options: Record<string, unknown> };

const calls: Call[] = [];
let behaviour: (call: Call) => Promise<Findings> = async () => FINDINGS;
const FINDINGS: Findings = {
  summary: "A merge storm filled the disk.", likelyCause: "Too many small inserts into events.", confidence: "high", severity: "high",
  findings: ["system.parts shows 4,000 active parts"], nextSteps: ["Batch the inserts"], model: "fake", generatedAt: 1,
};

mock.module("../engine", () => ({
  runStructuredCapability: async (_cap: unknown, input: Record<string, unknown>, ctx: Record<string, unknown>, options: Record<string, unknown>) => {
    const call = { input, ctx, options };
    calls.push(call);
    // Tools return ToolMessages in real runs.
    const proposal = new ToolMessage({ content: JSON.stringify({ proposed: true, actionId: "act-1" }), tool_call_id: "c1", name: "kill_query" });
    (options.onTrace as ((t: unknown) => void) | undefined)?.({ calls: [{ name: "kill_query", result: proposal }, { name: "query_node", result: { rows: [] } }] });
    (options.onUsage as ((u: unknown) => void) | undefined)?.({ tokens: 1_500, costUsd: 0.02 });
    return behaviour(call);
  },
}));

const sent: Array<{ type: string; title: string; text: string }> = [];
mock.module("../../alerting/notify/platforms/webhook", () => ({
  postWebhook: async (_config: unknown, message: { title: string; text?: string }) => {
    sent.push({ type: "webhook", title: message.title, text: message.text ?? "" });
  },
}));

const { closeDatabase, initializeDatabase } = await import("../../../rbac/db");
const { runMigrations } = await import("../../../rbac/db/migrations");
const h = await import("../../../rbac/db/migrationTestHarness");
const { newSubjects } = await import("./subjects");
const store = await import("./store");
const runner = await import("./runner");
const notebooks = await import("../../notebooks/store");

const T0 = 1_000_000;

beforeAll(async () => {
  await initializeDatabase();
  await runMigrations({ skipSeed: true });
  const ts = sql`unixepoch()`;
  await h.rawRun(sql`INSERT INTO rbac_users (id, email, username, password_hash, is_active, created_at, updated_at) VALUES ('owner', 'o@test.local', 'owner', 'x', 1, ${ts}, ${ts})`);
  await h.rawRun(sql`INSERT INTO rbac_clickhouse_connections (id, name, host, port, username, created_at, updated_at) VALUES ('c1', 'node-a', 'localhost', 8123, 'default', ${ts}, ${ts})`);
  await h.rawRun(sql`INSERT INTO scheduled_queries (id, name, connection_id, query) VALUES ('q1', 'Daily orders', 'c1', 'SELECT count() FROM orders')`);
  await h.rawRun(sql`INSERT INTO scheduled_query_runs (id, query_id, trigger, status, slot_at, message, duration_ms, started_at, finished_at)
    VALUES ('run-ok', 'q1', 'schedule', 'success', ${T0}, NULL, 10, ${T0}, ${T0 + 10}),
           ('run-bad', 'q1', 'schedule', 'failed', ${T0}, 'Memory limit exceeded', 900, ${T0 + 100}, ${T0 + 200})`);
  await h.rawRun(sql`INSERT INTO data_health_promises (id, scheduled_query_id, name, connection_id, database_name, table_name) VALUES ('p1', 'q1', 'Orders fresh', 'c1', 'sales', 'orders')`);
  await h.rawRun(sql`INSERT INTO data_health_incidents (id, promise_id, status, severity, summary, opened_at, last_event_at) VALUES ('dh1', 'p1', 'open', 'critical', 'No rows for 3h', ${T0 + 300}, ${T0 + 300})`);
  await h.rawRun(sql`INSERT INTO obs_incidents (id, connection_id, kind, subject_ref, severity, summary, opened_at, last_event_at) VALUES ('ob1', 'c1', 'engine', 'table:sales.events', 'warning', 'Kafka lag rising', ${T0 + 400}, ${T0 + 400})`);
  await h.rawRun(sql`INSERT INTO alert_rules (id, name, source_type) VALUES ('fr1', 'Fleet memory', 'fleet_threshold'), ('dq1', 'Data quality', 'data_quality')`);
  await h.rawRun(sql`INSERT INTO alert_events (id, rule_id, severity, fired_at, payload) VALUES ('ev1', 'fr1', 'critical', ${T0 + 500}, 'node-a — memory: 95% used'), ('ev2', 'dq1', 'warning', ${T0 + 501}, 'not a fleet alert')`);
  await h.rawRun(sql`INSERT INTO doctor_reports (id, created_at, status, summary, analysis) VALUES
    ('dr-ok', ${T0 + 600}, 'healthy', 'All good', '{}'),
    ('dr-bad', ${T0 + 700}, 'critical', 'Disk almost full on node-a', ${JSON.stringify({ verdict: { status: "critical", summary: "Disk" }, nodes: [{ name: "node-a", status: "critical", details: ["disk 97%"] }], recommendations: ["Drop old partitions"] })})`);
  await h.rawRun(sql`INSERT INTO notification_channels (id, name, type, config, enabled) VALUES ('ch1', 'Ops webhook', 'webhook', '{"url":"http://example.invalid/hook"}', 1), ('ch-off', 'Off', 'webhook', '{}', 0)`);
}, 60_000);

afterAll(async () => {
  await closeDatabase();
});

beforeEach(() => {
  calls.length = 0;
  sent.length = 0;
  behaviour = async () => FINDINGS;
});

describe("triage subjects", () => {
  it("finds new data health and observe incidents with their notebooks and evidence", async () => {
    const [dh] = await newSubjects("data_health_incident", T0);
    expect(dh).toMatchObject({ id: "dh1", title: "Orders fresh: No rows for 3h", connectionId: "c1", notebook: { kind: "incident_data_health", ref: "dh1" }, link: "/data/incidents/data_health/dh1" });
    expect(dh.evidence).toMatchObject({ database: "sales", table: "orders", severity: "critical" });
    const [ob] = await newSubjects("observe_incident", T0);
    expect(ob).toMatchObject({ id: "ob1", title: "Kafka lag rising", notebook: { kind: "incident_observe", ref: "ob1" } });
    expect(await newSubjects("observe_incident", T0 + 400)).toEqual([]);
  });

  it("finds fleet alerts only, matched to their connection by node name", async () => {
    const subjects = await newSubjects("fleet_alert", T0);
    expect(subjects.map((s) => s.id)).toEqual(["ev1"]);
    expect(subjects[0]).toMatchObject({ connectionId: "c1", notebook: null, evidence: { node: "node-a", rule: "Fleet memory" } });
  });

  it("finds failed scheduled runs, not successful ones", async () => {
    const subjects = await newSubjects("scheduled_run_failed", T0);
    expect(subjects.map((s) => s.id)).toEqual(["run-bad"]);
    expect(subjects[0]).toMatchObject({ title: 'Scheduled query "Daily orders" failed', connectionId: "c1", evidence: { error: "Memory limit exceeded", sql: "SELECT count() FROM orders" } });
  });

  it("finds Doctor reports that found something", async () => {
    const subjects = await newSubjects("doctor_report", T0);
    expect(subjects.map((s) => s.id)).toEqual(["dr-bad"]);
    expect(subjects[0]).toMatchObject({ connectionId: null, notebook: { kind: "doctor_report", ref: "dr-bad" }, evidence: { recommendations: ["Drop old partitions"] } });
  });

  it("takes a few subjects at a time, oldest first", async () => {
    expect((await newSubjects("doctor_report", 0, 1)).map((s) => s.id)).toEqual(["dr-bad"]);
  });
});

const RULE = { enabled: true, agentId: null, cooldownMinutes: 0, dailyTokenBudget: 100_000, channelIds: ["ch1", "ch-off"] };

describe("triage runner", () => {
  it("investigates, writes the notebook, records proposals and usage, and notifies enabled channels", async () => {
    const rule = await store.saveRule("data_health_incident", RULE, "owner");
    const [subject] = await newSubjects("data_health_incident", T0);
    const run = await runner.triageSubject(rule, subject);
    expect(run).toMatchObject({ status: "completed", summary: "A merge storm filled the disk.", actionIds: ["act-1"], tokens: 1_500, costUsd: 0.02 });
    // No user: usage stays "background"; proposals are recorded for the rule's owner.
    expect(calls[0].ctx).toMatchObject({ connectionId: "c1", proposeAs: "owner", permissions: [], isAdmin: false });
    expect(calls[0].ctx.userId).toBeUndefined();
    expect(calls[0].input).toMatchObject({ trigger: "data_health_incident", connectionId: "c1" });
    const notebook = await notebooks.findByAttachment("incident_data_health", "dh1");
    expect(run?.notebookId).toBe(notebook?.id);
    const cells = await notebooks.listCells(notebook!.id);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ kind: "ai_finding", authorKind: "ai" });
    expect(JSON.stringify(cells[0].content)).toContain("1 proposed action wait");
    // Notebooks show findings as plain text, so no Markdown markers.
    expect(JSON.stringify(cells[0].content)).not.toContain("**");
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toBe("CHouse AI investigated: Orders fresh: No rows for 3h");
    expect(sent[0].text).toContain("Likely cause: Too many small inserts into events.");
  });

  it("never investigates the same subject twice", async () => {
    const rule = await store.getRule("data_health_incident");
    const [subject] = await newSubjects("data_health_incident", T0);
    expect(await runner.triageSubject(rule, subject)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("skips within the cooldown and past the daily budget", async () => {
    const rule = await store.saveRule("scheduled_run_failed", { ...RULE, cooldownMinutes: 60 }, "owner");
    const [subject] = await newSubjects("scheduled_run_failed", T0);
    await store.claimRun({ trigger: "scheduled_run_failed", id: "earlier", title: "Earlier", connectionId: "c1" });
    const skipped = await runner.triageSubject(rule, subject);
    expect(skipped).toMatchObject({ status: "skipped" });
    expect(skipped?.reason).toContain("Cooldown");
    expect(calls).toHaveLength(0);

    const broke = await store.saveRule("fleet_alert", { ...RULE, dailyTokenBudget: 1_000 }, "owner");
    const spent = await store.claimRun({ trigger: "fleet_alert", id: "spent", title: "Spent", connectionId: "other" });
    await store.finishRun(spent!.id, { status: "completed", tokens: 1_000 });
    const [alert] = await newSubjects("fleet_alert", T0);
    const overBudget = await runner.triageSubject(broke, alert);
    expect(overBudget?.reason).toContain("Daily token budget used");
    expect(calls).toHaveLength(0);
  });

  it("records a failed investigation without notifying", async () => {
    behaviour = async () => { throw new Error("The model is unavailable"); };
    const rule = await store.saveRule("observe_incident", RULE, "owner");
    const [subject] = await newSubjects("observe_incident", T0);
    const run = await runner.triageSubject(rule, subject);
    expect(run).toMatchObject({ status: "failed", error: "The model is unavailable", tokens: 1_500, actionIds: ["act-1"] });
    expect(sent).toEqual([]);
  });

  it("only looks at enabled rules, and only at what is newer than the watermark", async () => {
    // Doctor reports: enabled now, so the existing report (older than the watermark) is left alone.
    await store.saveRule("doctor_report", RULE, "owner");
    await runner.triageTick();
    expect(calls.map((c) => c.input.trigger)).not.toContain("doctor_report");
    const ts = Date.now() + 1_000;
    await h.rawRun(sql`INSERT INTO doctor_reports (id, created_at, status, summary, analysis) VALUES ('dr-new', ${ts}, 'warning', 'Replication lag', '{}')`);
    await runner.triageTick();
    expect(calls.filter((c) => c.input.trigger === "doctor_report").map((c) => c.input.connectionId)).toEqual([null]);
    expect((await store.getRule("doctor_report")).watermark).toBe(ts);
    expect((await store.runForSubject("doctor_report", "dr-new"))?.status).toBe("completed");
    // A rule turned off is not looked at.
    await store.saveRule("doctor_report", { ...RULE, enabled: false }, "owner");
    await h.rawRun(sql`INSERT INTO doctor_reports (id, created_at, status, summary, analysis) VALUES ('dr-later', ${ts + 1}, 'warning', 'Later', '{}')`);
    calls.length = 0;
    await runner.triageTick();
    expect(calls).toHaveLength(0);
  });
});
