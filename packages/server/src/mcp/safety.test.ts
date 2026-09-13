import { describe, expect, it } from "bun:test";
import {
  applyCaps,
  cappedJson,
  redactSecrets,
  DEFAULT_MAX_BYTES,
} from "./safety";

describe("redactSecrets", () => {
  it("masks personal access tokens inside strings", () => {
    const value = "Authorization failed for ch_pat_AbCdEf123456789012345678";
    expect(redactSecrets(value)).toBe("Authorization failed for ch_pat_***");
  });

  it("masks values under secret-shaped keys", () => {
    const result = redactSecrets({
      password: "hunter2",
      clientSecret: "s3cr3t-value-long",
      apiKey: "key-123456789",
      name: "regular-value",
    });
    expect(result).toEqual({
      password: "***",
      clientSecret: "s3c***",
      apiKey: "key***",
      name: "regular-value",
    });
  });

  it("walks nested objects and arrays", () => {
    const result = redactSecrets({
      connections: [{ host: "ch://x", password: "topsecret" }],
      note: "token ch_pat_ZzYyXxWwVuut1234567890 leaked",
    }) as { connections: Array<{ host: string; password: string }>; note: string };
    expect(result.connections[0]?.password).toBe("top***");
    expect(result.note).toContain("ch_pat_***");
    expect(result.note).not.toContain("ZzYyXxWwVuut");
  });

  it("leaves non-string primitives untouched", () => {
    expect(redactSecrets({ count: 3, ok: true, empty: null })).toEqual({ count: 3, ok: true, empty: null });
  });
});

describe("applyCaps", () => {
  it("caps array rows at the limit and flags truncation", () => {
    const rows = Array.from({ length: 250 }, (_, index) => ({ id: index }));
    const result = applyCaps(rows, { maxRows: 100 });
    const data = result.data as Array<{ id: number }>;
    expect(data.length).toBe(100);
    expect(result.truncated).toBe(true);
  });

  it("keeps short arrays intact without truncation", () => {
    const result = applyCaps([{ a: 1 }, { a: 2 }], { maxRows: 100 });
    expect(result.truncated).toBe(false);
    expect(result.data).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("caps cell length", () => {
    const result = applyCaps({ text: "x".repeat(5000) }, { maxCellChars: 100 });
    const data = result.data as { text: string };
    expect(data.text.length).toBeLessThanOrEqual(101); // 100 + ellipsis char
  });

  it("caps the rows field of an object payload", () => {
    const payload = { rows: Array.from({ length: 500 }, (_, index) => index), total: 500 };
    const result = applyCaps(payload, { maxRows: 50 });
    const data = result.data as { rows: number[]; total: number };
    expect(data.rows.length).toBe(50);
    expect(data.total).toBe(500);
    expect(result.truncated).toBe(true);
  });

  it("halves arrays until the serialized payload fits maxBytes", () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({ id: index, blob: "y".repeat(5000) }));
    const result = applyCaps(rows, { maxRows: 100, maxBytes: 20 * 1024 });
    expect(result.truncated).toBe(true);
    expect(JSON.stringify(result.data).length).toBeLessThanOrEqual(DEFAULT_MAX_BYTES + 64);
  });

  it("truncates oversized scalar payloads", () => {
    const result = applyCaps({ blob: "z".repeat(400 * 1024) }, { maxBytes: 1024 });
    const data = result.data as { truncated: boolean; preview: string };
    expect(data.truncated).toBe(true);
    expect(data.preview.length).toBeLessThanOrEqual(1024);
  });
});

describe("cappedJson", () => {
  it("emits JSON with a truncated marker when caps hit", () => {
    const rows = Array.from({ length: 200 }, (_, index) => index);
    const output = cappedJson(rows, { maxRows: 10 });
    const parsed = JSON.parse(output) as { truncated: boolean; data: number[] };
    expect(parsed.truncated).toBe(true);
    expect(parsed.data.length).toBe(10);
  });

  it("emits plain JSON when nothing is capped", () => {
    const output = cappedJson({ hello: "world" });
    expect(JSON.parse(output)).toEqual({ hello: "world" });
    expect(output).not.toContain("truncated");
  });

  it("redacts secrets in the emitted JSON", () => {
    const output = cappedJson({ note: "ch_pat_SecretValue123456789012" });
    expect(output).toContain("ch_pat_***");
    expect(output).not.toContain("SecretValue");
  });
});
