/**
 * `catalog` collector (ADR 0016 §1, §3): tables, columns, dictionaries and the
 * structural half of the lineage graph — materialized and refreshable views,
 * engine tables and their upstream systems, Distributed and Buffer
 * destinations, dictionary sources and replicated databases.
 */

import { sql, type SQL } from "drizzle-orm";

import type { ConnectionCollector, CollectorContext } from "../collector";
import { runBatch } from "../db";
import { hasTable } from "../capabilities";
import { selectRows } from "../clickhouse";
import {
  classifyObject,
  externalNodeId,
  parseBuffer,
  parseDictionaryCreate,
  parseDictionarySource,
  parseDistributed,
  parseEngineSource,
  parseMvTarget,
  parseSelectSources,
  tableNodeId,
  type ObjectKind,
} from "../catalogParse";

const EXCLUDED_DATABASES = "('system', 'INFORMATION_SCHEMA', 'information_schema')";
const MAX_TABLES = 20_000;
const MAX_COLUMNS = 300_000;

interface TableRow {
  database: string;
  name: string;
  engine: string;
  engine_full: string;
  sorting_key: string;
  partition_key: string;
  primary_key: string;
  sampling_key: string;
  total_rows: number | null;
  total_bytes: number | null;
  create_table_query: string;
  comment: string;
  metadata_at: number;
  dependencies_database: string[];
  dependencies_table: string[];
}

export interface LineageNode {
  id: string;
  kind: string;
  label: string;
  database: string | null;
  table: string | null;
  attrs: Record<string, unknown>;
}

export interface LineageEdge {
  source: string;
  target: string;
  kind: string;
  columns?: string[];
  granularity?: "table" | "column";
}

export interface StructuralGraph {
  nodes: Map<string, LineageNode>;
  edges: Map<string, LineageEdge>;
}

export function edgeId(edge: LineageEdge): string {
  return `${edge.kind}:${edge.source}->${edge.target}`;
}

/** Pure: build structural nodes/edges from catalog rows. Exported for tests. */
export function buildStructuralGraph(
  tables: TableRow[],
  databaseEngines: Map<string, string>,
  dictionaries: Array<{ database: string; name: string; source: string }>,
): StructuralGraph {
  const nodes = new Map<string, LineageNode>();
  const edges = new Map<string, LineageEdge>();
  const addNode = (node: LineageNode): void => {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  };
  const addEdge = (edge: LineageEdge): void => {
    edges.set(edgeId(edge), edge);
  };
  const tableNode = (database: string, table: string, kind: ObjectKind | "table" = "table", engine = ""): string => {
    const id = tableNodeId(database, table);
    addNode({ id, kind, label: `${database}.${table}`, database, table, attrs: { engine } });
    return id;
  };

  for (const t of tables) {
    const kind = classifyObject(t.engine, t.create_table_query ?? "", databaseEngines.get(t.database) ?? null);
    const id = tableNodeId(t.database, t.name);
    nodes.set(id, { id, kind, label: `${t.database}.${t.name}`, database: t.database, table: t.name, attrs: { engine: t.engine } });

    // Tables that read from this one: incremental MVs (and other dependents).
    (t.dependencies_table ?? []).forEach((dep, i) => {
      const depDb = t.dependencies_database?.[i] ?? t.database;
      addEdge({ source: id, target: tableNode(depDb, dep, "materialized_view"), kind: "view_source", granularity: "table" });
    });

    if (kind === "materialized_view" || kind === "refreshable_view") {
      const target = parseMvTarget(t.create_table_query ?? "", t.database);
      if (target) addEdge({ source: id, target: tableNode(target.database, target.table), kind: "view_target", granularity: "table" });
      if (kind === "refreshable_view") {
        // Refreshable views are not in dependencies_*; read their SELECT.
        const sources = parseSelectSources(t.create_table_query ?? "", t.database);
        for (const s of sources.tables) addEdge({ source: tableNode(s.database, s.table), target: id, kind: "view_source", granularity: "table" });
        for (const fn of sources.tableFunctions) {
          const ext = externalNodeId(fn.name, fn.ref);
          addNode({ id: ext, kind: "external", label: `${fn.name}: ${fn.ref}`, database: null, table: null, attrs: { function: fn.name } });
          addEdge({ source: ext, target: id, kind: "external_read", granularity: "table" });
        }
      }
    }

    if (kind === "queue_engine" || kind === "object_storage_queue" || kind === "external_table") {
      const source = parseEngineSource(t.engine, t.engine_full ?? "");
      if (source) {
        const ext = externalNodeId(source.kind, source.ref);
        addNode({ id: ext, kind: "external", label: `${source.kind}: ${source.ref}`, database: null, table: null, attrs: { engine: t.engine } });
        addEdge({ source: ext, target: id, kind: kind === "external_table" ? "external_read" : "ingest", granularity: "table" });
      }
    }

    if (kind === "distributed") {
      const dest = parseDistributed(t.engine_full ?? "", t.database);
      if (dest) addEdge({ source: id, target: tableNode(dest.database, dest.table), kind: "distributed", granularity: "table" });
    }
    if (kind === "buffer") {
      const dest = parseBuffer(t.engine_full ?? "", t.database);
      if (dest) addEdge({ source: id, target: tableNode(dest.database, dest.table), kind: "buffer_flush", granularity: "table" });
    }
    if (kind === "replicated_database_table") {
      const dbEngine = databaseEngines.get(t.database) ?? "replicated";
      const ext = externalNodeId(dbEngine.toLowerCase(), t.database);
      addNode({ id: ext, kind: "external", label: `${dbEngine}: ${t.database}`, database: null, table: null, attrs: { engine: dbEngine } });
      addEdge({ source: ext, target: id, kind: "replication", granularity: "table" });
    }
  }

  const createByName = new Map(tables.map((t) => [`${t.database}.${t.name}`, t.create_table_query ?? ""]));
  for (const d of dictionaries) {
    const dictId = tableNodeId(d.database, d.name);
    addNode({ id: dictId, kind: "dictionary", label: `${d.database}.${d.name}`, database: d.database, table: d.name, attrs: {} });
    const source = d.source ? parseDictionarySource(d.source, d.database) : parseDictionaryCreate(createByName.get(`${d.database}.${d.name}`) ?? "", d.database);
    if (!source) continue;
    if (source.kind === "table" && "database" in source) {
      addEdge({ source: tableNode(source.database, source.table), target: dictId, kind: "dictionary_source", granularity: "table" });
    } else if ("ref" in source) {
      const ext = externalNodeId(source.kind, source.ref);
      addNode({ id: ext, kind: "external", label: `${source.kind}: ${source.ref}`, database: null, table: null, attrs: {} });
      addEdge({ source: ext, target: dictId, kind: "dictionary_source", granularity: "table" });
    }
  }
  return { nodes, edges };
}

function upsertNode(connectionId: string, node: LineageNode, now: number): SQL {
  return sql`
    INSERT INTO obs_lineage_nodes (connection_id, node_id, kind, label, database_name, table_name, attrs, last_seen_at)
    VALUES (${connectionId}, ${node.id}, ${node.kind}, ${node.label}, ${node.database}, ${node.table}, ${JSON.stringify(node.attrs)}, ${now})
    ON CONFLICT (connection_id, node_id) DO UPDATE SET kind = ${node.kind}, label = ${node.label}, attrs = ${JSON.stringify(node.attrs)}, last_seen_at = ${now}
  `;
}

export function upsertEdge(connectionId: string, edge: LineageEdge, origin: "structural" | "observed", now: number, observations = 0): SQL {
  const id = edgeId(edge);
  const columns = JSON.stringify(edge.columns ?? []);
  return sql`
    INSERT INTO obs_lineage_edges (connection_id, edge_id, source_id, target_id, kind, origin, granularity, columns, observations, first_seen_at, last_seen_at)
    VALUES (${connectionId}, ${id}, ${edge.source}, ${edge.target}, ${edge.kind}, ${origin}, ${edge.granularity ?? "table"}, ${columns}, ${observations}, ${now}, ${now})
    ON CONFLICT (connection_id, edge_id) DO UPDATE SET
      origin = ${origin}, granularity = ${edge.granularity ?? "table"}, columns = ${columns},
      observations = obs_lineage_edges.observations + ${observations}, last_seen_at = ${now}
  `;
}

export const catalogCollector: ConnectionCollector = {
  name: "catalog",
  scope: "connection",
  intervalMs: 5 * 60 * 1000,
  requires: ["tables", "columns", "databases"],
  async run(ctx: CollectorContext): Promise<void> {
    const connectionId = ctx.connection.id;
    const now = ctx.nowMs;
    const tables = await selectRows<TableRow>(ctx.client, `
      SELECT database, name, engine, engine_full, sorting_key, partition_key, primary_key, sampling_key,
        total_rows, total_bytes, create_table_query, comment,
        toUnixTimestamp(metadata_modification_time) * 1000 AS metadata_at,
        dependencies_database, dependencies_table
      FROM system.tables
      WHERE database NOT IN ${EXCLUDED_DATABASES} AND NOT is_temporary AND NOT startsWith(name, '.')
      LIMIT ${MAX_TABLES}`);
    const columns = await selectRows<{ database: string; table: string; name: string; type: string; position: number; comment: string }>(ctx.client, `
      SELECT database, table, name, type, position, comment FROM system.columns
      WHERE database NOT IN ${EXCLUDED_DATABASES} AND NOT startsWith(table, '.') LIMIT ${MAX_COLUMNS}`);
    const databases = await selectRows<{ name: string; engine: string }>(ctx.client, "SELECT name, engine FROM system.databases");
    const dictionaries = hasTable(ctx.capabilities, "dictionaries")
      ? await selectRows<{ database: string; name: string; source: string }>(ctx.client, "SELECT database, name, source FROM system.dictionaries")
      : [];

    const statements: SQL[] = [];
    for (const t of tables) {
      statements.push(sql`
        INSERT INTO obs_catalog_tables (connection_id, database_name, table_name, engine, engine_full, sorting_key, partition_key, primary_key, sampling_key, total_rows, total_bytes, create_query, comment, metadata_at, updated_at)
        VALUES (${connectionId}, ${t.database}, ${t.name}, ${t.engine}, ${t.engine_full}, ${t.sorting_key}, ${t.partition_key}, ${t.primary_key}, ${t.sampling_key}, ${t.total_rows}, ${t.total_bytes}, ${t.create_table_query}, ${t.comment}, ${t.metadata_at}, ${now})
        ON CONFLICT (connection_id, database_name, table_name) DO UPDATE SET
          engine = ${t.engine}, engine_full = ${t.engine_full}, sorting_key = ${t.sorting_key}, partition_key = ${t.partition_key},
          primary_key = ${t.primary_key}, sampling_key = ${t.sampling_key}, total_rows = ${t.total_rows}, total_bytes = ${t.total_bytes},
          create_query = ${t.create_table_query}, comment = ${t.comment}, metadata_at = ${t.metadata_at}, updated_at = ${now}
      `);
    }
    statements.push(sql`DELETE FROM obs_catalog_tables WHERE connection_id = ${connectionId} AND updated_at < ${now}`);
    statements.push(sql`DELETE FROM obs_catalog_columns WHERE connection_id = ${connectionId}`);
    for (const c of columns) {
      statements.push(sql`
        INSERT INTO obs_catalog_columns (connection_id, database_name, table_name, column_name, column_type, position, comment)
        VALUES (${connectionId}, ${c.database}, ${c.table}, ${c.name}, ${c.type}, ${c.position}, ${c.comment})
        ON CONFLICT (connection_id, database_name, table_name, column_name) DO NOTHING
      `);
    }

    const graph = buildStructuralGraph(tables, new Map(databases.map((d) => [d.name, d.engine])), dictionaries);
    for (const node of graph.nodes.values()) statements.push(upsertNode(connectionId, node, now));
    for (const edge of graph.edges.values()) statements.push(upsertEdge(connectionId, edge, "structural", now));
    // Structural edges that no longer exist disappear; observed ones age out by retention.
    statements.push(sql`DELETE FROM obs_lineage_edges WHERE connection_id = ${connectionId} AND origin = 'structural' AND last_seen_at < ${now}`);
    await runBatch(statements);
  },
};

export type { TableRow };
