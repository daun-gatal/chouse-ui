import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { fetchSource, resetUpgradeHosts, upgradeCheckEnabled, UpgradeSourceError } from "./fetch";
import { notesBetween, parseChangelog, resetNotesCache } from "./notes";
import { getReleaseData, newestHubPatch, parseVersionDates, resetReleaseDataCache, upgradeTargets, versionStatus, type ReleaseData } from "./releaseData";
import { compareVersions, expectedSupportEnd, lineOf, plainVersion, supportedLines, supportEndedBy } from "./versions";

// Trimmed copies of the real files fetched on 2 Nov 2026.
const fixture = (name: string): string => readFileSync(path.join(import.meta.dir, "testdata", name), "utf-8");
const TSV = fixture("version_date.tsv");
const HUB_26_8 = fixture("hub-26.8.json");
const CHANGELOG_2026 = fixture("changelog-2026.md");
const CHANGELOG_2025 = fixture("changelog-2025.md");

function data(): ReleaseData {
  const lines = parseVersionDates(TSV);
  return { lines, supported: [...supportedLines(lines)], fetchedAt: 0, hubLines: [], requestedLines: [], errors: [] };
}

describe("versions", () => {
  it("compares numerically, not as strings", () => {
    expect(compareVersions("25.10", "25.8")).toBeGreaterThan(0);
    expect(compareVersions("26.8.36.3", "26.8.34.13")).toBeGreaterThan(0);
    expect(compareVersions("26.8", "26.8.0.0")).toBe(0);
  });

  it("reads the line and the plain version from what version() returns", () => {
    expect(lineOf("25.8.33.6")).toBe("25.8");
    expect(lineOf("26.10")).toBe("26.10");
    expect(lineOf("latest")).toBeNull();
    expect(lineOf("25.8.33.6; DROP")).toBeNull();
    expect(plainVersion("24.8.1.2684-stable")).toBe("24.8.1.2684");
    expect(plainVersion("25.3.2.39.altinitystable")).toBe("25.3.2.39");
    expect(plainVersion("not a version")).toBeNull();
  });

  it("expects LTS lines to last two LTS releases and stable lines three months", () => {
    expect(expectedSupportEnd("26.8")).toEqual({ line: "27.8", month: "2027-08" });
    expect(expectedSupportEnd("26.3")).toEqual({ line: "27.3", month: "2027-03" });
    expect(expectedSupportEnd("26.10")).toEqual({ line: "27.1", month: "2027-01" });
    expect(expectedSupportEnd("26.12")).toEqual({ line: "27.3", month: "2027-03" });
  });
});

describe("release list", () => {
  it("parses lines, LTS and newest patches from version_date.tsv", () => {
    const lines = parseVersionDates(TSV);
    const l268 = lines.find((l) => l.line === "26.8")!;
    expect(l268.lts).toBe(true);
    expect(l268.latestPatch).toBe("26.8.34.13");
    expect(lines.find((l) => l.line === "26.10")!.lts).toBe(false);
    expect(lines[0].line).toBe("26.10");
  });

  it("skips rows it does not recognise", () => {
    expect(parseVersionDates("garbage\nv26.8.1.1-lts\t2026-08-30\nv1.x-lts\t2020")).toHaveLength(1);
    expect(parseVersionDates("")).toEqual([]);
  });

  it("applies the support rule: three newest lines plus two newest LTS", () => {
    expect([...supportedLines(parseVersionDates(TSV))].sort(compareVersions)).toEqual(["26.3", "26.8", "26.9", "26.10"]);
  });

  it("finds the release that ended a line's support", () => {
    const lines = parseVersionDates(TSV);
    expect(supportEndedBy("25.8", lines)?.line).toBe("26.8");
    expect(supportEndedBy("26.7", lines)?.line).toBe("26.10");
    expect(supportEndedBy("26.8", lines)).toBeNull();
  });
});

describe("Docker Hub tags", () => {
  it("keeps only exact x.y.z.w tags of the line and takes the highest", () => {
    expect(newestHubPatch(JSON.parse(HUB_26_8), "26.8")).toEqual({ version: "26.8.36.3", pushed: "2026-10-26" });
  });

  it("ignores variants, other lines, inactive tags and bad shapes", () => {
    const body = { results: [
      { name: "26.8.40.1-alpine", tag_status: "active" },
      { name: "126.8.1.1", tag_status: "active" },
      { name: "26.8.39.1", tag_status: "inactive" },
      { name: "26.8.2.1", tag_status: "active", tag_last_pushed: "not a date" },
    ] };
    expect(newestHubPatch(body, "26.8")).toEqual({ version: "26.8.2.1", pushed: null });
    expect(newestHubPatch({ results: "nope" }, "26.8")).toBeNull();
    expect(newestHubPatch(null, "26.8")).toBeNull();
    expect(newestHubPatch({ results: [] }, "26.8")).toBeNull();
  });
});

describe("version status and targets", () => {
  it("marks 25.8 out of support since 26.8, with no newer patch", () => {
    const s = versionStatus("25.8.33.6", data())!;
    expect(s.supported).toBe(false);
    expect(s.supportEnded?.by).toBe("26.8");
    expect(s.expectedEnd).toBeNull();
    expect(s.newerPatch).toBe(false);
  });

  it("marks an old patch on a supported line as having a newer patch", () => {
    const s = versionStatus("26.3.58.1", data())!;
    expect(s.supported).toBe(true);
    expect(s.newerPatch).toBe(true);
    expect(s.expectedEnd).toEqual({ line: "27.3", month: "2027-03" });
  });

  it("returns an unknown support state for a line not in the list", () => {
    expect(versionStatus("27.4.1.1", data())!.supported).toBeNull();
    expect(versionStatus("weird", data())).toBeNull();
  });

  it("offers the two newest LTS and the newest line, newest LTS recommended", () => {
    const t = upgradeTargets("25.8.33.6", data());
    expect(t.map((x) => `${x.line}:${x.kind}:${x.recommended}`)).toEqual(["26.8:lts:true", "26.3:lts:false", "26.10:stable:false"]);
  });

  it("puts a patch card first when a newer patch exists on a supported line", () => {
    const t = upgradeTargets("26.3.58.1", data());
    expect(t[0]).toMatchObject({ line: "26.3", kind: "patch", patch: "26.3.60.2" });
    expect(t.map((x) => x.line)).toEqual(["26.3", "26.8", "26.10"]);
  });

  it("offers nothing newer to a server on the newest line and patch", () => {
    const d = data();
    const newest = d.lines[0];
    expect(upgradeTargets(newest.latestPatch, d)).toEqual([]);
  });
});

describe("changelog parsing", () => {
  it("reads every breaking-change entry per release, in both heading formats", () => {
    const y2026 = parseChangelog(CHANGELOG_2026);
    expect(y2026.get("26.8")?.notes).toHaveLength(21);
    expect(y2026.get("26.7")?.notes).toHaveLength(12);
    const y2025 = parseChangelog(CHANGELOG_2025);
    expect(y2025.get("25.11")?.notes).toHaveLength(10);
  });

  it("keeps PR numbers and backticked names, and drops author credits", () => {
    const note = parseChangelog(CHANGELOG_2025).get("25.11")!.notes[0];
    expect(note.text).toBe("Remove deprecated `Object` type. #85718.");
    expect(note.prs).toEqual([85718]);
    expect(note.names).toEqual(["Object"]);
    expect(note.id).toBe("25.11#1");
  });

  it("ignores entries outside the breaking-change section", () => {
    const all = [...parseChangelog(CHANGELOG_2026).values()].flatMap((r) => r.notes);
    expect(all.some((n) => n.text.includes("Some improvement"))).toBe(false);
    expect(all).toHaveLength(33);
  });

  it("returns nothing for text with no release headings", () => {
    expect(parseChangelog("# Nothing here\n* not a note").size).toBe(0);
  });
});

// --- network paths, against a local fake -------------------------------------------------

let server: ReturnType<typeof Bun.serve>;
let hits: string[] = [];
const routes: Record<string, () => Response | Promise<Response>> = {};

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      hits.push(url.pathname + url.search);
      const handler = routes[url.pathname + url.search] ?? routes[url.pathname];
      return handler ? handler() : new Response("not found", { status: 404 });
    },
  });
  process.env.CHOUSE_ALLOW_TEST_OVERRIDES = "1";
  process.env.CHOUSE_UPGRADE_TEST_HOSTS = JSON.stringify({ github: `http://localhost:${server.port}`, dockerHub: `http://localhost:${server.port}` });
  resetUpgradeHosts();
});

afterEach(() => {
  hits = [];
  for (const k of Object.keys(routes)) delete routes[k];
  resetReleaseDataCache();
  resetNotesCache();
});

afterAll(() => {
  server.stop(true);
  delete process.env.CHOUSE_ALLOW_TEST_OVERRIDES;
  delete process.env.CHOUSE_UPGRADE_TEST_HOSTS;
  resetUpgradeHosts();
});

describe("fetchSource", () => {
  it("refuses redirects instead of following them", async () => {
    routes["/r"] = () => new Response(null, { status: 302, headers: { Location: "https://evil.example/" } });
    await expect(fetchSource("github", "/r", 1000)).rejects.toBeInstanceOf(UpgradeSourceError);
  });

  it("reports HTTP errors without the response body", async () => {
    routes["/e"] = () => new Response("secret internal details", { status: 500 });
    const err = await fetchSource("github", "/e", 1000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpgradeSourceError);
    expect((err as Error).message).toBe("HTTP 500");
  });

  it("stops reading past the size cap, declared or streamed", async () => {
    routes["/big"] = () => new Response("x".repeat(5000));
    await expect(fetchSource("github", "/big", 1000)).rejects.toThrow("Response too large");
    routes["/stream"] = () => new Response(new ReadableStream({
      start(c) {
        for (let i = 0; i < 10; i++) c.enqueue(new TextEncoder().encode("y".repeat(500)));
        c.close();
      },
    }));
    await expect(fetchSource("github", "/stream", 1000)).rejects.toThrow("Response too large");
  });

  it("gives up on a slow source", async () => {
    routes["/slow"] = async () => {
      await Bun.sleep(400);
      return new Response("late");
    };
    await expect(fetchSource("github", "/slow", 1000, 50)).rejects.toThrow("Timed out");
  });

  it("rejects paths that could escape the fixed origin", async () => {
    await expect(fetchSource("github", "//evil.example/x", 1000)).rejects.toThrow("Invalid source path");
    await expect(fetchSource("github", "/a/../b", 1000)).rejects.toThrow("Invalid source path");
    await expect(fetchSource("github", "/a b", 1000)).rejects.toThrow("Invalid source path");
    expect(hits).toEqual([]);
  });

  it("ignores test hosts unless the override switch is on", async () => {
    process.env.CHOUSE_ALLOW_TEST_OVERRIDES = "0";
    resetUpgradeHosts();
    const { sourceOrigin } = await import("./fetch");
    expect(sourceOrigin("github")).toBe("https://raw.githubusercontent.com");
    process.env.CHOUSE_ALLOW_TEST_OVERRIDES = "1";
    resetUpgradeHosts();
    expect(sourceOrigin("github")).toBe(`http://localhost:${server.port}`);
  });

  it("reads the enable switch", () => {
    const before = process.env.UPGRADE_CHECK_ENABLED;
    for (const [value, expected] of [["true", true], ["1", true], [" TRUE ", true], ["false", false], ["", false], ["yes", false]] as const) {
      process.env.UPGRADE_CHECK_ENABLED = value;
      expect(upgradeCheckEnabled()).toBe(expected);
    }
    if (before === undefined) delete process.env.UPGRADE_CHECK_ENABLED;
    else process.env.UPGRADE_CHECK_ENABLED = before;
  });
});

describe("getReleaseData", () => {
  const TSV_PATH = "/ClickHouse/ClickHouse/master/utils/list-versions/version_date.tsv";
  const HUB_PATH = "/v2/repositories/clickhouse/clickhouse-server/tags";

  it("merges the newest Docker Hub patch, asks once per line and caches for a day", async () => {
    routes[TSV_PATH] = () => new Response(TSV);
    routes[HUB_PATH] = () => new Response(HUB_26_8);
    const first = await getReleaseData([], 1_000);
    expect(first!.lines.find((l) => l.line === "26.8")!.latestPatch).toBe("26.8.36.3");
    expect(first!.hubLines).toContain("26.8");
    const hubCalls = hits.filter((h) => h.startsWith(HUB_PATH));
    expect(hubCalls).toHaveLength(4);
    expect(hubCalls.every((h) => /name=\d+\.\d+\.$/.test(h))).toBe(true);
    hits = [];
    await getReleaseData([], 2_000);
    expect(hits).toEqual([]);
  });

  it("asks Docker Hub about an extra line once, even when it fails", async () => {
    routes[TSV_PATH] = () => new Response(TSV);
    routes[HUB_PATH] = () => new Response("{}", { status: 503 });
    const first = await getReleaseData(["25.8"], 1_000);
    expect(first!.errors.length).toBe(5);
    expect(first!.lines.find((l) => l.line === "26.8")!.latestPatch).toBe("26.8.34.13");
    hits = [];
    await getReleaseData(["25.8"], 2_000);
    expect(hits).toEqual([]);
  });

  it("keeps the last good copy and backs off when the list cannot be read", async () => {
    routes[TSV_PATH] = () => new Response(TSV);
    routes[HUB_PATH] = () => new Response(HUB_26_8);
    const good = await getReleaseData([], 1_000);
    routes[TSV_PATH] = () => new Response("down", { status: 500 });
    const later = 1_000 + 25 * 60 * 60 * 1000;
    expect(await getReleaseData([], later)).toBe(good);
    hits = [];
    expect(await getReleaseData([], later + 60_000)).toBe(good);
    expect(hits).toEqual([]);
  });

  it("returns null when nothing was ever read", async () => {
    routes[TSV_PATH] = () => new Response("not a release list");
    expect(await getReleaseData([], 1_000)).toBeNull();
  });

  it("shares one refresh between concurrent callers", async () => {
    routes[TSV_PATH] = () => new Response(TSV);
    routes[HUB_PATH] = () => new Response(HUB_26_8);
    const [a, b] = await Promise.all([getReleaseData([], 1_000), getReleaseData([], 1_000)]);
    expect(a).toBe(b);
    expect(hits.filter((h) => h === TSV_PATH)).toHaveLength(1);
  });
});

describe("notesBetween", () => {
  const CHANGELOG = "/ClickHouse/ClickHouse/master/CHANGELOG.md";
  const Y2025 = "/ClickHouse/clickhouse-docs/main/docs/whats-new/changelog/2025.md";

  it("takes this year's lines from CHANGELOG.md and earlier ones from the yearly file", async () => {
    routes[CHANGELOG] = () => new Response(CHANGELOG_2026);
    routes[Y2025] = () => new Response(CHANGELOG_2025);
    const r = await notesBetween("25.10", "26.8", ["25.11", "26.7", "26.8", "26.9"], 1_000);
    expect(r.lines).toEqual(["25.11", "26.7", "26.8"]);
    expect(r.missingLines).toEqual([]);
    expect(r.notes).toHaveLength(10 + 12 + 21);
    expect(r.notes[0].line).toBe("25.11");
  });

  it("reports lines whose notes could not be read instead of returning silence", async () => {
    routes[CHANGELOG] = () => new Response(CHANGELOG_2026);
    const r = await notesBetween("25.10", "26.8", ["25.11", "26.7", "26.8"], 1_000);
    expect(r.missingLines).toEqual(["25.11"]);
    expect(r.errors[0]).toContain("2025 changelog");
    expect(r.notes).toHaveLength(33);
  });

  it("returns nothing for a patch upgrade inside one line", async () => {
    const r = await notesBetween("26.8", "26.8", ["26.8"], 1_000);
    expect(r).toEqual({ notes: [], lines: [], missingLines: [], errors: [] });
    expect(hits).toEqual([]);
  });
});
