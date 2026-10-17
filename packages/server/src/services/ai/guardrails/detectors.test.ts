import { describe, expect, it } from "bun:test";

import { detectorById } from "./detectors";

function matches(id: string, text: string): string[] {
  return detectorById(id)!.find(text).map(([s, e]) => text.slice(s, e));
}

describe("guardrail detectors", () => {
  it("finds email addresses", () => {
    expect(matches("email", "contact dana.lee+ops@acme.io, not @handle or a@b")).toEqual(["dana.lee+ops@acme.io"]);
  });

  it("accepts only Luhn-valid card numbers", () => {
    expect(matches("card", "card 4242 4242 4242 4242 order 4242424242424241")).toEqual(["4242 4242 4242 4242"]);
    expect(matches("card", "ts 1697551234567 id 12345678901234")).toEqual([]);
  });

  it("finds phone numbers without catching dates, times or versions", () => {
    expect(matches("phone", "call +1 415-555-0172 or (020) 7946 0958")).toEqual(["+1 415-555-0172", "(020) 7946 0958"]);
    expect(matches("phone", "2026-10-17 12:30:45 v24.8.1 build 1234")).toEqual([]);
  });

  it("parses IPv4 and IPv6 addresses", () => {
    expect(matches("ip", "from 10.2.3.4 and 2001:db8::1, not 999.1.1.1 or 12:30:45")).toEqual(["10.2.3.4", "2001:db8::1"]);
    expect(matches("ip", "version 24.8.1.2")).toEqual(["24.8.1.2"]);
  });

  it("finds secrets", () => {
    expect(matches("aws_key", "key AKIAIOSFODNN7EXAMPLE")).toEqual(["AKIAIOSFODNN7EXAMPLE"]);
    expect(matches("chouse_token", "token ch_pat_abcdefghijklmnopqrstuvwxyz012345")).toHaveLength(1);
    expect(matches("jwt", "Authorization eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U")).toHaveLength(1);
    expect(matches("bearer_token", "Bearer abcdefghijklmnop1234")).toEqual(["Bearer abcdefghijklmnop1234"]);
    expect(matches("private_key", "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----")).toHaveLength(1);
  });

  it("redacts only the password inside a URL", () => {
    expect(matches("password_in_url", "dsn clickhouse://default:s3cr3t@ch-1:8123/db")).toEqual(["s3cr3t"]);
    expect(matches("password_in_url", "https://example.com/path")).toEqual([]);
  });
});
