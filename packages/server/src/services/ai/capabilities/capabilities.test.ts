/**
 * Capability wiring tests — the deterministic parts (registry integrity, input
 * validation, finalize mapping, soft-fail / parse-failure behavior). The agent
 * loop itself needs a live model and is exercised via integration, not here.
 */

import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { CAPABILITIES, CAPABILITY_IDS, getCapability } from "./index";
import { optimizeQueryCapability } from "./optimizeQuery";
import { optimizeLogCapability } from "./optimizeLog";
import { debugQueryCapability } from "./debugQuery";
import { checkOptimizeCapability } from "./checkOptimize";
import { diagnoseErrorCapability, diagnosePartsCapability } from "./diagnose";
import { fleetScanCapability } from "./fleetScan";
import { draftScheduledQueryCapability, recommendHealthPromiseCapability, summarizeScheduledQueryCapability } from "./dataOps";
import { diagnoseSchemaCapability } from "./diagnose";
import { needsPlaybook } from "./fleetScan";
import {
  stripFormatClause,
  QueryOptimizationOutputSchema,
} from "./optimizerShared";
import { AppError } from "../../../types";

const META = { raw: "x", steps: [], modelLabel: "test-model" };

describe("capability registry", () => {
  it("keys match capability ids", () => {
    for (const [key, cap] of Object.entries(CAPABILITIES)) {
      expect(cap.id).toBe(key);
    }
  });

  it("every capability declares a permission + input schema", () => {
    for (const cap of Object.values(CAPABILITIES)) {
      expect(typeof cap.permission).toBe("string");
      expect(cap.inputSchema).toBeDefined();
      expect(cap.delivery === "structured" || cap.delivery === "invoke").toBe(true);
    }
  });

  it("getCapability resolves known ids and rejects unknown", () => {
    expect(getCapability("optimize-query")).toBe(optimizeQueryCapability);
    expect(getCapability("nope")).toBeUndefined();
  });

  it("exposes all 22 capabilities", () => {
    expect(CAPABILITY_IDS).toHaveLength(22);
    expect(CAPABILITY_IDS).toContain("explain-incident");
    expect(CAPABILITY_IDS).toContain("compile-watcher");
    expect(CAPABILITY_IDS).toContain("draft-table-context");
  });
});

describe("input validation", () => {
  it("optimize-query requires a non-empty query", () => {
    expect(optimizeQueryCapability.inputSchema.safeParse({ query: "" }).success).toBe(false);
    expect(optimizeQueryCapability.inputSchema.safeParse({ query: "SELECT 1" }).success).toBe(true);
  });

  it("debug-query requires query + error", () => {
    expect(debugQueryCapability.inputSchema.safeParse({ query: "SELECT 1" }).success).toBe(false);
    expect(
      debugQueryCapability.inputSchema.safeParse({ query: "SELECT 1", error: "boom" }).success,
    ).toBe(true);
  });

  it("diagnose-error requires a name", () => {
    expect(diagnoseErrorCapability.inputSchema.safeParse({}).success).toBe(false);
    expect(diagnoseErrorCapability.inputSchema.safeParse({ name: "TOO_MANY_PARTS" }).success).toBe(true);
  });

  it("validates DataOps capability inputs", () => {
    expect(summarizeScheduledQueryCapability.inputSchema.safeParse({ jobId: "nope" }).success).toBe(false);
    expect(summarizeScheduledQueryCapability.inputSchema.safeParse({ jobId: "00000000-0000-4000-8000-000000000000" }).success).toBe(true);
    expect(draftScheduledQueryCapability.inputSchema.safeParse({ intent: "too short", connectionId: "c", timezone: "UTC" }).success).toBe(true);
    expect(draftScheduledQueryCapability.inputSchema.safeParse({ intent: "short", connectionId: "c", timezone: "UTC" }).success).toBe(false);
  });
});

describe("optimize-query finalize (unified shape)", () => {
  it("strips fences + trailing FORMAT and carries the unified analysis fields", async () => {
    const prepared = { query: "SELECT 1", additionalPrompt: undefined, warnings: ["w"] };
    const parsed = {
      optimizedQuery: "```sql\nSELECT 1 FORMAT JSON\n```",
      summary: "s",
      explanation: "e",
      cause: "c",
      tables: [{ name: "db.t", note: "scans all parts" }],
      suggestions: ["add a date filter"],
    };
    // ctx has no connectionId → EXPLAIN estimate is skipped (no network).
    const out = await optimizeQueryCapability.finalize(parsed, prepared, {}, META);
    expect(out.optimizedQuery).toBe("SELECT 1");
    expect(out.originalQuery).toBe("SELECT 1");
    expect(out.summary).toBe("s");
    expect(out.explanation).toBe("e");
    expect(out.cause).toBe("c");
    expect(out.tables).toEqual([{ name: "db.t", note: "scans all parts" }]);
    expect(out.suggestions).toEqual(["add a date filter"]);
    expect(out.warnings).toEqual(["w"]);
    expect(out.estimate).toBeUndefined();
  });
});

describe("unified optimizer schema", () => {
  it("optimize-query and optimize-log share the same output schema", () => {
    expect(optimizeQueryCapability.outputSchema).toBe(QueryOptimizationOutputSchema);
    expect(optimizeLogCapability.outputSchema).toBe(QueryOptimizationOutputSchema);
  });
});

describe("diagnose finalize naming", () => {
  it("parts diagnosis names db.table", () => {
    const parsed = { summary: "s", cause: "c", impact: "i", solutions: ["x"] };
    const out = diagnosePartsCapability.finalize(
      parsed,
      { node: { id: "1", name: "n" }, input: { database: "db", table: "t" } },
      {},
      META,
    );
    expect(out.name).toBe("db.t");
  });
});

describe("check-optimize soft fail", () => {
  it("returns canOptimize:false with the AppError message", () => {
    const out = checkOptimizeCapability.softFail!(AppError.badRequest("no model"));
    expect(out.canOptimize).toBe(false);
    expect(out.reason).toBe("no model");
  });

  it("returns a generic reason for non-AppErrors", () => {
    const out = checkOptimizeCapability.softFail!(new Error("weird"));
    expect(out).toEqual({ canOptimize: false, reason: "Analysis failed" });
  });
});

describe("feature contracts (ADR 0019)", () => {
  it("every feature describes itself for AI Governance › Assistant", () => {
    for (const cap of Object.values(CAPABILITIES)) {
      expect(cap.title.length).toBeGreaterThan(0);
      expect(cap.description.length).toBeGreaterThan(0);
      expect(["sql-editor", "doctor", "diagnostics", "dataops", "observe", "chat"]).toContain(cap.surface);
      for (const context of cap.contexts) expect(["session", "fleet", "userApi"]).toContain(context);
    }
  });

  it("only the chat provides the user-API context", () => {
    for (const cap of Object.values(CAPABILITIES)) {
      expect(cap.contexts.includes("userApi")).toBe(cap.id === "chat");
    }
  });

  it("optimize-query variables trim the query and default extra instructions to empty", () => {
    expect(optimizeQueryCapability.templateVariables({ query: "  SELECT 1 ", warnings: [] }, {})).toEqual({ query: "SELECT 1", additionalPrompt: "" });
    expect(optimizeQueryCapability.templateVariables({ query: "SELECT 1", additionalPrompt: " go fast " }, {})).toEqual({ query: "SELECT 1", additionalPrompt: "go fast" });
  });

  it("debug-query variables trim query and error", () => {
    expect(debugQueryCapability.templateVariables({ query: " SELEC 1 ", error: " boom " }, {})).toEqual({ query: "SELEC 1", error: "boom", additionalPrompt: "" });
  });

  it("diagnose-error variables fill the pre-registry defaults", () => {
    const vars = diagnoseErrorCapability.templateVariables({ node: { id: "c1", name: "n1" }, input: { name: "X" } }, {});
    expect(vars).toEqual({ "node.id": "c1", "node.name": "n1", "error.code": "?", "error.name": "X", "error.message": "(none)" });
  });

  it("diagnose-schema size line is empty without metrics", () => {
    const vars = diagnoseSchemaCapability.templateVariables(
      { node: { id: "c1", name: "n1" }, input: { database: "db", table: "t", column: "c", columnType: "Int64", category: "oversized" } },
      {},
    );
    expect(vars.sizeLine).toBe("");
  });

  it("fleet-scan asks for the playbook only when a heavy or top-memory query was seen", () => {
    expect(needsPlaybook([{ topMemoryQueries: [], recentHeavyQueries: [] }])).toBe(false);
    expect(needsPlaybook([{ topMemoryQueries: [{}], recentHeavyQueries: [] }])).toBe(true);
    expect(needsPlaybook([{ recentHeavyQueries: [{}] }])).toBe(true);
  });

  it("fleet features bind query_node to the resolved nodes", () => {
    const node = { id: "c1", name: "n1" };
    expect(optimizeLogCapability.fleetNodes!({ node, connectionId: "c1", cleaned: "SELECT 1" })).toEqual([node]);
    expect(diagnosePartsCapability.fleetNodes!({ node, input: { database: "db", table: "t" } })).toEqual([node]);
    expect(fleetScanCapability.fleetNodes!({ nodes: [node], hours: 6, overview: [], startedAt: 0 })).toEqual([node]);
  });

  it("stripFormatClause removes trailing FORMAT + semicolon", () => {
    expect(stripFormatClause("SELECT 1 FORMAT JSON")).toBe("SELECT 1");
    expect(stripFormatClause("SELECT 1;")).toBe("SELECT 1");
  });
});

describe("recommend-health-promise output schema", () => {
  const validRecommendation = {
    summary: "s",
    eventTimeColumn: "event_time",
    checks: [
      {
        checkKey: "row_count_min",
        name: "row count",
        severity: "warning",
        enabled: true,
        type: "row_count",
        config: { min: 1 },
      },
    ],
    breachAfter: 2,
    recoverAfter: 1,
    graceSecs: 0,
    rationale: ["r"],
    confidence: 0.8,
  };

  it("coerces numeric-string breachAfter/recoverAfter/graceSecs (LLMs sometimes emit strings)", () => {
    const result = recommendHealthPromiseCapability.outputSchema.safeParse({
      ...validRecommendation,
      breachAfter: "2",
      recoverAfter: "1",
      graceSecs: "0",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.breachAfter).toBe(2);
      expect(result.data.recoverAfter).toBe(1);
      expect(result.data.graceSecs).toBe(0);
    }
  });

  it("still rejects non-numeric or out-of-range values", () => {
    expect(
      recommendHealthPromiseCapability.outputSchema.safeParse({ ...validRecommendation, graceSecs: "not-a-number" })
        .success,
    ).toBe(false);
    expect(
      recommendHealthPromiseCapability.outputSchema.safeParse({ ...validRecommendation, graceSecs: -1 }).success,
    ).toBe(false);
    expect(
      recommendHealthPromiseCapability.outputSchema.safeParse({ ...validRecommendation, breachAfter: 0 }).success,
    ).toBe(false);
  });
});

/**
 * Strict structured-output modes (OpenAI-compatible providers) reject any schema
 * whose optional field cannot be emitted as null — the SDK throws locally, so the
 * adapter strategy fails on every call until the schema is fixed. Optional output
 * fields must therefore be `.nullish()` (or carry a `.default()`), never a bare
 * `.optional()`.
 */
describe("structured-output schema compatibility", () => {
  function unsafeOptionalFields(schema: z.ZodTypeAny, path: string, seen: Set<z.ZodTypeAny>): string[] {
    if (seen.has(schema)) return [];
    seen.add(schema);

    if (schema instanceof z.ZodObject) {
      const shape: Record<string, z.ZodTypeAny> = schema.shape;
      return Object.entries(shape).flatMap(([key, field]) => [
        ...(field.isOptional() && !field.isNullable() && !(field instanceof z.ZodDefault)
          ? [`${path}.${key}`]
          : []),
        ...unsafeOptionalFields(field, `${path}.${key}`, seen),
      ]);
    }
    if (schema instanceof z.ZodArray) return unsafeOptionalFields(schema.element, `${path}[]`, seen);
    if (schema instanceof z.ZodDiscriminatedUnion || schema instanceof z.ZodUnion) {
      const options: z.ZodTypeAny[] = schema.options;
      return options.flatMap((option, index) => unsafeOptionalFields(option, `${path}|${index}`, seen));
    }
    if (schema instanceof z.ZodEffects) return unsafeOptionalFields(schema.innerType(), path, seen);
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
      return unsafeOptionalFields(schema.unwrap(), path, seen);
    }
    if (schema instanceof z.ZodDefault) return unsafeOptionalFields(schema.removeDefault(), path, seen);
    if (schema instanceof z.ZodRecord) return unsafeOptionalFields(schema.valueSchema, `${path}{}`, seen);
    return [];
  }

  it("detects a bare .optional() field", () => {
    const schema = z.object({ nested: z.object({ note: z.string().optional() }) });
    expect(unsafeOptionalFields(schema, "root", new Set())).toEqual(["root.nested.note"]);
  });

  it("accepts .nullish() and .default() fields", () => {
    const schema = z.object({ a: z.string().nullish(), b: z.string().default("x"), c: z.string().nullable() });
    expect(unsafeOptionalFields(schema, "root", new Set())).toEqual([]);
  });

  it("every structured capability output schema is strict-mode safe", () => {
    for (const cap of Object.values(CAPABILITIES)) {
      if (cap.delivery !== "structured") continue;
      expect({ [cap.id]: unsafeOptionalFields(cap.outputSchema, cap.id, new Set()) })
        .toEqual({ [cap.id]: [] });
    }
  });
});

describe("fleet-scan parse failure", () => {
  it("returns a report with null analysis instead of throwing", () => {
    const prepared = {
      nodes: [{ id: "1", name: "n" }],
      hours: 6,
      overview: [{ id: "1", name: "n", summary: null }],
      startedAt: Date.now(),
    };
    const report = fleetScanCapability.onParseFailure!(prepared, {}, META);
    expect(report).toMatchObject({ analysis: null, nodes: 1, hours: 6, model: "test-model" });
    expect(report.vitals).toHaveLength(1);
  });
});
