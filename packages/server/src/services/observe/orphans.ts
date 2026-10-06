/**
 * Evidence about objects that no longer exist. Observed lineage keeps edges for
 * the whole retention window, so a dropped table or a deleted scheduled job
 * would otherwise linger on the Data page long after it is gone.
 */

import { sql, type SQL } from "drizzle-orm";

import { all, str } from "./db";

/** Ids under `prefix` that `isLive` rejects, deduplicated, in first-seen order. */
export function staleIds(ids: Iterable<string>, prefix: string, isLive: (id: string) => boolean): string[] {
  const out = new Set<string>();
  for (const id of ids) if (id.startsWith(prefix) && !isLive(id)) out.add(id);
  return [...out];
}

/**
 * Statements that drop lineage nodes under `prefix` that are no longer live,
 * plus every edge touching them. Edge endpoints are checked too, because an
 * observed edge can name a table that never got a node row.
 */
export async function pruneLineage(connectionId: string, prefix: string, isLive: (id: string) => boolean): Promise<SQL[]> {
  const pattern = `${prefix}%`;
  const nodes = await all(sql`SELECT node_id FROM obs_lineage_nodes WHERE connection_id = ${connectionId} AND node_id LIKE ${pattern}`);
  const edges = await all(sql`
    SELECT source_id, target_id FROM obs_lineage_edges
    WHERE connection_id = ${connectionId} AND (source_id LIKE ${pattern} OR target_id LIKE ${pattern})`);
  const candidates = [
    ...nodes.map((n) => str(n.node_id)),
    ...edges.flatMap((e) => [str(e.source_id), str(e.target_id)]),
  ];
  return staleIds(candidates, prefix, isLive).flatMap((id) => [
    sql`DELETE FROM obs_lineage_edges WHERE connection_id = ${connectionId} AND (source_id = ${id} OR target_id = ${id})`,
    sql`DELETE FROM obs_lineage_nodes WHERE connection_id = ${connectionId} AND node_id = ${id}`,
  ]);
}
