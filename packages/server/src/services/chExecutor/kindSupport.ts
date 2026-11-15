/**
 * Which connection kinds a ClickHouse server can run (ADR 0033 §5 to §7),
 * found out before anyone fills in a login: a kind the server cannot run is
 * blocked with the reason and the server's version, instead of failing a
 * check afterwards.
 *
 * It asks the server, not a version table. Two things decide, and both can be
 * asked of any login without a grant (observed on 24.3.18, 24.4.4, 25.10.7,
 * 26.3.63 and 26.5.7):
 *
 *   a role on a request   a request naming a role that does not exist answers
 *                         511 (UNKNOWN_ROLE) where the server takes the
 *                         setting, and 115 (UNKNOWN_SETTING) where it does not
 *                         (before 24.4)
 *   EXECUTE AS            `EXPLAIN AST EXECUTE AS x SELECT 1` prints a tree
 *                         where the server knows the statement, and is a
 *                         syntax error (62) where it does not
 *
 * A personal connection also needs the server to pass the self-test
 * (`selfTest.ts`), which needs the prepared login and so runs at the check.
 */

import type { ConnectionConfig } from "../../types";
import { clickhouseErrorCode } from "./errors";
import { executorForConfig } from "./executor";
import { serviceActor, type ChExecutor } from "./types";

export const KIND_SUPPORT_STATES = ["available", "unavailable", "unknown"] as const;
export type KindSupportState = (typeof KIND_SUPPORT_STATES)[number];

export interface KindSupport {
  /** `shared`, `shared_ceiling` or `personal`. */
  kind: string;
  state: KindSupportState;
  /** One sentence for the person choosing a kind: why it is or is not available here. */
  reason: string;
}

export interface ServerSupport {
  /** What the server answered to `SELECT version()`, or null when it did not answer. */
  serverVersion: string | null;
  kinds: KindSupport[];
}

const PROBE_SECONDS = 8;
const UNKNOWN_SETTING = 115;
const UNKNOWN_ROLE = 511;
const SET_NON_GRANTED_ROLE = 512;
const SYNTAX_ERROR = 62;
/** A role name no server has: the probe needs the server's answer to the setting, not a role. */
const PROBE_ROLE = "chouse_probe_no_such_role";

function handle(config: ConnectionConfig, role: string | null): ChExecutor {
  // `roleOverride` sends exactly this request, whatever the connection's kind or health is.
  return executorForConfig({ ...config, identity: undefined }, serviceActor("version-probe"), { roleOverride: role, context: { source: "kind_support" } }).onServiceLane();
}

async function text(client: ChExecutor, query: string): Promise<string> {
  const result = await client.query({ query, format: "TabSeparatedRaw", abort_signal: AbortSignal.timeout(PROBE_SECONDS * 1000), clickhouse_settings: { max_execution_time: PROBE_SECONDS } });
  return (await result.text()).trim();
}

function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0].trim().slice(0, 200);
}

type Answer = "yes" | "no" | "unknown";

/** Whether the server takes a ClickHouse role on a request. */
async function takesRole(config: ConnectionConfig): Promise<Answer> {
  try {
    await text(handle(config, PROBE_ROLE), "SELECT 1");
    return "yes";
  } catch (error) {
    const code = clickhouseErrorCode(error);
    if (code === UNKNOWN_ROLE || code === SET_NON_GRANTED_ROLE) return "yes";
    if (code === UNKNOWN_SETTING && /\bSetting role\b/.test(error instanceof Error ? error.message : String(error))) return "no";
    return "unknown";
  }
}

/** Whether the server knows the `EXECUTE AS` statement. Parsing only: nothing runs as anyone. */
async function knowsExecuteAs(config: ConnectionConfig): Promise<Answer> {
  try {
    const printout = await text(handle(config, null), "EXPLAIN AST EXECUTE AS chouse_probe_no_such_user SELECT 1");
    return /^ExecuteAsQuery\b/.test(printout) ? "yes" : "unknown";
  } catch (error) {
    return clickhouseErrorCode(error) === SYNTAX_ERROR ? "no" : "unknown";
  }
}

const SHARED_REASON = "Works on every ClickHouse version CHouse UI supports.";

/** What each kind's support is, from the three answers. Exported for tests. */
export function supportFrom(serverVersion: string | null, role: Answer, executeAs: Answer): ServerSupport {
  const on = serverVersion ? `ClickHouse ${serverVersion}` : "This server";
  const ceiling: KindSupport = role === "yes"
    ? { kind: "shared_ceiling", state: "available", reason: `${on} takes a ClickHouse role on a request.` }
    : role === "no"
      ? { kind: "shared_ceiling", state: "unavailable", reason: `${on} does not take a ClickHouse role on a request. The role ceiling needs ClickHouse 24.4 or newer.` }
      : { kind: "shared_ceiling", state: "unknown", reason: "CHouse UI could not tell whether this server takes a ClickHouse role on a request. The check will." };
  let personal: KindSupport;
  if (role === "no") {
    personal = { kind: "personal", state: "unavailable", reason: `${on} does not take a ClickHouse role on a request, and has no EXECUTE AS. A personal connection needs a newer ClickHouse (26.3.63 passes every check).` };
  } else if (executeAs === "no") {
    personal = { kind: "personal", state: "unavailable", reason: `${on} has no EXECUTE AS statement. A personal connection needs a ClickHouse build that has it and checks grants for everything run that way (26.3.63 does).` };
  } else if (role === "yes" && executeAs === "yes") {
    personal = { kind: "personal", state: "available", reason: `${on} has EXECUTE AS. Whether it checks grants for everything run that way is tested when you press Check (26.3.63 passes; 26.5.7 does not).` };
  } else {
    personal = { kind: "personal", state: "unknown", reason: "CHouse UI could not tell whether this server has EXECUTE AS. The check will." };
  }
  return { serverVersion, kinds: [{ kind: "shared", state: "available", reason: SHARED_REASON }, ceiling, personal] };
}

/**
 * Ask a server which kinds it can run, with any login that can connect. A
 * server that does not answer makes every kind but `shared` unknown: nothing
 * is blocked on a guess.
 */
export async function probeKindSupport(config: ConnectionConfig): Promise<ServerSupport> {
  let serverVersion: string | null;
  try {
    serverVersion = (await text(handle(config, null), "SELECT version()")) || null;
  } catch (error) {
    const reason = `CHouse UI could not reach the server to find out: ${firstLine(error)}`;
    return { serverVersion: null, kinds: [{ kind: "shared", state: "available", reason: SHARED_REASON }, { kind: "shared_ceiling", state: "unknown", reason }, { kind: "personal", state: "unknown", reason }] };
  }
  const [role, executeAs] = await Promise.all([takesRole(config), knowsExecuteAs(config)]);
  return supportFrom(serverVersion, role, executeAs);
}

/** The support of one kind, or undefined for a kind this version does not know. */
export function supportOf(support: ServerSupport, kind: string): KindSupport | undefined {
  return support.kinds.find((entry) => entry.kind === kind);
}
