import { describe, it, expect } from "bun:test";
import { describeSsoError } from "./errors";

describe("describeSsoError", () => {
  it("extracts oauth fields from a ResponseBodyError-like error", () => {
    const err = Object.assign(new Error("authorization response error"), {
      code: "OAUTH_RESPONSE_BODY_ERROR",
      error: "invalid_grant",
      error_description: "Malformed auth code.",
    });

    expect(describeSsoError(err)).toEqual({
      err: "authorization response error",
      code: "OAUTH_RESPONSE_BODY_ERROR",
      oauthError: "invalid_grant",
      oauthErrorDescription: "Malformed auth code.",
    });
  });

  it("captures a nested Error cause", () => {
    const err = new Error("discovery failed", { cause: new Error("ENOTFOUND accounts.google.com") });
    const result = describeSsoError(err);
    expect(result.err).toBe("discovery failed");
    expect(result.cause).toBe("ENOTFOUND accounts.google.com");
  });

  it("captures a string cause", () => {
    const err = Object.assign(new Error("boom"), { cause: "raw cause string" });
    expect(describeSsoError(err).cause).toBe("raw cause string");
  });

  it("returns just the message for a plain Error with no extra fields", () => {
    expect(describeSsoError(new Error("plain"))).toEqual({ err: "plain" });
  });

  it("ignores non-string structured fields", () => {
    const err = Object.assign(new Error("x"), { code: 500, error: { nested: true } });
    expect(describeSsoError(err)).toEqual({ err: "x" });
  });

  it("stringifies a non-Error value", () => {
    expect(describeSsoError("just a string")).toEqual({ err: "just a string" });
    expect(describeSsoError(undefined)).toEqual({ err: "undefined" });
  });
});
