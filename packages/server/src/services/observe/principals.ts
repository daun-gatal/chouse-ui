/**
 * Display names for the principals behind queries (ADR 0016): scheduled jobs,
 * agent tokens and people are recorded by id. Names are resolved at read time
 * so a rename shows up everywhere and stored lineage, RCA and usage rows never
 * have to be rewritten.
 */

import type { SQL } from "drizzle-orm";

import { all, sql, str, strOrNull } from "./db";

export type PrincipalKind = "job" | "agent" | "person" | "client";

export interface PrincipalRef {
  kind: string;
  id: string;
}

/** Keeps every IN list well under SQLite's bound-parameter limit. */
const CHUNK = 400;

function chunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK));
  return out;
}

function inList(ids: string[]): SQL {
  return sql.join(ids.map((id) => sql`${id}`), sql`, `);
}

function personName(row: Record<string, unknown>): string {
  return strOrNull(row.display_name) || str(row.username);
}

async function rowsById(ids: string[], query: (list: SQL) => SQL): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const part of chunks(ids)) {
    for (const row of await all(query(inList(part)))) out.set(str(row.id), row);
  }
  return out;
}

/** `kind:id` → display label for jobs, agent tokens, people and ClickHouse clients. */
export async function principalLabels(refs: PrincipalRef[]): Promise<Map<string, string>> {
  const ids = (kind: string): string[] => [...new Set(refs.filter((r) => r.kind === kind).map((r) => r.id))];
  const jobIds = ids("job");
  const patIds = ids("agent");
  const userIds = ids("person");
  const [jobs, pats, users] = await Promise.all([
    jobIds.length ? rowsById(jobIds, (list) => sql`SELECT id, name FROM scheduled_queries WHERE id IN (${list})`) : new Map<string, Record<string, unknown>>(),
    patIds.length
      ? rowsById(patIds, (list) => sql`SELECT k.id, k.name, u.display_name, u.username FROM rbac_api_keys k LEFT JOIN rbac_users u ON u.id = k.user_id WHERE k.id IN (${list})`)
      : new Map<string, Record<string, unknown>>(),
    userIds.length ? rowsById(userIds, (list) => sql`SELECT id, display_name, username FROM rbac_users WHERE id IN (${list})`) : new Map<string, Record<string, unknown>>(),
  ]);
  const out = new Map<string, string>();
  for (const id of jobIds) {
    const job = jobs.get(id);
    out.set(`job:${id}`, job ? str(job.name) : "Deleted scheduled query");
  }
  for (const id of patIds) {
    const pat = pats.get(id);
    out.set(`agent:${id}`, pat ? (pat.username ? `${str(pat.name)} · ${personName(pat)}` : str(pat.name)) : "Deleted token");
  }
  for (const id of userIds) {
    const user = users.get(id);
    out.set(`person:${id}`, user ? personName(user) : "Deleted user");
  }
  for (const id of ids("client")) {
    const bar = id.indexOf("|");
    out.set(`client:${id}`, bar >= 0 ? `${id.slice(bar + 1)} (${id.slice(0, bar)})` : id);
  }
  return out;
}

/** The principal behind a lineage node id (`job:…`, `agent:…`, `person:…`, `client:…`), if it is one. */
export function principalOfNode(nodeId: string | null | undefined): PrincipalRef | null {
  if (!nodeId) return null;
  const colon = nodeId.indexOf(":");
  if (colon < 0) return null;
  const kind = nodeId.slice(0, colon);
  return kind === "job" || kind === "agent" || kind === "person" || kind === "client" ? { kind, id: nodeId.slice(colon + 1) } : null;
}

/** Display labels for the principal nodes among `nodeIds`, keyed by node id. */
export async function principalNodeLabels(nodeIds: Array<string | null | undefined>): Promise<Map<string, string>> {
  const refs = nodeIds.map(principalOfNode).filter((r): r is PrincipalRef => r !== null);
  return refs.length ? principalLabels(refs) : new Map();
}

/** Copies of `items` whose principal nodes carry their current display name. */
export async function relabelPrincipalNodes<T extends { label: string }>(items: T[], nodeIdOf: (item: T) => string | null | undefined): Promise<T[]> {
  const labels = await principalNodeLabels(items.map(nodeIdOf));
  if (labels.size === 0) return items;
  return items.map((item) => {
    const nodeId = nodeIdOf(item);
    const label = nodeId ? labels.get(nodeId) : undefined;
    return label ? { ...item, label } : item;
  });
}
