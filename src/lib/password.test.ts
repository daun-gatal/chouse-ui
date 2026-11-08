import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePassword, secureRandomInt } from "./password";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generatePassword", () => {
  it("is 16 characters with every character class by default", () => {
    for (let i = 0; i < 200; i++) {
      const pwd = generatePassword();
      expect(pwd).toHaveLength(16);
      expect(pwd).toMatch(/[A-Z]/);
      expect(pwd).toMatch(/[a-z]/);
      expect(pwd).toMatch(/[0-9]/);
      expect(pwd).toMatch(/[!@#$%^&*]/);
      expect(pwd).not.toMatch(/[0O1lI]/);
    }
  });

  it("never uses Math.random", () => {
    const spy = vi.spyOn(Math, "random");
    generatePassword(32);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects lengths too short to hold every class", () => {
    expect(() => generatePassword(3)).toThrow(RangeError);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generatePassword()));
    expect(seen.size).toBe(500);
  });
});

describe("secureRandomInt", () => {
  it("stays in range", () => {
    for (let i = 0; i < 1000; i++) {
      const n = secureRandomInt(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
  });

  it("rejects values above the unbiased limit instead of folding them", () => {
    // 2^32 is not a multiple of 3, so the top value must be redrawn.
    const values = [0xffffffff, 4];
    vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      (array as unknown as Uint32Array)[0] = values.shift() ?? 0;
      return array;
    });
    expect(secureRandomInt(3)).toBe(1);
  });

  it("rejects a bad range", () => {
    expect(() => secureRandomInt(0)).toThrow(RangeError);
    expect(() => secureRandomInt(1.5)).toThrow(RangeError);
  });
});
