import { describe, expect, it } from "bun:test";

import { classifyError, errorName } from "./errorClass";
import { classifyPipeline, type PipelineSample } from "./pipelineStatus";

const NOW = 1_800_000_000_000;

function sample(overrides: Partial<PipelineSample>, minutesAgo: number): PipelineSample {
  return {
    sampledAt: NOW - minutesAgo * 60_000,
    unitsIn: 100,
    bytesIn: 1000,
    lastSuccessAt: NOW - minutesAgo * 60_000,
    lagSeconds: null,
    backlog: null,
    backlogUnit: null,
    errors: 0,
    errorSample: null,
    errorClass: null,
    progressing: true,
    ...overrides,
  };
}

const ctx = { nowMs: NOW, cadenceSeconds: 60 };

describe("classifyPipeline — one vocabulary for every source", () => {
  it("healthy when making progress", () => {
    expect(classifyPipeline([sample({}, 2), sample({}, 1), sample({}, 0)], ctx).status).toBe("healthy");
  });

  it("retrying: a queue engine replaying the same batch (Kafka, RabbitMQ, NATS alike)", () => {
    const failing = { progressing: false, errors: 12, errorSample: "Code: 241. MEMORY_LIMIT_EXCEEDED (MEMORY_LIMIT_EXCEEDED)", lastSuccessAt: NOW - 3600_000 };
    const verdict = classifyPipeline([sample(failing, 2), sample(failing, 1), sample(failing, 0)], ctx);
    expect(verdict.status).toBe("retrying");
    expect(verdict.reason).toContain("MEMORY_LIMIT_EXCEEDED");
  });

  it("stalled: object-storage files stuck in processing without errors", () => {
    const stuck = { progressing: false, errors: 0, backlog: 40, backlogUnit: "files", lastSuccessAt: NOW - 600_000 };
    const verdict = classifyPipeline([sample(stuck, 2), sample(stuck, 1), sample(stuck, 0)], ctx);
    expect(verdict.status).toBe("stalled");
    expect(verdict.reason).toContain("40 files");
  });

  it("failing: some refreshes or inserts fail while others succeed", () => {
    expect(classifyPipeline([sample({}, 2), sample({ errors: 2, errorSample: "x" }, 1), sample({}, 0)], ctx).status).toBe("failing");
  });

  it("stopped: a writer that went quiet beyond 3x its cadence", () => {
    const quiet = { unitsIn: 0, lastSuccessAt: NOW - 3600_000, progressing: null };
    expect(classifyPipeline([sample(quiet, 2), sample(quiet, 1), sample(quiet, 0)], ctx).status).toBe("stopped");
  });

  it("never stopped when nothing promises another run (manual or disabled job)", () => {
    const quiet = { unitsIn: 0, lastSuccessAt: NOW - 3600_000, progressing: null };
    const verdict = classifyPipeline([sample(quiet, 2), sample(quiet, 1), sample(quiet, 0)], { ...ctx, expectsRecurring: false });
    expect(verdict.status).toBe("healthy");
  });

  it("never infers stopped without a known cadence (one-off writer)", () => {
    const quiet = { unitsIn: 0, lastSuccessAt: NOW - 6 * 3600_000, progressing: null };
    expect(classifyPipeline([sample(quiet, 0)], { nowMs: NOW, cadenceSeconds: null }).status).toBe("healthy");
  });

  it("reports a deliberately switched-off pipeline as paused, whatever its history", () => {
    const failing = { errors: 3, errorSample: "boom", progressing: false };
    const verdict = classifyPipeline([sample(failing, 2), sample(failing, 1), sample(failing, 0)], { ...ctx, paused: "The job is disabled" });
    expect(verdict).toEqual({ status: "paused", reason: "The job is disabled" });
  });

  describe("discrete runs", () => {
    const run = (failure: string | null, minutesAgo: number, errors = 0): PipelineSample => sample({ lastRunFailure: failure, errors }, minutesAgo);

    it("is failing while the latest run failed, however old", () => {
      const verdict = classifyPipeline([run("boom", 2, 1), run("boom", 1, 1), run("boom", 0, 1)], { nowMs: NOW, cadenceSeconds: 86_400 });
      expect(verdict).toEqual({ status: "failing", reason: "Last run failed: boom" });
    });

    it("recovers as soon as a run succeeds, ignoring earlier failed samples", () => {
      const verdict = classifyPipeline([run("boom", 2, 1), run("boom", 1, 1), run(null, 0)], { nowMs: NOW, cadenceSeconds: 86_400 });
      expect(verdict.status).toBe("healthy");
    });
  });

  it("a daily cadence tolerates a quiet day", () => {
    const quiet = { unitsIn: 0, lastSuccessAt: NOW - 20 * 3600_000, progressing: null };
    expect(classifyPipeline([sample(quiet, 0)], { nowMs: NOW, cadenceSeconds: 86_400 }).status).toBe("healthy");
  });

  it("lagging: replication or consumer lag over the limit, or a growing backlog", () => {
    expect(classifyPipeline([sample({ lagSeconds: 900 }, 0)], ctx).status).toBe("lagging");
    const growing = [sample({ backlog: 10, backlogUnit: "rows" }, 2), sample({ backlog: 20, backlogUnit: "rows" }, 1), sample({ backlog: 30, backlogUnit: "rows" }, 0)];
    expect(classifyPipeline(growing, ctx).status).toBe("lagging");
  });

  it("inefficient: adapter-reported small inserts", () => {
    expect(classifyPipeline([sample({ inefficiency: "avg 14 rows per insert" }, 0)], ctx)).toEqual({ status: "inefficient", reason: "avg 14 rows per insert" });
  });

  it("unsupported_on_version names the missing evidence", () => {
    expect(classifyPipeline([], { ...ctx, unsupported: "system.view_refreshes missing on 23.8" }).status).toBe("unsupported_on_version");
  });
});

describe("classifyError", () => {
  it("reads the trailing error name, ignoring the version suffix", () => {
    expect(errorName("Code: 241. DB::Exception: x (MEMORY_LIMIT_EXCEEDED) (version 25.3.1.1)")).toBe("MEMORY_LIMIT_EXCEEDED");
  });

  it("maps names to RCA layers", () => {
    expect(classifyError("… (MEMORY_LIMIT_EXCEEDED)")).toBe("engine");
    expect(classifyError("… (S3_ERROR)")).toBe("external");
    expect(classifyError("… (POSTGRESQL_CONNECTION_FAILURE)")).toBe("external");
    expect(classifyError("… (CANNOT_PARSE_TEXT)")).toBe("data");
    expect(classifyError("… (UNKNOWN_TABLE)")).toBe("config");
    expect(classifyError(null)).toBeNull();
  });
});
