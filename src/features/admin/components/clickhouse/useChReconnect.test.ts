import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import { isNoSessionError } from "./useChReconnect";

describe("isNoSessionError", () => {
  it("recognises a stale connection context (ADR 0010)", () => {
    expect(isNoSessionError(new ApiError("Connection context is stale", 409, "CONNECTION_CONTEXT_STALE"))).toBe(true);
  });

  it("recognises the legacy NO_SESSION code and message", () => {
    expect(isNoSessionError(new ApiError("x", 400, "NO_SESSION"))).toBe(true);
    expect(isNoSessionError(new Error("No active ClickHouse session"))).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isNoSessionError(new ApiError("Forbidden", 403, "FORBIDDEN"))).toBe(false);
    expect(isNoSessionError(new Error("boom"))).toBe(false);
  });
});
