import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import type { Page, Request } from "@playwright/test";

/**
 * Deterministic API replay for visual parity (ADR 0016, gate 9).
 *
 * Playwright's HAR replay matches POST bodies byte-for-byte, but query bodies
 * carry per-request ids and wall-clock values, so most live-data requests would
 * miss and fall through to the live server. This recorder keys each request by
 * method + path + query + body with UUIDs, ISO timestamps and epoch numbers
 * blanked out, and always replays the first recorded response per key.
 */

interface RecordedResponse {
  status: number;
  contentType: string;
  body: string;
}

type FixtureFile = Record<string, RecordedResponse[]>;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g;
const EPOCH = /\b1\d{9}(\d{3})?\b/g;
// Auth stays live so replayed tokens can never replace the session's own.
const API = /\/api\/(?!rbac\/auth\/)/;

function normalize(value: string): string {
  return value.replace(UUID, "<uuid>").replace(ISO, "<ts>").replace(EPOCH, "<epoch>");
}

function keyFor(request: Request): string {
  const url = new URL(request.url());
  return `${request.method()} ${normalize(url.pathname + url.search)} ${normalize(request.postData() ?? "")}`;
}

function fixturePath(name: string): string {
  return `e2e/ui/fixtures/${name}.json.gz`;
}

function load(name: string): FixtureFile {
  const path = fixturePath(name);
  if (!existsSync(path)) return {};
  return JSON.parse(gunzipSync(readFileSync(path)).toString("utf8")) as FixtureFile;
}

export async function replayApi(page: Page, name: string): Promise<void> {
  if (process.env.PW_UPDATE_API_FIXTURE === "1") {
    const recorded: FixtureFile = {};
    page.on("response", async (response) => {
      const request = response.request();
      if (!API.test(request.url())) return;
      try {
        const body = await response.text();
        const key = keyFor(request);
        if (recorded[key]) return;
        recorded[key] = [{ status: response.status(), contentType: response.headers()["content-type"] ?? "application/json", body }];
      } catch {
        // streamed or aborted responses are not replayable; the live server serves them
      }
    });
    page.on("close", () => {
      const path = fixturePath(name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, gzipSync(JSON.stringify(recorded)));
    });
    return;
  }

  const fixture = load(name);
  await page.route(API, async (route) => {
    const key = keyFor(route.request());
    const responses = fixture[key];
    if (!responses || responses.length === 0) {
      if (process.env.PW_DEBUG_API_FIXTURE === "1") console.log(`[fixture miss] ${name}: ${key.slice(0, 400)}`);
      await route.fallback();
      return;
    }
    // Always the first recording: pages that poll must render the same frame every time.
    const recorded = responses[0];
    await route.fulfill({ status: recorded.status, contentType: recorded.contentType, body: recorded.body });
  });
}
