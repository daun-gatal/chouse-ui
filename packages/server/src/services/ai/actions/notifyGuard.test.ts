/**
 * ADR 0026 §8: no AI tool — chat, MCP or the CLI (which runs the same action
 * definitions) — may write a channel's credentials or mode, its "who can act"
 * allowlist, Chobi's alert settings, the remediation channels, linked chat
 * accounts or the platform callbacks. The coverage gate cannot catch this on
 * its own: alerting:edit already counts as covered by the rule tools. So every
 * write a tool source makes is checked against the paths that stay a person's.
 */

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { ACTION_DEFINITIONS } from "./definitions";

const ROOT = join(import.meta.dir, "..", "..", "..");
const SOURCES = [
  ...readdirSync(join(ROOT, "services/ai/actions/toolkits")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => join(ROOT, "services/ai/actions/toolkits", f)),
  ...readdirSync(join(ROOT, "mcp/tools")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => join(ROOT, "mcp/tools", f)),
  join(ROOT, "services/ai/assistant/tools.ts"),
  join(ROOT, "services/ai/actions/tools.ts"),
];

/** The path argument of every write call in a source: `.post("/x"`, `.put(\`/x/${…}\``, `request("DELETE", "/x"`. */
function writePaths(source: string): string[] {
  const out: string[] = [];
  const call = /\.(post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*([`"'])([^`"']+)\2/g;
  const request = /request\(\s*["'](POST|PUT|PATCH|DELETE)["']\s*,\s*([`"'])([^`"']+)\2/g;
  for (const match of source.matchAll(call)) out.push(match[3]);
  for (const match of source.matchAll(request)) out.push(match[3]);
  return out;
}

const PERSON_ONLY: Array<{ path: RegExp; why: string }> = [
  { path: /^\/api\/alerting\/channels(\/\$\{[^}]+\})?$/, why: "creating, editing or deleting a channel (credentials, mode, who can act)" },
  { path: /^\/api\/alerting\/settings/, why: "where remediation approvals are posted" },
  { path: /^\/api\/chobi\/settings/, why: "Chobi's settings, Need You alerts included" },
  { path: /^\/api\/chat-identities/, why: "linked chat accounts" },
  { path: /^\/api\/integrations/, why: "platform callbacks" },
];

describe("AI tools never change who can act from chat", () => {
  it("finds the write calls it checks (the scan works)", () => {
    const all = SOURCES.flatMap((file) => writePaths(readFileSync(file, "utf8")));
    expect(all).toContain("/api/alerting/rules");
    expect(all.some((p) => p.startsWith("/api/alerting/channels/") && p.endsWith("/test"))).toBe(true);
  });

  for (const file of SOURCES) {
    it(`${file.slice(ROOT.length + 1)} writes none of the person-only paths`, () => {
      for (const path of writePaths(readFileSync(file, "utf8"))) {
        for (const rule of PERSON_ONLY) {
          if (rule.path.test(path)) throw new Error(`${path} is a person's decision: ${rule.why}`);
        }
      }
    });
  }

  it("no action definition is named for those settings", () => {
    const names = ACTION_DEFINITIONS.map((d) => d.name);
    for (const forbidden of ["create_alert_channel", "update_alert_channel", "delete_alert_channel", "update_chobi_settings", "link_chat_account", "set_channel_actors"]) {
      expect(names).not.toContain(forbidden);
    }
  });
});
